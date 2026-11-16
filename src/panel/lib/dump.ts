// Export of the current session, and import of our own dumps or chrome://webrtc-internals dumps.
import type { DataChannelMessage, MediaCall, PageEnv, PcInfo, PcStates, TraceEvent, TrackEvent } from '@/shared/protocol';
import { createPcModel, type DcModel, type PcModel } from '../store/session';
import { StatsTimeline, type Series, type StatsObject } from './stats-timeline';

export const DUMP_FORMAT = 'webrtc-devtools-dump';

export interface DevtoolsDump {
  format: typeof DUMP_FORMAT;
  version: 1;
  exportedAt: number;
  url: string;
  userAgent: string;
  /** SDK globals per frame (used for SDK detection when viewing the dump). */
  env?: Record<number, PageEnv>;
  pcs: {
    info: PcInfo;
    frameId?: number;
    frameUrl: string;
    states: PcStates;
    events: TraceEvent[];
    droppedEvents: number;
    closed: boolean;
    collected: boolean;
    dataChannels: DcModel[];
    dcMessages: DataChannelMessage[];
    stats: ReturnType<StatsTimeline['toJSON']>;
  }[];
  media: MediaCall[];
  trackEvents: TrackEvent[];
}

export interface ImportResult {
  kind: 'devtools' | 'webrtc-internals';
  pcs: PcModel[];
  media: MediaCall[];
  trackEvents: TrackEvent[];
  url?: string;
  userAgent?: string;
  env?: Record<number, PageEnv>;
}

export function exportSession(
  pcs: PcModel[],
  media: MediaCall[],
  trackEvents: TrackEvent[],
  url: string,
  userAgent: string,
  env: Record<number, PageEnv> = {}
): DevtoolsDump {
  return {
    format: DUMP_FORMAT,
    version: 1,
    exportedAt: Date.now(),
    url,
    userAgent,
    env,
    pcs: pcs.map((pc) => ({
      info: pc.info,
      frameId: pc.frameId,
      frameUrl: pc.frameUrl,
      states: pc.states,
      events: pc.events,
      droppedEvents: pc.droppedEvents,
      closed: pc.closed,
      collected: pc.collected,
      dataChannels: [...pc.dataChannels.values()],
      dcMessages: pc.dcMessages,
      stats: pc.stats.toJSON()
    })),
    media: [...media],
    trackEvents: [...trackEvents]
  };
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** Reads a dump file; chrome://webrtc-internals produces gzip-compressed dumps by default. */
export async function readDumpFile(file: Blob): Promise<unknown> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const text = isGzip(head)
    ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await file.text();
  return JSON.parse(text);
}

export function importDump(data: unknown): ImportResult {
  const d = data as any;
  if (d?.format === DUMP_FORMAT) return importDevtoolsDump(d as DevtoolsDump);
  if (d && typeof d === 'object' && d.PeerConnections && typeof d.PeerConnections === 'object') return importInternalsDump(d);
  throw new Error('Unrecognized file: expected a WebRTC DevTools export or a chrome://webrtc-internals dump.');
}

function importDevtoolsDump(d: DevtoolsDump): ImportResult {
  const pcs = d.pcs.map((p) => {
    const m = createPcModel(p.info, p.frameId ?? 0, p.frameUrl);
    m.states = p.states;
    m.events = p.events;
    m.droppedEvents = p.droppedEvents;
    m.closed = p.closed;
    m.collected = p.collected;
    m.imported = true;
    for (const dc of p.dataChannels) m.dataChannels.set(dc.key, dc);
    m.dcMessages = p.dcMessages;
    m.stats = StatsTimeline.from(p.stats);
    return m;
  });
  return { kind: 'devtools', pcs, media: d.media ?? [], trackEvents: d.trackEvents ?? [], url: d.url, userAgent: d.userAgent, env: d.env };
}

// ---- chrome://webrtc-internals ----------------------------------------------------------

const STATIC_TYPES = new Set(['codec', 'certificate', 'local-candidate', 'remote-candidate']);
const INTERNALS_CALLS = new Set([
  'createOffer',
  'createAnswer',
  'setLocalDescription',
  'setRemoteDescription',
  'addIceCandidate',
  'createDataChannel',
  'addTrack',
  'removeTrack',
  'addTransceiver',
  'restartIce',
  'setConfiguration',
  'close',
  'addStream',
  'removeStream'
]);

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string' || value === '') return value === '' ? undefined : value;
  try {
    return JSON.parse(value);
  } catch {
    return parseLegacyValue(value);
  }
}

