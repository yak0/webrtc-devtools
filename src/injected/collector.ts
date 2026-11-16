// Runs in the inspected page's main JS world at document_start.
//
// Design rules (the extension must never change how the app behaves):
//  * Native constructors/methods are wrapped with Proxies, so `name`, `length`,
//    `toString()`, statics and `instanceof` keep working.
//  * Return values, thrown errors and rejected promises are passed through untouched.
//  * All bookkeeping is wrapped in try/catch; a bug here must not break the app.
//  * Nothing is sent anywhere until a DevTools panel attaches; until then we only
//    keep a bounded in-memory trace (getStats polling only runs while attached).

import {
  CONTENT_EVENT,
  DEFAULT_SETTINGS,
  NO_CHAOS,
  PAGE_EVENT,
  type CallEnd,
  type CollectorSettings,
  type ContentEnvelope,
  type DataChannelInfo,
  type DataChannelMessage,
  type MediaCall,
  type PageCommand,
  type PageEnv,
  type PageEnvelope,
  type PageMessage,
  type StatsDelta,
  type VideoPreview,
  type PcInfo,
  type PcSnapshot,
  type PcStates,
  type TraceEvent,
  type TrackEvent
} from '../shared/protocol';
import { describeTrack, errorInfo, maskConfig, previewData, serialize } from './serialize';
import { StatsDiffer, applyStatsDelta } from './stats-differ';
import { probeSdkGlobals } from './sdk-globals';

const MAX_EVENTS_PER_PC = 5000;
const MAX_MEDIA_CALLS = 500;
const MAX_TRACK_EVENTS = 1000;
const MAX_DC_MESSAGES_PER_SEC = 300;
/** Closed / collected connections kept in page memory; older ones are dropped (the panel keeps its own copy). */
const MAX_CLOSED_PCS = 30;
/** Stats reports buffered per connection while recording without a panel (~15 min at 1/s). */
const MAX_RECORDED_REPORTS = 900;
const FLUSH_DELAY = 60;
const INSTALLED = Symbol.for('webrtc-devtools.installed');

interface DcEntry {
  info: DataChannelInfo;
  ref: WeakRef<RTCDataChannel>;
}

interface PcEntry {
  info: PcInfo;
  ref: WeakRef<RTCPeerConnection>;
  events: TraceEvent[];
  dropped: number;
  closed: boolean;
  collected: boolean;
  differ: StatsDiffer;
  statsBusy: boolean;
  dcs: Map<string, DcEntry>;
  dcSeq: number;
  /** Deltas recorded while detached; recorded[0] is always a full report. */
  recorded: StatsDelta[];
}

