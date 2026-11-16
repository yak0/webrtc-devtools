import { markRaw, reactive, shallowReactive } from 'vue';
import type {
  BackgroundToPanel,
  DataChannelInfo,
  DataChannelMessage,
  MediaCall,
  PageCommand,
  PageEnv,
  PageMessage,
  PcInfo,
  PanelToBackground,
  VideoPreview,
  PcSnapshot,
  PcStates,
  TraceEvent,
  TrackEvent
} from '@/shared/protocol';
import { StatsTimeline } from '../lib/stats-timeline';

const MAX_EVENTS = 20_000;
const MAX_DC_MESSAGES = 5_000;

export interface DcModel extends DataChannelInfo {
  messagesSent: number;
  messagesReceived: number;
  bytesSent: number;
  bytesReceived: number;
}

/**
 * One RTCPeerConnection. The model object is shallow-reactive: arrays/maps inside are
 * mutated in place for speed and `rev` / `statsRev` / `dcRev` are bumped so views recompute.
 */
export interface PcModel {
  id: string;
  index: number;
  frameId: number;
  frameUrl: string;
  info: PcInfo;
  states: PcStates;
  events: TraceEvent[];
  droppedEvents: number;
  closed: boolean;
  collected: boolean;
  /** Belongs to a page that was navigated away from (kept by "Preserve log"). */
  stale: boolean;
  imported: boolean;
  /** File name when appended from an import for comparison. */
  importedFrom?: string;
  stats: StatsTimeline;
  dataChannels: Map<string, DcModel>;
  dcMessages: DataChannelMessage[];
  dcDropped: number;
  rev: number;
  statsRev: number;
  dcRev: number;
}

export const session = reactive({
  pcs: shallowReactive<PcModel[]>([]),
  media: shallowReactive<MediaCall[]>([]),
  trackEvents: shallowReactive<TrackEvent[]>([]),
  mediaRev: 0,
  selected: null as string | null,
  /** 'media' selects the getUserMedia view instead of a connection. */
  view: 'pc' as 'pc' | 'media' | 'tools' | 'compare',
  pageUrl: '',
  userAgent: '',
  connected: false,
  imported: false,
  importedName: '',
  /** SDK globals found per frame. */
  envByFrame: {} as Record<number, PageEnv>,
  previews: shallowReactive(new Map<string, VideoPreview>()),
  previewRev: 0,
  /** Badge/insight counts per connection, filled by the insights watcher. */
  problems: {} as Record<string, { errors: number; warnings: number }>
});

// ---- commands to the page ------------------------------------------------------------
let sendToBackground: ((msg: PanelToBackground) => void) | null = null;
let commandSeq = 0;
const pendingCommands = new Map<number, (r: { ok: boolean; message?: string }) => void>();

export function setCommandSender(fn: (msg: PanelToBackground) => void) {
  sendToBackground = fn;
}

export function sendCommand(frameId: number, command: PageCommand, timeoutMs = 5000): Promise<{ ok: boolean; message?: string }> {
  if (!sendToBackground) return Promise.resolve({ ok: false, message: 'Not connected' });
  const id = ++commandSeq;
  return new Promise((resolve) => {
    pendingCommands.set(id, resolve);
    sendToBackground!({ type: 'command', frameId, id, command });
    setTimeout(() => {
      if (pendingCommands.delete(id)) resolve({ ok: false, message: 'No answer from the page (frame gone or reloaded?)' });
    }, timeoutMs);
  });
}

const byId = new Map<string, PcModel>();

export function getPc(id: string | null): PcModel | undefined {
  return id ? byId.get(id) : undefined;
}

function emptyStates(): PcStates {
  return { connectionState: 'new', iceConnectionState: 'new', iceGatheringState: 'new', signalingState: 'stable' };
}

export function createPcModel(info: PcInfo, frameId = 0, frameUrl = ''): PcModel {
  return shallowReactive({
    id: info.id,
    index: info.index,
    frameId,
    frameUrl: frameUrl || info.url,
    info,
    states: emptyStates(),
    events: markRaw([] as TraceEvent[]),
    droppedEvents: 0,
    closed: false,
    collected: false,
    stale: false,
    imported: false,
    stats: markRaw(new StatsTimeline()),
    dataChannels: markRaw(new Map<string, DcModel>()),
    dcMessages: markRaw([] as DataChannelMessage[]),
    dcDropped: 0,
    rev: 0,
    statsRev: 0,
    dcRev: 0
  }) as PcModel;
}