/** Old dumps used "type: offer, sdp: v=0..." and "sdpMid: 0, sdpMLineIndex: 0, candidate: ..." strings. */
function parseLegacyValue(value: string): unknown {
  const sdp = /^type: (\w+), sdp: (v=0[\s\S]*)$/.exec(value);
  if (sdp) return { type: sdp[1], sdp: sdp[2] };
  const cand = /^sdpMid: ([^,]*), sdpMLineIndex: (\d+), candidate: (.*)$/.exec(value);
  if (cand) return { sdpMid: cand[1], sdpMLineIndex: Number(cand[2]), candidate: cand[3] };
  return value;
}

function entryTime(e: any, fallback: number): number {
  if (typeof e.timestamp === 'number') return e.timestamp;
  if (typeof e.time === 'number') return e.time;
  if (typeof e.time === 'string') {
    const t = Date.parse(e.time);
    if (Number.isFinite(t)) return t;
  }
  return fallback;
}

function eventName(type: string): string {
  // "onicecandidate" -> "icecandidate", "onsignalingstatechange" -> "signalingstatechange"
  return /^on[a-z]+$/.test(type) ? type.slice(2) : type;
}

function internalsEvents(updateLog: any[], base: number): TraceEvent[] {
  const events: TraceEvent[] = [];
  let seq = 0;
  updateLog.forEach((u, i) => {
    const type = String(u.type ?? '');
    const ts = entryTime(u, base + i);
    const value = parseMaybeJson(u.value);
    const done = /^(.*)On(Success|Failure)$/.exec(type);
    if (done) {
      const call = [...events].reverse().find((e) => e.kind === 'call' && e.name === done[1] && e.pending);
      if (call) {
        call.pending = false;
        call.duration = Math.max(0, Math.round((ts - call.ts) * 100) / 100);
        if (done[2] === 'Failure') {
          call.error = { name: 'Error', message: typeof value === 'string' ? value : JSON.stringify(value) };
        } else if (call.name === 'setLocalDescription' || call.name === 'setRemoteDescription') {
          const desc = Array.isArray(call.args) ? call.args[0] : undefined;
          call.result = desc ? { [call.name === 'setLocalDescription' ? 'localDescription' : 'remoteDescription']: desc } : undefined;
        } else {
          call.result = value;
        }
      }
      return;
    }
    if (INTERNALS_CALLS.has(type)) {
      events.push({ seq: ++seq, ts, kind: 'call', name: type, args: value === undefined ? [] : [value], pending: true });
      return;
    }
    const name = eventName(type);
    const kind = name !== type || /statechange$/.test(name) ? 'event' : 'note';
    events.push({ seq: ++seq, ts, kind, name, value });
  });
  // Calls without OnSuccess (e.g. addIceCandidate) are complete as far as the dump knows.
  for (const e of events) if (e.pending) e.pending = false;
  return events;
}