export function install(w: typeof globalThis & Window): void {
  const anyWin = w as any;
  if (anyWin[INSTALLED]) return;
  try {
    Object.defineProperty(w, INSTALLED, { value: true });
  } catch {
    return;
  }

  const NativePC: typeof RTCPeerConnection | undefined = anyWin.RTCPeerConnection;

  // ---- natives captured before any page script runs -------------------------------
  const nativeAddEventListener = EventTarget.prototype.addEventListener;
  const nativeDispatchEvent = EventTarget.prototype.dispatchEvent;
  const NativeCustomEvent = w.CustomEvent;
  const nativeStringify = JSON.stringify;
  const nativeParse = JSON.parse;
  const nativeSetTimeout = w.setTimeout.bind(w);
  const nativeSetInterval = w.setInterval.bind(w);
  const nativeClearInterval = w.clearInterval.bind(w);
  const nativeNow = Date.now;
  const perfNow = () => performance.now();
  const NativeWeakRef = w.WeakRef;
  const NativeFinalizationRegistry = w.FinalizationRegistry;
  const nativeGetStats = NativePC?.prototype.getStats;
  const nativeGetConfiguration = NativePC?.prototype.getConfiguration;
  const nativeGetSenders = NativePC?.prototype.getSenders;
  const nativeGetTransceivers = NativePC?.prototype.getTransceivers;
  const nativeGetReceivers = NativePC?.prototype.getReceivers;
  const NativeImageCapture = (w as any).ImageCapture;
  const NativeOffscreenCanvas = (w as any).OffscreenCanvas;
  const realm = Math.random().toString(36).slice(2, 6);

  const on = (target: EventTarget, type: string, fn: (e: any) => void) => {
    try {
      nativeAddEventListener.call(target, type, (e: Event) => {
        try {
          fn(e);
        } catch {
          /* never let collector bugs surface in the app */
        }
      });
    } catch {
      /* ignore */
    }
  };

  // ---- state ----------------------------------------------------------------------
  let attached = false;
  let recording = false;
  let previewTarget: string | null | undefined = undefined; // undefined = off, null = all connections
  let previewTimer: ReturnType<typeof setInterval> | null = null;
  let lastEnv = '';
  let settings: CollectorSettings = { ...DEFAULT_SETTINGS };
  let activitySignaled = false;
  let seq = 0;
  let pcIndex = 0;
  const pcs = new Map<string, PcEntry>();
  const pcIds = new WeakMap<object, string>();
  const dcEntries = new WeakMap<object, { pc: PcEntry; dc: DcEntry }>();
  const knownTracks = new WeakSet<object>();
  const mediaCalls: MediaCall[] = [];
  const trackEvents: TrackEvent[] = [];
  let queue: PageMessage[] = [];
  let flushScheduled = false;
  let statsTimer: ReturnType<typeof setInterval> | null = null;
  let dcBudget = MAX_DC_MESSAGES_PER_SEC;
  let dcBudgetResetAt = 0;
  const dcPending = new Map<string, { messages: DataChannelMessage[]; dropped: number }>();

  const finalizer = NativeFinalizationRegistry
    ? new NativeFinalizationRegistry((id: string) => {
        const entry = pcs.get(id);
        if (!entry || entry.closed) return;
        entry.collected = true;
        record(entry, { kind: 'note', name: 'garbage-collected', value: 'RTCPeerConnection was garbage collected without close()' });
        emit({ t: 'pc-gone', id, reason: 'collected' });
        signalCount();
        pruneClosed();
      })
    : null;

  // ---- transport ------------------------------------------------------------------
  function send(envelope: PageEnvelope) {
    try {
      nativeDispatchEvent.call(w, new NativeCustomEvent(PAGE_EVENT, { detail: nativeStringify(envelope) }));
    } catch {
      /* ignore */
    }
  }

  function emit(msg: PageMessage) {
    if (!attached) return;
    queue.push(msg);
    if (!flushScheduled) {
      flushScheduled = true;
      nativeSetTimeout(flush, FLUSH_DELAY);
    }
  }

  function flush() {
    flushScheduled = false;
    for (const [pcId, pending] of dcPending) {
      queue.push({ t: 'dc-messages', pcId, messages: pending.messages, dropped: pending.dropped });
    }
    dcPending.clear();
    if (!attached || queue.length === 0) {
      queue = [];
      return;
    }
    const batch = queue;
    queue = [];
    send({ batch });
  }

  function signalActivity() {
    if (activitySignaled) return;
    activitySignaled = true;
    send({ activity: true });
  }

  let lastSummary = '';
  /** Tells the content script which connections are open (drives the toolbar badge and popup). */
  function summary() {
    const out: { index: number; state: string }[] = [];
    for (const e of pcs.values()) {
      if (e.closed || e.collected) continue;
      out.push({ index: e.info.index, state: e.ref.deref()?.connectionState ?? 'closed' });
    }
    return out;
  }
  function signalCount() {
    const s = summary();
    const key = nativeStringify(s);
    if (key === lastSummary) return;
    lastSummary = key;
    send({ activity: true, pcSummary: s });
  }

  on(w, CONTENT_EVENT, (e: CustomEvent) => {
    if (typeof e.detail !== 'string') return;
    const msg = nativeParse(e.detail) as ContentEnvelope;
    if (msg.settings) applySettings(msg.settings);
    switch (msg.cmd) {
      case 'record':
        recording = !!msg.record;
        if (recording && !attached) startStats();
        break;
      case 'command':
        if (msg.command) runCommand(msg.command, msg.commandId ?? 0);
        break;
      case 'hello':
        if (activitySignaled) send({ activity: true, pcSummary: lastSummary ? summary() : undefined });
        break;
      case 'attach':
        attach();
        break;
      case 'detach':
        detach();
        break;
    }
  });

  function applySettings(next: CollectorSettings) {
    const intervalChanged = next.statsInterval !== settings.statsInterval;
    settings = { ...settings, ...next, chaos: { ...DEFAULT_SETTINGS.chaos, ...(next.chaos ?? settings.chaos) } };
    if (attached && intervalChanged) startStats();
  }

  function attach() {
    attached = true;
    queue = [];
    lastEnv = '';
    queue.push({
      t: 'snapshot',
      snapshot: {
        url: location.href,
        userAgent: navigator.userAgent,
        env: currentEnv(),
        pcs: [...pcs.values()].map(snapshotOf),
        media: mediaCalls.slice(),
        trackEvents: trackEvents.slice()
      }
    });
    // Replay what was recorded before the panel opened; the differ keeps going from there.
    for (const entry of pcs.values()) {
      if (entry.recorded.length) {
        for (const delta of entry.recorded) queue.push({ t: 'stats', id: entry.info.id, delta });
        entry.recorded = [];
      } else {
        entry.differ.reset();
      }
    }
    flush();
    startStats();
  }

  function detach() {
    attached = false;
    // Fault injection must never outlive the panel that enabled it.
    settings = { ...settings, chaos: NO_CHAOS };
    queue = [];
    dcPending.clear();
    stopPreview();
    for (const entry of pcs.values()) entry.differ.reset(); // next recorded report starts full
    if (statsTimer) nativeClearInterval(statsTimer);
    statsTimer = null;
    if (recording) startStats();
  }

  function currentEnv(): PageEnv {
    return { sdks: probeSdkGlobals(w) };
  }

  function emitEnvIfChanged() {
    if (!attached) return;
    const env = currentEnv();
    const key = nativeStringify(env);
    if (key === lastEnv) return;
    lastEnv = key;
    emit({ t: 'env', env });
  }

  // ---- helpers ----------------------------------------------------------------------
  const selfUrl = (() => {
    const m = /((?:chrome-extension|https?|file):\/\/[^\s)]+?):\d+:\d+/.exec(String(new Error().stack));
    return m ? m[1] : '';
  })();

  function captureStack(): string | undefined {
    if (!settings.captureStacks) return undefined;
    try {
      const E = Error as any;
      const limit = E.stackTraceLimit;
      E.stackTraceLimit = 40;
      const stack = String(new Error().stack);
      E.stackTraceLimit = limit;
      const lines = stack
        .split('\n')
        .slice(1)
        .filter((l) => !(selfUrl && l.includes(selfUrl)) && !l.includes('/src/injected/') && !l.includes('<anonymous>'));
      return lines.slice(0, 20).map((l) => l.trim()).join('\n') || undefined;
    } catch {
      return undefined;
    }
  }

  function statesOf(pc: RTCPeerConnection): PcStates {
    return {
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      iceGatheringState: pc.iceGatheringState,
      signalingState: pc.signalingState
    };
  }

  function currentStates(entry: PcEntry): PcStates | undefined {
    const pc = entry.ref.deref();
    return pc ? statesOf(pc) : undefined;
  }

  function snapshotOf(entry: PcEntry): PcSnapshot {
    const pc = entry.ref.deref();
    return {
      info: entry.info,
      states: pc
        ? statesOf(pc)
        : { connectionState: 'closed', iceConnectionState: 'closed', iceGatheringState: 'complete', signalingState: 'closed' },
      events: entry.events.slice(),
      droppedEvents: entry.dropped,
      closed: entry.closed,
      collected: entry.collected,
      dataChannels: [...entry.dcs.values()].map((d) => d.info)
    };
  }

  function record(entry: PcEntry, ev: Omit<TraceEvent, 'seq' | 'ts'> & { ts?: number }): TraceEvent {
    const full: TraceEvent = { seq: ++seq, ts: ev.ts ?? nativeNow(), ...ev } as TraceEvent;
    entry.events.push(full);
    if (entry.events.length > MAX_EVENTS_PER_PC) {
      const drop = Math.ceil(MAX_EVENTS_PER_PC / 10);
      entry.events.splice(0, drop);
      entry.dropped += drop;
    }
    emit({ t: 'pc-event', id: entry.info.id, ev: full, states: currentStates(entry) });
    return full;
  }

  function entryOfPc(pc: unknown): PcEntry | undefined {
    const id = pc && typeof pc === 'object' ? pcIds.get(pc) : undefined;
    return id ? pcs.get(id) : undefined;
  }

  function entryOwning(obj: object, kind: 'sender' | 'transceiver'): PcEntry | undefined {
    for (const entry of pcs.values()) {
      if (entry.closed || entry.collected) continue;
      const pc = entry.ref.deref();
      if (!pc) continue;
      try {
        const list: object[] =
          kind === 'sender' ? nativeGetSenders!.call(pc) : nativeGetTransceivers!.call(pc);
        if (list.includes(obj)) return entry;
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }

  // ---- generic method wrapper -------------------------------------------------------
  interface WrapOptions {
    resolve: (self: any) => PcEntry | undefined;
    args?: (args: any[]) => unknown;
    result?: (value: any, self: any, entry: PcEntry) => unknown;
    target?: (self: any) => string | undefined;
    after?: (entry: PcEntry, self: any, args: any[], value: any) => void;
    /** Replaces the native call (chaos mode). Must return what the app expects. */
    intercept?: (entry: PcEntry, args: any[], invoke: () => any) => any;
    name?: string;
  }

  function startCall(entry: PcEntry, name: string, args: any[], o: WrapOptions, self: any): TraceEvent {
    return record(entry, {
      kind: 'call',
      name,
      args: o.args ? o.args(args) : serialize(args),
      stack: captureStack(),
      target: o.target?.(self),
      pending: true
    });
  }

  function endCall(entry: PcEntry, ev: TraceEvent, t0: number, o: WrapOptions, self: any, args: any[], ok: boolean, v: any) {
    try {
      const end: CallEnd = { seq: ev.seq, duration: Math.round((perfNow() - t0) * 100) / 100 };
      if (ok) {
        end.result = o.result ? o.result(v, self, entry) : v === undefined ? undefined : serialize(v);
        o.after?.(entry, self, args, v);
      } else {
        end.error = errorInfo(v);
      }
      ev.pending = false;
      ev.duration = end.duration;
      ev.result = end.result;
      ev.error = end.error;
      emit({ t: 'pc-call-end', id: entry.info.id, end, states: currentStates(entry) });
    } catch {
      /* ignore */
    }
  }

  function wrapMethod(proto: any, name: string, o: WrapOptions) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== 'function') return;
    const original = desc.value;
    const wrapped = new Proxy(original, {
      apply(target, self, args: any[]) {
        let entry: PcEntry | undefined;
        try {
          entry = o.resolve(self);
        } catch {
          entry = undefined;
        }
        if (!entry) return Reflect.apply(target, self, args);

        let ev: TraceEvent | undefined;
        const t0 = perfNow();
        try {
          ev = startCall(entry, o.name ?? name, args, o, self);
        } catch {
          ev = undefined;
        }
        let ret: any;
        try {
          const invoke = () => Reflect.apply(target, self, args);
          ret = o.intercept ? o.intercept(entry, args, invoke) : invoke();
        } catch (err) {
          if (ev) endCall(entry, ev, t0, o, self, args, false, err);
          throw err;
        }
        if (ev) {
          if (ret && typeof ret.then === 'function') {
            const e = entry;
            const evRef = ev;
            // Observe only; the original promise is returned unchanged.
            ret.then(
              (v: any) => endCall(e, evRef, t0, o, self, args, true, v),
              (err: any) => endCall(e, evRef, t0, o, self, args, false, err)
            );
          } else {
            endCall(entry, ev, t0, o, self, args, true, ret);
          }
        }
        return ret;
      }
    });
    try {
      Object.defineProperty(proto, name, { ...desc, value: wrapped });
    } catch {
      /* ignore */
    }
  }

  function wrapSetter(proto: any, prop: string, o: WrapOptions) {
    if (!proto) return;
    const desc = Object.getOwnPropertyDescriptor(proto, prop);
    if (!desc || typeof desc.set !== 'function') return;
    const set = new Proxy(desc.set, {
      apply(target, self, args: any[]) {
        try {
          const entry = o.resolve(self);
          if (entry) {
            record(entry, {
              kind: 'call',
              name: `${prop} =`,
              args: serialize(args),
              target: o.target?.(self),
              stack: captureStack()
            });
          }
        } catch {
          /* ignore */
        }
        return Reflect.apply(target, self, args);
      }
    });
    try {
      Object.defineProperty(proto, prop, { ...desc, set });
    } catch {
      /* ignore */
    }
  }

  // ---- data channels -----------------------------------------------------------------
  function registerDataChannel(entry: PcEntry, dc: RTCDataChannel, origin: 'local' | 'remote') {
    if (!dc || dcEntries.has(dc)) return;
    const key = `${entry.info.id}:dc${++entry.dcSeq}`;
    const info: DataChannelInfo = {
      pcId: entry.info.id,
      key,
      label: dc.label,
      id: dc.id,
      protocol: dc.protocol,
      ordered: dc.ordered,
      negotiated: dc.negotiated,
      maxRetransmits: dc.maxRetransmits,
      maxPacketLifeTime: dc.maxPacketLifeTime,
      origin,
      readyState: dc.readyState
    };
    const d: DcEntry = { info, ref: new NativeWeakRef(dc) };
    entry.dcs.set(key, d);
    dcEntries.set(dc, { pc: entry, dc: d });
    emit({ t: 'dc-open', dc: info });

    const onState = (type: string) => () => {
      info.readyState = dc.readyState;
      info.id = dc.id;
      record(entry, { kind: 'event', name: `datachannel.${type}`, value: { label: dc.label, id: dc.id }, target: key });
      emit({ t: 'dc-state', key, pcId: entry.info.id, readyState: dc.readyState, id: dc.id });
    };
    on(dc, 'open', onState('open'));
    on(dc, 'closing', onState('closing'));
    on(dc, 'close', onState('close'));
    on(dc, 'error', (e: any) => {
      record(entry, {
        kind: 'event',
        name: 'datachannel.error',
        value: { label: dc.label, error: errorInfo(e?.error ?? e) },
        target: key
      });
    });
    on(dc, 'message', (e: MessageEvent) => captureDcMessage(entry, key, 'received', e.data));
  }

  function captureDcMessage(entry: PcEntry, key: string, direction: 'sent' | 'received', data: unknown) {
    if (!attached || !settings.captureDataChannelMessages) return;
    let pending = dcPending.get(entry.info.id);
    if (!pending) dcPending.set(entry.info.id, (pending = { messages: [], dropped: 0 }));
    const now = nativeNow();
    if (now - dcBudgetResetAt >= 1000) {
      dcBudgetResetAt = now;
      dcBudget = MAX_DC_MESSAGES_PER_SEC;
    }
    if (dcBudget <= 0) {
      pending.dropped++;
    } else {
      dcBudget--;
      pending.messages.push({ ts: now, key, direction, ...previewData(data) });
    }
    if (!flushScheduled) {
      flushScheduled = true;
      nativeSetTimeout(flush, FLUSH_DELAY);
    }
  }

  // ---- tracks -------------------------------------------------------------------------
  function pushTrackEvent(ev: TrackEvent) {
    trackEvents.push(ev);
    if (trackEvents.length > MAX_TRACK_EVENTS) trackEvents.splice(0, 100);
    emit({ t: 'track-event', ev });
  }

  function watchTrack(track: MediaStreamTrack) {
    if (!track || knownTracks.has(track)) return;
    knownTracks.add(track);
    for (const type of ['ended', 'mute', 'unmute'] as const) {
      on(track, type, () => pushTrackEvent({ ts: nativeNow(), trackId: track.id, kind: track.kind, event: type }));
    }
  }

  function trackInfo(t: MediaStreamTrack) {
    let settingsObj: unknown;
    try {
      settingsObj = serialize(t.getSettings());
    } catch {
      settingsObj = undefined;
    }
    return {
      id: t.id,
      kind: t.kind,
      label: t.label,
      readyState: t.readyState,
      muted: t.muted,
      enabled: t.enabled,
      settings: settingsObj
    };
  }

  // ---- RTCPeerConnection ----------------------------------------------------------
  function register(pc: RTCPeerConnection, args: any[]) {
    const id = `${realm}-${++pcIndex}`;
    let effective: unknown;
    try {
      effective = maskConfig(nativeGetConfiguration!.call(pc));
    } catch {
      effective = undefined;
    }
    const info: PcInfo = {
      id,
      index: pcIndex,
      createdAt: nativeNow(),
      url: location.href,
      config: maskConfig(args[0] ?? {}),
      effectiveConfig: effective,
      constraints: args.length > 1 ? serialize(args[1]) : undefined,
      stack: captureStack()
    };
    const entry: PcEntry = {
      info,
      ref: new NativeWeakRef(pc),
      events: [],
      dropped: 0,
      closed: false,
      collected: false,
      differ: new StatsDiffer(),
      statsBusy: false,
      dcs: new Map(),
      dcSeq: 0,
      recorded: []
    };
    pcs.set(id, entry);
    pcIds.set(pc, id);
    finalizer?.register(pc, id);

    on(pc, 'icecandidate', (e: RTCPeerConnectionIceEvent) => {
      const blocked = !!e.candidate && candidateBlocked(e.candidate.candidate);
      // Our listener was registered first, so stopping here hides the candidate from the app.
      if (blocked) e.stopImmediatePropagation();
      record(entry, {
        kind: 'event',
        name: 'icecandidate',
        value: e.candidate ? { ...e.candidate.toJSON(), ...(blocked ? { blockedByDevtools: true } : {}) } : null
      });
    });
    on(pc, 'icecandidateerror', (e: RTCPeerConnectionIceErrorEvent) =>
      record(entry, {
        kind: 'event',
        name: 'icecandidateerror',
        value: { url: e.url, address: e.address, port: e.port, errorCode: e.errorCode, errorText: e.errorText }
      })
    );
    for (const [type, prop] of [
      ['connectionstatechange', 'connectionState'],
      ['iceconnectionstatechange', 'iceConnectionState'],
      ['icegatheringstatechange', 'iceGatheringState'],
      ['signalingstatechange', 'signalingState']
    ] as const) {
      on(pc, type, () => {
        record(entry, { kind: 'event', name: type, value: pc[prop] });
        if (type === 'connectionstatechange') signalCount();
      });
    }
    on(pc, 'negotiationneeded', () => record(entry, { kind: 'event', name: 'negotiationneeded' }));
    on(pc, 'track', (e: RTCTrackEvent) => {
      watchTrack(e.track);
      record(entry, {
        kind: 'event',
        name: 'track',
        value: {
          track: describeTrack(e.track),
          streams: e.streams.map((s) => s.id),
          mid: e.transceiver?.mid
        }
      });
    });
    on(pc, 'datachannel', (e: RTCDataChannelEvent) => {
      record(entry, { kind: 'event', name: 'datachannel', value: { label: e.channel.label, id: e.channel.id } });
      registerDataChannel(entry, e.channel, 'remote');
    });

    emit({ t: 'pc-new', pc: snapshotOf(entry) });
    emitEnvIfChanged();
    signalActivity();
    signalCount();
  }

  function markClosed(entry: PcEntry) {
    if (entry.closed) return;
    entry.closed = true;
    emit({ t: 'pc-gone', id: entry.info.id, reason: 'closed' });
    signalCount();
    pruneClosed();
  }

  /** Map iteration is insertion-ordered, so the oldest closed connections go first. */
  function pruneClosed() {
    let closed = 0;
    for (const e of pcs.values()) if (e.closed || e.collected) closed++;
    if (closed <= MAX_CLOSED_PCS) return;
    for (const [id, e] of pcs) {
      if (closed <= MAX_CLOSED_PCS) break;
      if (e.closed || e.collected) {
        pcs.delete(id);
        closed--;
      }
    }
  }

  if (NativePC) {
    const ProxiedPC = new Proxy(NativePC, {
      construct(target, args, newTarget) {
        let forced = false;
        if (settings.chaos.forceRelay) {
          args = [{ ...(args[0] ?? {}), iceTransportPolicy: 'relay' }, ...args.slice(1)];
          forced = true;
        }
        const pc = Reflect.construct(target, args, newTarget);
        try {
          register(pc, args);
          if (forced) {
            const e = entryOfPc(pc);
            if (e) record(e, { kind: 'note', name: 'devtools.chaos', value: 'iceTransportPolicy forced to "relay"' });
          }
        } catch {
          /* ignore */
        }
        return pc;
      }
    });
    try {
      anyWin.RTCPeerConnection = ProxiedPC;
      if (anyWin.webkitRTCPeerConnection === NativePC) anyWin.webkitRTCPeerConnection = ProxiedPC;
      Object.defineProperty(NativePC.prototype, 'constructor', {
        value: ProxiedPC,
        writable: true,
        configurable: true,
        enumerable: false
      });
    } catch {
      /* ignore */
    }

    const P = NativePC.prototype;
    const forPc = (self: any) => entryOfPc(self);
    const description = (which: 'localDescription' | 'remoteDescription') => (_v: any, self: any) => {
      const d = self?.[which];
      return d ? { [which]: { type: d.type, sdp: d.sdp } } : undefined;
    };

    wrapMethod(P, 'createOffer', { resolve: forPc, args: (a) => serialize(a.filter((x) => typeof x !== 'function')) });
    wrapMethod(P, 'createAnswer', { resolve: forPc, args: (a) => serialize(a.filter((x) => typeof x !== 'function')) });
    wrapMethod(P, 'setLocalDescription', { resolve: forPc, result: description('localDescription') });
    wrapMethod(P, 'setRemoteDescription', { resolve: forPc, result: description('remoteDescription') });
    wrapMethod(P, 'addIceCandidate', {
      resolve: forPc,
      intercept: (entry, args, invoke) => {
        const c = args[0];
        const line = typeof c === 'string' ? c : c?.candidate;
        if (typeof line === 'string' && line && candidateBlocked(line)) {
          record(entry, { kind: 'note', name: 'devtools.chaos', value: `remote candidate dropped: ${line}` });
          return Promise.resolve();
        }
        const delay = settings.chaos.candidateDelayMs;
        if (delay > 0) return new Promise((r) => nativeSetTimeout(r, delay)).then(invoke);
        return invoke();
      }
    });
    wrapMethod(P, 'restartIce', { resolve: forPc });
    wrapMethod(P, 'setConfiguration', { resolve: forPc, args: (a) => [maskConfig(a[0])] });
    wrapMethod(P, 'addTrack', {
      resolve: forPc,
      after: (_e, _s, args) => args[0] && watchTrack(args[0])
    });
    wrapMethod(P, 'removeTrack', { resolve: forPc });
    wrapMethod(P, 'addTransceiver', {
      resolve: forPc,
      after: (_e, _s, args) => typeof args[0] === 'object' && args[0] && watchTrack(args[0])
    });
    wrapMethod(P, 'createDataChannel', {
      resolve: forPc,
      after: (entry, _s, _a, dc) => registerDataChannel(entry, dc, 'local')
    });
    wrapMethod(P, 'close', { resolve: forPc, after: (entry) => markClosed(entry) });
    // Legacy stream APIs still used by some apps.
    wrapMethod(P, 'addStream', { resolve: forPc });
    wrapMethod(P, 'removeStream', { resolve: forPc });

    const senderTarget = (s: any) => `sender(${s?.track ? `${s.track.kind}:${s.track.id}` : 'no track'})`;
    const SenderP = anyWin.RTCRtpSender?.prototype;
    wrapMethod(SenderP, 'replaceTrack', {
      resolve: (s) => entryOwning(s, 'sender'),
      target: senderTarget,
      after: (_e, _s, args) => args[0] && watchTrack(args[0])
    });
    wrapMethod(SenderP, 'setParameters', { resolve: (s) => entryOwning(s, 'sender'), target: senderTarget });
    wrapMethod(SenderP, 'setStreams', { resolve: (s) => entryOwning(s, 'sender'), target: senderTarget });

    const transceiverTarget = (t: any) => `transceiver(mid=${t?.mid ?? 'null'})`;
    const TransceiverP = anyWin.RTCRtpTransceiver?.prototype;
    wrapMethod(TransceiverP, 'setCodecPreferences', {
      resolve: (t) => entryOwning(t, 'transceiver'),
      target: transceiverTarget
    });
    wrapMethod(TransceiverP, 'stop', { resolve: (t) => entryOwning(t, 'transceiver'), target: transceiverTarget });
    wrapSetter(TransceiverP, 'direction', { resolve: (t) => entryOwning(t, 'transceiver'), target: transceiverTarget });

    const DcP = anyWin.RTCDataChannel?.prototype;
    if (DcP) {
      const desc = Object.getOwnPropertyDescriptor(DcP, 'send');
      if (desc && typeof desc.value === 'function') {
        const sendProxy = new Proxy(desc.value, {
          apply(target, self, args: any[]) {
            const rate = settings.chaos.dcDropRate;
            if (rate > 0 && Math.random() < rate && self?.readyState === 'open') {
              try {
                const ref = dcEntries.get(self);
                if (ref) record(ref.pc, { kind: 'note', name: 'devtools.chaos', value: `message dropped on "${ref.dc.info.label}"`, target: ref.dc.info.key });
              } catch {
                /* ignore */
              }
              return undefined;
            }
            const ret = Reflect.apply(target, self, args);
            try {
              const ref = dcEntries.get(self);
              if (ref) captureDcMessage(ref.pc, ref.dc.info.key, 'sent', args[0]);
            } catch {
              /* ignore */
            }
            return ret;
          }
        });
        try {
          Object.defineProperty(DcP, 'send', { ...desc, value: sendProxy });
        } catch {
          /* ignore */
        }
      }
    }
  }

  // ---- getStats polling (only while a panel is attached) --------------------------------
  function pollStats() {
    for (const entry of pcs.values()) {
      if (entry.closed || entry.collected || entry.statsBusy) continue;
      const pc = entry.ref.deref();
      if (!pc) continue;
      if (pc.connectionState === 'closed' || pc.signalingState === 'closed') {
        markClosed(entry);
        continue;
      }
      entry.statsBusy = true;
      let p: Promise<RTCStatsReport>;
      try {
        p = nativeGetStats!.call(pc);
      } catch {
        entry.statsBusy = false;
        continue;
      }
      p.then(
        (report) => {
          entry.statsBusy = false;
          if (!attached && !recording) return;
          const objects: Record<string, Record<string, unknown>> = {};
          report.forEach((value: any, key: string) => {
            objects[key] = { ...value };
          });
          const delta = entry.differ.diff(objects, nativeNow());
          if (attached) emit({ t: 'stats', id: entry.info.id, delta });
          else keepRecorded(entry, delta);
        },
        () => {
          entry.statsBusy = false;
        }
      );
    }
  }

  function keepRecorded(entry: PcEntry, delta: StatsDelta) {
    entry.recorded.push(delta);
    if (entry.recorded.length > MAX_RECORDED_REPORTS) {
      // Fold the oldest delta into the (full) first report so the buffer still starts full.
      const [first, second] = entry.recorded.splice(0, 2);
      const merged = new Map<string, Record<string, unknown>>();
      applyStatsDelta(merged, first);
      applyStatsDelta(merged, second);
      entry.recorded.unshift({ ts: second.ts, full: true, changed: Object.fromEntries(merged), removed: [] });
    }
  }

  // ---- commands from the panel -------------------------------------------------------
  function candidateBlocked(line: string): boolean {
    const c = settings.chaos;
    if (!c.blockCandidateTypes.length && !c.blockProtocols.length) return false;
    const parts = line.replace(/^a=/, '').replace(/^candidate:/, '').trim().split(/\s+/);
    const protocol = (parts[2] ?? '').toLowerCase();
    const typIdx = parts.indexOf('typ');
    const type = typIdx >= 0 ? parts[typIdx + 1] : '';
    return c.blockCandidateTypes.includes(type) || c.blockProtocols.includes(protocol);
  }

  function result(id: number, ok: boolean, message?: string) {
    // Command results bypass the attach check: commands only come from an attached panel.
    queue.push({ t: 'command-result', id, ok, message });
    if (!flushScheduled) {
      flushScheduled = true;
      nativeSetTimeout(flush, FLUSH_DELAY);
    }
  }

  function runCommand(cmd: PageCommand, id: number) {
    if (cmd.op === 'preview') {
      if (!cmd.enabled) stopPreview();
      else startPreview(cmd.pcId);
      return result(id, true);
    }
    const entry = pcs.get(cmd.pcId);
    const pc = entry?.ref.deref();
    if (!entry || !pc) return result(id, false, 'Connection not found in this frame');
    const note = (value: unknown) => record(entry, { kind: 'note', name: 'devtools.action', value });
    try {
      switch (cmd.op) {
        case 'expose': {
          (w as any)[cmd.name] = pc;
          console.info(`%c[WebRTC DevTools]%c ${cmd.name} =`, 'color:#2080f0;font-weight:bold', '', pc);
          return result(id, true, `Available in the console as ${cmd.name}`);
        }
        case 'restartIce':
          note('restartIce()');
          pc.restartIce();
          return result(id, true, 'ICE restart requested (the app must renegotiate)');
        case 'close':
          note('close()');
          pc.close();
          return result(id, true, 'Connection closed');
        case 'maxBitrate': {
          note({ maxBitrate: cmd.bps, kind: cmd.kind });
          const senders = nativeGetSenders!.call(pc).filter((s: RTCRtpSender) => s.track?.kind === cmd.kind);
          Promise.all(
            senders.map((s: RTCRtpSender) => {
              const params = s.getParameters();
              for (const enc of params.encodings ?? []) {
                if (cmd.bps === null) delete enc.maxBitrate;
                else enc.maxBitrate = cmd.bps;
              }
              return s.setParameters(params);
            })
          ).then(
            () => result(id, true, `${senders.length} ${cmd.kind} sender(s) updated`),
            (e) => result(id, false, errorInfo(e).message)
          );
          return;
        }
        case 'trackEnabled': {
          note({ trackEnabled: cmd.enabled, kind: cmd.kind });
          let n = 0;
          for (const s of nativeGetSenders!.call(pc) as RTCRtpSender[]) {
            if (s.track?.kind === cmd.kind) {
              s.track.enabled = cmd.enabled;
              n++;
            }
          }
          return result(id, true, `${n} ${cmd.kind} track(s) ${cmd.enabled ? 'enabled' : 'disabled'}`);
        }
      }
    } catch (e) {
      return result(id, false, errorInfo(e).message);
    }
  }

  // ---- video previews (only while the panel asks for them) ----------------------------
  function startPreview(pcId: string | null) {
    previewTarget = pcId;
    if (previewTimer) return;
    previewTimer = nativeSetInterval(capturePreviews, 1000);
    capturePreviews();
  }

  function stopPreview() {
    previewTarget = undefined;
    if (previewTimer) nativeClearInterval(previewTimer);
    previewTimer = null;
  }

  async function grab(track: MediaStreamTrack): Promise<{ dataUrl: string; width: number; height: number } | null> {
    if (!NativeImageCapture || !NativeOffscreenCanvas || track.readyState !== 'live') return null;
    try {
      const bitmap: ImageBitmap = await new NativeImageCapture(track).grabFrame();
      const width = 192;
      const height = Math.max(1, Math.round((bitmap.height / bitmap.width) * width));
      const canvas = new NativeOffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob: Blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      return { dataUrl, width: track.getSettings().width ?? 0, height: track.getSettings().height ?? 0 };
    } catch {
      return null;
    }
  }

  async function capturePreviews() {
    if (!attached || previewTarget === undefined) return;
    const jobs: Promise<VideoPreview | null>[] = [];
    for (const entry of pcs.values()) {
      if (entry.closed || entry.collected || (previewTarget !== null && entry.info.id !== previewTarget)) continue;
      const pc = entry.ref.deref();
      if (!pc) continue;
      const tracks: [MediaStreamTrack, 'send' | 'recv'][] = [];
      for (const s of nativeGetSenders!.call(pc) as RTCRtpSender[]) if (s.track?.kind === 'video') tracks.push([s.track, 'send']);
      for (const r of nativeGetReceivers!.call(pc) as RTCRtpReceiver[]) if (r.track?.kind === 'video') tracks.push([r.track, 'recv']);
      for (const [track, direction] of tracks) {
        jobs.push(grab(track).then((f) => (f ? { pcId: entry.info.id, trackId: track.id, direction, ts: nativeNow(), ...f } : null)));
      }
    }
    const frames = (await Promise.all(jobs)).filter((f): f is VideoPreview => !!f);
    if (frames.length) emit({ t: 'previews', frames });
  }

  function startStats() {
    if (statsTimer) nativeClearInterval(statsTimer);
    statsTimer = nativeSetInterval(pollStats, Math.max(250, settings.statsInterval));
    pollStats();
  }

  // ---- getUserMedia / getDisplayMedia ------------------------------------------------
  const MediaDevicesP = anyWin.MediaDevices?.prototype;
  let mediaSeq = 0;
  function wrapMedia(api: MediaCall['api']) {
    if (!MediaDevicesP) return;
    const desc = Object.getOwnPropertyDescriptor(MediaDevicesP, api);
    if (!desc || typeof desc.value !== 'function') return;
    const proxy = new Proxy(desc.value, {
      apply(target, self, args: any[]) {
        let call: MediaCall | undefined;
        const t0 = perfNow();
        try {
          call = {
            seq: ++mediaSeq,
            ts: nativeNow(),
            api,
            constraints: api === 'enumerateDevices' ? undefined : serialize(args[0]),
            pending: true,
            stack: captureStack(),
            url: location.href
          };
          mediaCalls.push(call);
          if (mediaCalls.length > MAX_MEDIA_CALLS) mediaCalls.splice(0, 50);
          emit({ t: 'media', call });
          if (api !== 'enumerateDevices') signalActivity();
        } catch {
          call = undefined;
        }
        const ret: any = Reflect.apply(target, self, args);
        if (call && ret && typeof ret.then === 'function') {
          const c = call;
          const finish = (patch: Partial<MediaCall>) => {
            try {
              patch.duration = Math.round(perfNow() - t0);
              patch.pending = false;
              Object.assign(c, patch);
              emit({ t: 'media-end', seq: c.seq, patch });
            } catch {
              /* ignore */
            }
          };
          ret.then(
            (v: any) => {
              if (api === 'enumerateDevices') {
                finish({ result: { devices: serialize(v) } });
                return;
              }
              const tracks: MediaStreamTrack[] = v?.getTracks?.() ?? [];
              tracks.forEach(watchTrack);
              finish({ result: { streamId: v?.id, tracks: tracks.map(trackInfo) } });
            },
            (err: any) => finish({ error: errorInfo(err) })
          );
        }
        return ret;
      }
    });
    try {
      Object.defineProperty(MediaDevicesP, api, { ...desc, value: proxy });
    } catch {
      /* ignore */
    }
  }
  wrapMedia('getUserMedia');
  wrapMedia('getDisplayMedia');
  wrapMedia('enumerateDevices');

  const TrackP = anyWin.MediaStreamTrack?.prototype;
  if (TrackP) {
    const desc = Object.getOwnPropertyDescriptor(TrackP, 'stop');
    if (desc && typeof desc.value === 'function') {
      const stopProxy = new Proxy(desc.value, {
        apply(target, self, args: any[]) {
          try {
            if (knownTracks.has(self) && self.readyState !== 'ended') {
              pushTrackEvent({ ts: nativeNow(), trackId: self.id, kind: self.kind, event: 'stop' });
            }
          } catch {
            /* ignore */
          }
          return Reflect.apply(target, self, args);
        }
      });
      try {
        Object.defineProperty(TrackP, 'stop', { ...desc, value: stopProxy });
      } catch {
        /* ignore */
      }
    }
  }
}