export function addPc(model: PcModel) {
  byId.set(model.id, model);
  session.pcs.push(model);
  if (!session.selected) session.selected = model.id;
}

function upsertSnapshot(s: PcSnapshot, frameId: number, frameUrl: string): PcModel {
  let pc = byId.get(s.info.id);
  if (!pc) {
    pc = createPcModel(s.info, frameId, frameUrl);
    addPc(pc);
  }
  pc.info = s.info;
  pc.states = s.states;
  // The page keeps the authoritative trace: replace ours (handles reconnects without duplicates).
  pc.events = markRaw(s.events.slice());
  pc.droppedEvents = s.droppedEvents;
  pc.closed = s.closed;
  pc.collected = s.collected;
  for (const dc of s.dataChannels) upsertDc(pc, dc);
  pc.rev++;
  return pc;
}

function upsertDc(pc: PcModel, dc: DataChannelInfo) {
  const existing = pc.dataChannels.get(dc.key);
  if (existing) Object.assign(existing, dc);
  else pc.dataChannels.set(dc.key, { ...dc, messagesSent: 0, messagesReceived: 0, bytesSent: 0, bytesReceived: 0 });
  pc.dcRev++;
}

function findEvent(pc: PcModel, seq: number): TraceEvent | undefined {
  const ev = pc.events;
  for (let i = ev.length - 1; i >= 0 && i >= ev.length - 2000; i--) if (ev[i].seq === seq) return ev[i];
  return ev.find((e) => e.seq === seq);
}

export function applyPageMessage(msg: PageMessage, frameId: number, frameUrl: string) {
  switch (msg.t) {
    case 'snapshot': {
      const snap = msg.snapshot;
      if (frameId === 0 || !session.pageUrl) {
        session.pageUrl = snap.url;
        session.userAgent = snap.userAgent;
      }
      if (snap.env) session.envByFrame = { ...session.envByFrame, [frameId]: snap.env };
      for (const s of snap.pcs) upsertSnapshot(s, frameId, frameUrl || snap.url);
      mergeMedia(snap.media, snap.trackEvents);
      break;
    }
    case 'pc-new':
      upsertSnapshot(msg.pc, frameId, frameUrl);
      break;
    case 'pc-event': {
      const pc = byId.get(msg.id);
      if (!pc) return;
      if (!findEvent(pc, msg.ev.seq)) {
        pc.events.push(msg.ev);
        if (pc.events.length > MAX_EVENTS) {
          pc.events.splice(0, 1000);
          pc.droppedEvents += 1000;
        }
      }
      if (msg.states) pc.states = msg.states;
      pc.rev++;
      break;
    }
    case 'pc-call-end': {
      const pc = byId.get(msg.id);
      if (!pc) return;
      const ev = findEvent(pc, msg.end.seq);
      if (ev) {
        ev.pending = false;
        ev.duration = msg.end.duration;
        ev.result = msg.end.result;
        ev.error = msg.end.error;
      }
      if (msg.states) pc.states = msg.states;
      pc.rev++;
      break;
    }
    case 'pc-gone': {
      const pc = byId.get(msg.id);
      if (!pc) return;
      if (msg.reason === 'closed') pc.closed = true;
      else pc.collected = true;
      if (msg.reason === 'closed') pc.states = { ...pc.states, connectionState: 'closed', signalingState: 'closed' };
      pc.rev++;
      break;
    }
    case 'stats': {
      const pc = byId.get(msg.id);
      if (!pc) return;
      pc.stats.apply(msg.delta);
      pc.statsRev++;
      break;
    }
    case 'media': {
      const existing = session.media.findIndex((m) => m.seq === msg.call.seq && m.url === msg.call.url);
      if (existing === -1) session.media.push(msg.call);
      session.mediaRev++;
      break;
    }
    case 'media-end': {
      const call = [...session.media].reverse().find((m) => m.seq === msg.seq);
      if (call) Object.assign(call, msg.patch);
      session.mediaRev++;
      break;
    }
    case 'track-event':
      session.trackEvents.push(msg.ev);
      session.mediaRev++;
      break;
    case 'env':
      session.envByFrame = { ...session.envByFrame, [frameId]: msg.env };
      break;
    case 'previews':
      for (const f of msg.frames) {
        // The URL comes from the page: only accept inline images, never a remote address.
        if (typeof f?.dataUrl === 'string' && f.dataUrl.startsWith('data:image/jpeg;base64,')) session.previews.set(String(f.trackId), f);
      }
      session.previewRev++;
      break;
    case 'command-result': {
      const resolve = pendingCommands.get(msg.id);
      pendingCommands.delete(msg.id);
      resolve?.({ ok: msg.ok, message: msg.message });
      break;
    }
    case 'dc-open': {
      const pc = byId.get(msg.dc.pcId);
      if (pc) upsertDc(pc, msg.dc);
      break;
    }
    case 'dc-state': {
      const pc = byId.get(msg.pcId);
      const dc = pc?.dataChannels.get(msg.key);
      if (pc && dc) {
        dc.readyState = msg.readyState;
        dc.id = msg.id ?? dc.id;
        pc.dcRev++;
      }
      break;
    }
    case 'dc-messages': {
      const pc = byId.get(msg.pcId);
      if (!pc) return;
      for (const m of msg.messages) {
        const dc = pc.dataChannels.get(m.key);
        if (dc) {
          if (m.direction === 'sent') {
            dc.messagesSent++;
            dc.bytesSent += m.size;
          } else {
            dc.messagesReceived++;
            dc.bytesReceived += m.size;
          }
        }
        pc.dcMessages.push(m);
      }
      if (pc.dcMessages.length > MAX_DC_MESSAGES) pc.dcMessages.splice(0, pc.dcMessages.length - MAX_DC_MESSAGES);
      pc.dcDropped += msg.dropped;
      pc.dcRev++;
      break;
    }
  }
}

