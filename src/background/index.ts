// Routes data between content scripts (one port per frame) and DevTools panels (one port per inspected tab).
// All state is in memory: if the service worker restarts, ports disconnect and both sides reconnect.
import {
  CONTENT_PORT_NAME,
  DEFAULT_SETTINGS,
  PANEL_PORT_PREFIX,
  type BackgroundToContent,
  type BackgroundToPanel,
  type CollectorSettings,
  type ContentToBackground,
  type HelloReply,
  type PanelToBackground,
  type PcBrief
} from '../shared/protocol';
import { forgetTab, popupInfo, resetTab, setFrameCount, setLevel } from './badge';

const panels = new Map<number, Set<chrome.runtime.Port>>();
const contents = new Map<number, Set<chrome.runtime.Port>>();
const settingsByTab = new Map<number, CollectorSettings>();

function settingsFor(tabId: number): CollectorSettings {
  return settingsByTab.get(tabId) ?? DEFAULT_SETTINGS;
}

function toPanels(tabId: number, msg: BackgroundToPanel) {
  for (const p of panels.get(tabId) ?? []) {
    try {
      p.postMessage(msg);
    } catch {
      /* port closed */
    }
  }
}

function sendToTab(tabId: number, msg: BackgroundToContent) {
  // Without frameId this reaches every frame of the tab that has our content script.
  chrome.tabs.sendMessage(tabId, msg).catch(() => {});
}

function onPanelConnect(port: chrome.runtime.Port, tabId: number) {
  let set = panels.get(tabId);
  if (!set) panels.set(tabId, (set = new Set()));
  set.add(port);
  sendToTab(tabId, { type: 'wrd:attach', settings: settingsFor(tabId) });

  port.onMessage.addListener((msg: PanelToBackground) => {
    if (msg.type === 'settings') {
      settingsByTab.set(tabId, msg.settings);
      sendToTab(tabId, { type: 'wrd:settings', settings: msg.settings });
    } else if (msg.type === 'reattach') {
      sendToTab(tabId, { type: 'wrd:attach', settings: settingsFor(tabId) });
    } else if (msg.type === 'command') {
      chrome.tabs
        .sendMessage(tabId, { type: 'wrd:command', id: msg.id, command: msg.command } satisfies BackgroundToContent, { frameId: msg.frameId })
        .catch(() => {});
    } else if (msg.type === 'badge') {
      setLevel(tabId, msg.level);
    }
  });

  port.onDisconnect.addListener(() => {
    set!.delete(port);
    if (set!.size === 0) {
      panels.delete(tabId);
      setLevel(tabId, null); // health is only known while a panel computes insights
      settingsByTab.delete(tabId); // includes chaos settings: they end with the panel
      for (const c of contents.get(tabId) ?? []) c.disconnect();
      contents.delete(tabId);
      sendToTab(tabId, { type: 'wrd:detach' });
    }
  });
}

function onContentConnect(port: chrome.runtime.Port) {
  const tabId = port.sender?.tab?.id;
  if (tabId === undefined) return port.disconnect();
  if (!panels.has(tabId)) return port.disconnect();
  const frameId = port.sender?.frameId ?? 0;
  const frameUrl = port.sender?.url ?? '';
  let set = contents.get(tabId);
  if (!set) contents.set(tabId, (set = new Set()));
  set.add(port);

  port.onMessage.addListener((msg: ContentToBackground) => {
    if (msg.type === 'batch') toPanels(tabId, { type: 'batch', frameId, frameUrl, batch: msg.batch });
  });
  port.onDisconnect.addListener(() => {
    set!.delete(port);
    toPanels(tabId, { type: 'frame-detached', frameId });
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name === CONTENT_PORT_NAME) {
    onContentConnect(port);
  } else if (port.name.startsWith(PANEL_PORT_PREFIX)) {
    // Panels are our own extension pages. Content scripts share our extension id but
    // their sender.url is the web page, so checking the URL keeps them out.
    if (port.sender?.id !== chrome.runtime.id || !port.sender?.url?.startsWith(chrome.runtime.getURL(''))) return port.disconnect();
    const tabId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
    if (Number.isFinite(tabId)) onPanelConnect(port, tabId);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'wrd:count') {
    const tabId = sender.tab?.id;
    if (tabId !== undefined && Array.isArray(msg.pcs)) void setFrameCount(tabId, sender.frameId ?? 0, sanitizeBriefs(msg.pcs));
    return false;
  }
  // Only our own extension pages (popup) may ask; content scripts have a web page URL.
  if (msg?.type === 'wrd:popup-info' && sender.id === chrome.runtime.id && sender.url?.startsWith(chrome.runtime.getURL(''))) {
    void popupInfo(msg.tabId, panels.has(msg.tabId)).then(sendResponse);
    return true; // async response
  }
  if (msg?.type === 'wrd:hello') {
    const tabId = sender.tab?.id;
    const reply: HelloReply = {
      attach: tabId !== undefined && panels.has(tabId),
      settings: tabId !== undefined ? settingsFor(tabId) : DEFAULT_SETTINGS
    };
    sendResponse(reply);
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  settingsByTab.delete(tabId);
  void forgetTab(tabId);
});

// "loading" fires for real navigations (connections are gone) and for same-document ones
// (history.pushState in single-page apps: connections are still there). Reset, then ask the
// frames that are still alive to report again.
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status !== 'loading') return;
  void resetTab(tabId).then(() => setTimeout(() => sendToTab(tabId, { type: 'wrd:recount' }), 400));
});

const PC_STATES = new Set(['new', 'connecting', 'connected', 'disconnected', 'failed', 'closed']);
/** Counts come from web pages (through content scripts): never trust their shape. */
function sanitizeBriefs(list: unknown[]): PcBrief[] {
  const out: PcBrief[] = [];
  for (const item of list.slice(0, 200)) {
    const b = item as Partial<PcBrief> | null;
    if (!b || typeof b.index !== 'number' || !Number.isFinite(b.index)) continue;
    out.push({ index: Math.trunc(b.index), state: PC_STATES.has(String(b.state)) ? String(b.state) : 'unknown' });
  }
  return out;
}
