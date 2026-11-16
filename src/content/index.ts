// Isolated-world relay: page CustomEvents <-> extension background port.
// It only wakes the service worker when the page actually uses WebRTC
// (or a DevTools panel explicitly asks to attach), so ordinary pages cost nothing.
import {
  CONTENT_EVENT,
  CONTENT_PORT_NAME,
  PAGE_EVENT,
  RECORD_ORIGINS_KEY,
  type BackgroundToContent,
  type CollectorSettings,
  type ContentEnvelope,
  type ContentCount,
  type PcBrief,
  type ContentToBackground,
  type HelloReply,
  type PageEnvelope
} from '../shared/protocol';

let port: chrome.runtime.Port | null = null;
let helloSent = false;
/** Did this frame create an RTCPeerConnection / call getUserMedia? Frames without WebRTC never connect. */
let activitySeen = false;

function toPage(msg: ContentEnvelope) {
  window.dispatchEvent(new CustomEvent(CONTENT_EVENT, { detail: JSON.stringify(msg) }));
}

function attach(settings: CollectorSettings) {
  if (!port) {
    try {
      port = chrome.runtime.connect({ name: CONTENT_PORT_NAME });
    } catch {
      return; // extension was reloaded/uninstalled; this content script is orphaned
    }
    port.onDisconnect.addListener(() => {
      port = null;
      toPage({ cmd: 'detach' });
    });
  }
  toPage({ cmd: 'attach', settings });
}

function detach() {
  toPage({ cmd: 'detach' });
  port?.disconnect();
  port = null;
}

// ---- toolbar badge / popup: open connections in this frame (debounced) ----
let reported = '[]';
let pending: PcBrief[] | null = null;
let countTimer: ReturnType<typeof setTimeout> | null = null;
function reportCount(pcs: PcBrief[]) {
  pending = pcs;
  if (countTimer) return;
  countTimer = setTimeout(() => {
    countTimer = null;
    const key = JSON.stringify(pending);
    if (!pending || key === reported) return;
    reported = key;
    chrome.runtime.sendMessage({ type: 'wrd:count', pcs: pending } satisfies ContentCount).catch(() => {});
  }, 300);
}
// The document is going away (navigation, frame removed): its connections are gone too.
window.addEventListener('pagehide', () => {
  if (reported !== '[]') chrome.runtime.sendMessage({ type: 'wrd:count', pcs: [] } satisfies ContentCount).catch(() => {});
  reported = '[]';
});

window.addEventListener(PAGE_EVENT, (e) => {
  const detail = (e as CustomEvent).detail;
  if (typeof detail !== 'string') return;
  let msg: PageEnvelope;
  try {
    msg = JSON.parse(detail);
  } catch {
    return;
  }
  if (msg.activity) activitySeen = true;
  if (Array.isArray(msg.pcSummary)) reportCount(msg.pcSummary);
  if (msg.activity && !helloSent && !port) {
    helloSent = true;
    chrome.runtime
      .sendMessage({ type: 'wrd:hello' })
      .then((reply: HelloReply | undefined) => {
        if (reply?.attach) attach(reply.settings);
      })
      .catch(() => {});
  }
  if (msg.batch && port) {
    try {
      port.postMessage({ type: 'batch', batch: msg.batch } satisfies ContentToBackground);
    } catch {
      port = null;
    }
  }
});

chrome.runtime.onMessage.addListener((msg: BackgroundToContent) => {
  switch (msg?.type) {
    case 'wrd:attach':
      if (activitySeen) attach(msg.settings);
      break;
    case 'wrd:detach':
      detach();
      break;
    case 'wrd:settings':
      toPage({ cmd: 'settings', settings: msg.settings });
      break;
    case 'wrd:command':
      toPage({ cmd: 'command', command: msg.command, commandId: msg.id });
      break;
    case 'wrd:recount':
      reported = '[]';
      toPage({ cmd: 'hello' });
      break;
  }
});

// In case the page already used WebRTC before this script's listener was registered.
toPage({ cmd: 'hello' });

// Opt-in per origin: keep collecting stats from page load, before DevTools is opened.
chrome.storage?.local
  .get(RECORD_ORIGINS_KEY)
  .then((v) => {
    const origins = (v?.[RECORD_ORIGINS_KEY] ?? []) as string[];
    if (origins.includes(location.origin)) toPage({ cmd: 'record', record: true });
  })
  .catch(() => {});