function mergeMedia(media: MediaCall[], trackEvents: TrackEvent[]) {
  for (const call of media) {
    const i = session.media.findIndex((m) => m.seq === call.seq && m.url === call.url);
    if (i === -1) session.media.push(call);
    else session.media[i] = call;
  }
  const seen = new Set(session.trackEvents.map((e) => `${e.ts}:${e.trackId}:${e.event}`));
  for (const e of trackEvents) if (!seen.has(`${e.ts}:${e.trackId}:${e.event}`)) session.trackEvents.push(e);
  session.mediaRev++;
}

export function applyBackgroundMessage(msg: BackgroundToPanel) {
  if (msg.type === 'batch') {
    for (const m of msg.batch) {
      // Viewing an imported dump replaces the live view; command results still matter.
      if (session.imported && m.t !== 'command-result') continue;
      try {
        applyPageMessage(m, msg.frameId, msg.frameUrl);
      } catch (err) {
        // Messages originate in the inspected page; a malformed one must not stop the rest.
        console.warn('[WebRTC DevTools] ignored malformed message', m?.t, err);
      }
    }
  }
}

/** Appends imported connections next to the live ones (used to compare sessions). */
export function appendModels(models: PcModel[], label: string) {
  for (const m of models) {
    m.id = `${label}:${m.id}`;
    m.info = { ...m.info, id: m.id };
    m.importedFrom = label;
    addPc(m);
  }
}

export function clearSession() {
  byId.clear();
  session.pcs.splice(0);
  session.media.splice(0);
  session.trackEvents.splice(0);
  session.selected = null;
  session.view = 'pc';
  session.mediaRev++;
  session.envByFrame = {};
  session.previews.clear();
  session.problems = {};
  session.imported = false;
  session.importedName = '';
}

/** Called when the inspected page navigates. */
export function onNavigated(preserve: boolean, url: string) {
  if (session.imported) return;
  if (!preserve) {
    clearSession();
  } else {
    for (const pc of session.pcs) {
      if (!pc.stale) {
        pc.stale = true;
        pc.rev++;
      }
    }
  }
  session.pageUrl = url;
}

export function loadModels(
  models: PcModel[],
  media: MediaCall[],
  trackEvents: TrackEvent[],
  meta: { name: string; url?: string; userAgent?: string; env?: Record<number, PageEnv> }
) {
  clearSession();
  session.imported = true;
  session.importedName = meta.name;
  session.pageUrl = meta.url ?? '';
  session.userAgent = meta.userAgent ?? '';
  session.envByFrame = meta.env ?? {};
  for (const m of models) addPc(m);
  session.media.push(...media);
  session.trackEvents.push(...trackEvents);
  session.mediaRev++;
  session.selected = models[0]?.id ?? null;
}
