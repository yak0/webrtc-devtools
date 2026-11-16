// Messages exchanged between the page (injected collector), the content script,
// the background service worker and the DevTools panel.

// Page <-> content script traffic uses CustomEvents carrying JSON strings on `window`
// (instead of window.postMessage) so the inspected app's own "message" listeners never see it.
export const PAGE_EVENT = '__webrtc_devtools_page__';
export const CONTENT_EVENT = '__webrtc_devtools_content__';
export const PANEL_PORT_PREFIX = 'wrd-panel:';
export const CONTENT_PORT_NAME = 'wrd-content';
/** chrome.storage.local key: origins where stats are recorded from page load. */
export const RECORD_ORIGINS_KEY = 'recordOrigins';

export type JsonValue = unknown;

export interface PcStates {
  connectionState: string;
  iceConnectionState: string;
  iceGatheringState: string;
  signalingState: string;
}

export interface PcInfo {
  id: string;
  /** Sequential number inside the page, used for display ("PC 3"). */
  index: number;
  createdAt: number;
  url: string;
  /** Configuration passed to the constructor (credentials masked). */
  config: JsonValue;
  /** pc.getConfiguration() right after construction (defaults filled in, credentials masked). */
  effectiveConfig: JsonValue;
  /** Legacy second constructor argument, if any. */
  constraints?: JsonValue;
  stack?: string;
}

export type TraceKind = 'event' | 'call' | 'note';

export interface TraceEvent {
  seq: number;
  ts: number;
  kind: TraceKind;
  /** Event name ("icecandidate") or method name ("setLocalDescription"). */
  name: string;
  /** For events: interesting value (new state, candidate...). */
  value?: JsonValue;
  /** For calls: serialized arguments. */
  args?: JsonValue;
  /** For calls: serialized resolved value. */
  result?: JsonValue;
  error?: { name: string; message: string };
  /** For calls: ms until the returned promise settled (undefined while pending). */
  duration?: number;
  pending?: boolean;
  stack?: string;
  /** Target object for calls on senders/transceivers/data channels. */
  target?: string;
}

export interface CallEnd {
  seq: number;
  duration: number;
  result?: JsonValue;
  error?: { name: string; message: string };
}

export interface StatsDelta {
  /** Date.now() when the report was taken. */
  ts: number;
  /** True when `changed` contains complete objects (first report after attach). */
  full: boolean;
  changed: Record<string, Record<string, unknown>>;
  removed: string[];
}

export interface MediaCall {
  seq: number;
  ts: number;
  api: 'getUserMedia' | 'getDisplayMedia' | 'enumerateDevices';
  constraints?: JsonValue;
  duration?: number;
  pending?: boolean;
  result?: {
    streamId?: string;
    tracks?: TrackInfo[];
    devices?: JsonValue;
  };
  error?: { name: string; message: string; constraint?: string };
  stack?: string;
  url: string;
}

export interface TrackInfo {
  id: string;
  kind: string;
  label: string;
  readyState?: string;
  muted?: boolean;
  enabled?: boolean;
  settings?: JsonValue;
}

export interface TrackEvent {
  ts: number;
  trackId: string;
  kind: string;
  event: 'ended' | 'mute' | 'unmute' | 'stop';
}

export interface DataChannelInfo {
  pcId: string;
  key: string;
  label: string;
  id: number | null;
  protocol: string;
  ordered: boolean;
  negotiated: boolean;
  maxRetransmits: number | null;
  maxPacketLifeTime: number | null;
  origin: 'local' | 'remote';
  readyState: string;
}

export interface DataChannelMessage {
  ts: number;
  key: string;
  direction: 'sent' | 'received';
  size: number;
  binary: boolean;
  /** Text preview (truncated) or hex dump of the first bytes for binary data. */
  preview: string;
  truncated: boolean;
}

export interface PcSnapshot {
  info: PcInfo;
  states: PcStates;
  events: TraceEvent[];
  droppedEvents: number;
  closed: boolean;
  collected: boolean;
  dataChannels: DataChannelInfo[];
}

/** Page-level facts used for SDK detection (globals exposed by known WebRTC SDKs). */
export interface PageEnv {
  sdks: { name: string; version?: string; global: string }[];
}

export interface VideoPreview {
  pcId: string;
  trackId: string;
  direction: 'send' | 'recv';
  dataUrl: string;
  width: number;
  height: number;
  ts: number;
}

/** Fault injection ("chaos mode"). Applied inside the page by the collector. */
export interface ChaosSettings {
  /** Candidate types to drop: host, srflx, prflx, relay. */
  blockCandidateTypes: string[];
  /** Transport protocols to drop: udp, tcp. */
  blockProtocols: string[];
  /** Delay before remote candidates are passed to addIceCandidate(). */
  candidateDelayMs: number;
  /** 0..1 share of outgoing data channel messages silently dropped. */
  dcDropRate: number;
  /** Force iceTransportPolicy "relay" on connections created from now on. */
  forceRelay: boolean;
}

export const NO_CHAOS: ChaosSettings = {
  blockCandidateTypes: [],
  blockProtocols: [],
  candidateDelayMs: 0,
  dcDropRate: 0,
  forceRelay: false
};