function finalStates(events: TraceEvent[]): PcStates {
  const s: PcStates = { connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable' };
  for (const e of events) {
    if (e.kind !== 'event' || typeof e.value !== 'string') continue;
    if (e.name === 'connectionstatechange') s.connectionState = e.value;
    else if (e.name === 'iceconnectionstatechange') s.iceConnectionState = e.value;
    else if (e.name === 'icegatheringstatechange') s.iceGatheringState = e.value;
    else if (e.name === 'signalingstatechange') s.signalingState = e.value;
  }
  return s;
}

function internalsStats(stats: Record<string, any>): StatsTimeline {
  type Raw = { id: string; field: string; type: string; t0: number; t1: number; values: unknown[] };
  const raws: Raw[] = [];
  let tMin = Infinity;
  let tMax = -Infinity;
  let step = 1000;
  for (const [key, s] of Object.entries(stats ?? {})) {
    const dash = key.lastIndexOf('-');
    if (dash <= 0) continue;
    let values: unknown[];
    try {
      values = typeof s.values === 'string' ? JSON.parse(s.values) : s.values;
    } catch {
      continue;
    }
    if (!Array.isArray(values) || values.length === 0) continue;
    const t0 = Date.parse(s.startTime);
    const t1 = Date.parse(s.endTime);
    if (!Number.isFinite(t0) || !Number.isFinite(t1)) continue;
    raws.push({ id: key.slice(0, dash), field: key.slice(dash + 1), type: String(s.statsType ?? ''), t0, t1, values });
    tMin = Math.min(tMin, t0);
    tMax = Math.max(tMax, t1);
    if (values.length > 1) step = Math.min(step, (t1 - t0) / (values.length - 1));
  }
  const current: Record<string, StatsObject> = {};
  const series: Record<string, Record<string, Series>> = {};
  if (!raws.length) return StatsTimeline.from({ current, times: [], series });

  step = Math.max(100, Math.round(step / 100) * 100);
  const count = Math.min(20_000, Math.round((tMax - tMin) / step) + 1);
  const times = Array.from({ length: count }, (_, i) => tMin + i * step);

  for (const r of raws) {
    const obj = (current[r.id] ??= { id: r.id, type: r.type });
    obj[r.field] = r.values[r.values.length - 1];
    if (r.field === 'timestamp' || STATIC_TYPES.has(r.type)) continue;
    const numeric = r.values.every((v) => typeof v === 'number' || typeof v === 'boolean' || v === null);
    if (!numeric) continue;
    const arr: Series = new Array(count).fill(null);
    const dt = r.values.length > 1 ? (r.t1 - r.t0) / (r.values.length - 1) : 0;
    r.values.forEach((v, i) => {
      const idx = Math.round((r.t0 + i * dt - tMin) / step);
      if (idx >= 0 && idx < count) arr[idx] = typeof v === 'boolean' ? (v ? 1 : 0) : (v as number | null);
    });
    (series[r.id] ??= {})[r.field] = arr;
  }
  return StatsTimeline.from({ current, times, series });
}

function internalsMedia(list: any[]): MediaCall[] {
  const calls = new Map<string, MediaCall>();
  const trackInfo = (kind: string, s: unknown) => {
    const v = parseMaybeJson(s) as any;
    return v && typeof v === 'object' ? { id: String(v.id ?? ''), kind, label: String(v.label ?? '') } : null;
  };
  for (const e of list ?? []) {
    const key = `${e.rid}:${e.request_id}`;
    let call = calls.get(key);
    if (!call) {
      call = {
        seq: calls.size + 1,
        ts: Number(e.timestamp) || 0,
        api: e.request_type === 'getDisplayMedia' ? 'getDisplayMedia' : 'getUserMedia',
        url: String(e.url ?? e.origin ?? ''),
        pending: true
      };
      calls.set(key, call);
    }
    if ('audio' in e || 'video' in e) {
      call.ts = Number(e.timestamp) || call.ts;
      call.constraints = { audio: e.audio === '' ? '(none)' : e.audio, video: e.video === '' ? '(none)' : e.video };
    }
    if (e.stream_id || e.audio_track_info || e.video_track_info) {
      call.pending = false;
      call.duration = Math.round(Number(e.timestamp) - call.ts);
      call.result = {
        streamId: e.stream_id,
        tracks: [trackInfo('audio', e.audio_track_info), trackInfo('video', e.video_track_info)].filter((t): t is NonNullable<typeof t> => !!t)
      };
    }
    if (e.error) {
      call.pending = false;
      call.duration = Math.round(Number(e.timestamp) - call.ts);
      call.error = { name: String(e.error), message: String(e.error_message ?? '') };
    }
  }
  return [...calls.values()];
}

function importInternalsDump(d: any): ImportResult {
  const pcs: PcModel[] = [];
  let index = 0;
  const base = typeof d.timestamp === 'number' ? d.timestamp : Date.now();
  for (const [key, raw] of Object.entries<any>(d.PeerConnections)) {
    const events = internalsEvents(Array.isArray(raw.updateLog) ? raw.updateLog : [], base);
    let config: unknown = raw.rtcConfiguration;
    if (typeof config === 'string') {
      try {
        config = JSON.parse(config);
      } catch {
        config = { raw: config };
      }
    }
    const info: PcInfo = {
      id: `internals-${key}`,
      index: ++index,
      createdAt: events[0]?.ts ?? base,
      url: String(raw.url ?? ''),
      config,
      effectiveConfig: config,
      constraints: raw.constraints || undefined
    };
    const m = createPcModel(info, 0, info.url);
    m.events = events;
    m.states = finalStates(events);
    m.imported = true;
    m.closed = m.states.connectionState === 'closed' || events.some((e) => e.name === 'close');
    m.stats = internalsStats(raw.stats);
    pcs.push(m);
  }
  return {
    kind: 'webrtc-internals',
    pcs,
    media: internalsMedia(d.getUserMedia),
    trackEvents: [],
    url: pcs[0]?.info.url,
    userAgent: d.UserAgent
  };
}