export function chaosActive(c: ChaosSettings | undefined): boolean {
  return !!c && (c.blockCandidateTypes.length > 0 || c.blockProtocols.length > 0 || c.candidateDelayMs > 0 || c.dcDropRate > 0 || c.forceRelay);
}

/** Commands sent from the panel to the collector of one frame. */
export type PageCommand =
  | { op: 'expose'; pcId: string; name: string }
  | { op: 'restartIce'; pcId: string }
  | { op: 'close'; pcId: string }
  | { op: 'maxBitrate'; pcId: string; kind: 'audio' | 'video'; bps: number | null }
  | { op: 'trackEnabled'; pcId: string; kind: 'audio' | 'video'; enabled: boolean }
  /** pcId null = every connection of the frame. */
  | { op: 'preview'; pcId: string | null; enabled: boolean };

export interface PageSnapshot {
  url: string;
  userAgent: string;
  env: PageEnv;
  pcs: PcSnapshot[];
  media: MediaCall[];
  trackEvents: TrackEvent[];
}

/** Messages produced by the injected collector. */
export type PageMessage =
  | { t: 'snapshot'; snapshot: PageSnapshot }
  | { t: 'pc-new'; pc: PcSnapshot }
  | { t: 'pc-event'; id: string; ev: TraceEvent; states?: PcStates }
  | { t: 'pc-call-end'; id: string; end: CallEnd; states?: PcStates }
  | { t: 'pc-gone'; id: string; reason: 'closed' | 'collected' }
  | { t: 'stats'; id: string; delta: StatsDelta }
  | { t: 'media'; call: MediaCall }
  | { t: 'media-end'; seq: number; patch: Partial<MediaCall> }
  | { t: 'track-event'; ev: TrackEvent }
  | { t: 'dc-open'; dc: DataChannelInfo }
  | { t: 'dc-state'; key: string; pcId: string; readyState: string; id: number | null }
  | { t: 'dc-messages'; pcId: string; messages: DataChannelMessage[]; dropped: number }
  | { t: 'env'; env: PageEnv }
  | { t: 'previews'; frames: VideoPreview[] }
  | { t: 'command-result'; id: number; ok: boolean; message?: string };

export interface CollectorSettings {
  statsInterval: number;
  captureDataChannelMessages: boolean;
  captureStacks: boolean;
  chaos: ChaosSettings;
}

export const DEFAULT_SETTINGS: CollectorSettings = {
  statsInterval: 1000,
  captureDataChannelMessages: true,
  captureStacks: true,
  chaos: NO_CHAOS
};

/** CustomEvent detail (JSON) page -> content. */
export interface PageEnvelope {
  /** First RTCPeerConnection / getUserMedia seen on the page (sent even while detached). */
  activity?: true;
  /** Open RTCPeerConnections in this frame (sent even while detached, for the badge and popup). */
  pcSummary?: PcBrief[];
  batch?: PageMessage[];
}

/** CustomEvent detail (JSON) content -> page. */
export interface ContentEnvelope {
  /** 'hello' asks the page to repeat its activity signal. */
  cmd: 'attach' | 'detach' | 'settings' | 'hello' | 'command' | 'record';
  settings?: CollectorSettings;
  command?: PageCommand;
  commandId?: number;
  /** For 'record': keep polling getStats while no panel is attached (opt-in per origin). */
  record?: boolean;
}

/** Content port -> background. */
export interface ContentToBackground {
  type: 'batch';
  batch: PageMessage[];
}

/** Background -> panel port. */
export type BackgroundToPanel =
  | { type: 'batch'; frameId: number; frameUrl: string; batch: PageMessage[] }
  | { type: 'frame-detached'; frameId: number };

/** Panel port -> background. */
export type PanelToBackground =
  | { type: 'settings'; settings: CollectorSettings }
  | { type: 'reattach' }
  | { type: 'command'; frameId: number; id: number; command: PageCommand }
  /** Health of the inspected tab as computed by the panel's insights; colors the badge. */
  | { type: 'badge'; level: BadgeLevel };

export type BadgeLevel = 'error' | 'warning' | 'ok';

/** Background -> content via chrome.tabs.sendMessage. */
export type BackgroundToContent =
  | { type: 'wrd:attach'; settings: CollectorSettings }
  | { type: 'wrd:detach' }
  | { type: 'wrd:settings'; settings: CollectorSettings }
  | { type: 'wrd:command'; id: number; command: PageCommand }
  /** Report the open connections again (the background reset its count). */
  | { type: 'wrd:recount' };

/** Content -> background via chrome.runtime.sendMessage. */
export interface ContentHello {
  type: 'wrd:hello';
}

/** Minimal per-connection info shown in the toolbar popup. */
export interface PcBrief {
  index: number;
  state: string;
}

/** Content -> background: open RTCPeerConnections in the sender frame. */
export interface ContentCount {
  type: 'wrd:count';
  pcs: PcBrief[];
}

/** Popup -> background. */
export interface PopupInfoRequest {
  type: 'wrd:popup-info';
  tabId: number;
}
export interface PopupInfo {
  frames: { frameId: number; pcs: PcBrief[] }[];
  /** Only known while a DevTools panel is open for the tab. */
  level: BadgeLevel | null;
  panelOpen: boolean;
}
export interface HelloReply {
  attach: boolean;
  settings: CollectorSettings;
}
