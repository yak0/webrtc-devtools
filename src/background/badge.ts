// Toolbar badge: number of open RTCPeerConnections in each tab, colored by health.
// Counts come from content scripts (works without DevTools); the health level comes
// from an open panel's insights. State is mirrored to storage.session so a service
// worker restart does not lose it.
import type { BadgeLevel, PcBrief, PopupInfo } from '../shared/protocol';

const COLORS: Record<BadgeLevel, string> = { error: '#d03050', warning: '#f0a020', ok: '#2080f0' };
const STORE_KEY = 'badgeFrames';

/** tabId -> frameId -> open connections */
const counts = new Map<number, Map<number, PcBrief[]>>();
const levels = new Map<number, BadgeLevel>();
let restored: Promise<void> | null = null;

function restore(): Promise<void> {
  restored ??= (async () => {
    try {
      const v = await chrome.storage.session.get(STORE_KEY);
      const saved = (v[STORE_KEY] ?? {}) as Record<string, Record<string, PcBrief[]>>;
      for (const [tab, frames] of Object.entries(saved)) {
        counts.set(Number(tab), new Map(Object.entries(frames).map(([f, n]) => [Number(f), n])));
      }
    } catch {
      /* storage.session unavailable */
    }
  })();
  return restored;
}

function persist() {
  const out: Record<string, Record<string, PcBrief[]>> = {};
  for (const [tab, frames] of counts) out[tab] = Object.fromEntries(frames);
  chrome.storage.session.set({ [STORE_KEY]: out }).catch(() => {});
}

function total(tabId: number): number {
  let n = 0;
  for (const c of counts.get(tabId)?.values() ?? []) n += c.length;
  return n;
}

function render(tabId: number) {
  const n = total(tabId);
  const level = levels.get(tabId) ?? 'ok';
  chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: COLORS[level] }).catch(() => {});
  chrome.action.setBadgeTextColor?.({ tabId, color: '#ffffff' }).catch(() => {});
  const health = level === 'error' ? ' · problems found' : level === 'warning' ? ' · warnings' : '';
  chrome.action
    .setTitle({ tabId, title: n ? `WebRTC DevTools: ${n} open RTCPeerConnection${n > 1 ? 's' : ''}${health}` : 'WebRTC DevTools' })
    .catch(() => {});
}

export async function setFrameCount(tabId: number, frameId: number, pcs: PcBrief[]) {
  await restore();
  let frames = counts.get(tabId);
  if (!frames) counts.set(tabId, (frames = new Map()));
  if (pcs.length > 0) frames.set(frameId, pcs);
  else frames.delete(frameId);
  if (!frames.size) counts.delete(tabId);
  persist();
  render(tabId);
}

export function setLevel(tabId: number, level: BadgeLevel | null) {
  if (level) levels.set(tabId, level);
  else levels.delete(tabId);
  render(tabId);
}

export async function resetTab(tabId: number) {
  await restore();
  counts.delete(tabId);
  levels.delete(tabId);
  persist();
  render(tabId);
}

export async function forgetTab(tabId: number) {
  await restore();
  counts.delete(tabId);
  levels.delete(tabId);
  persist();
}

export async function popupInfo(tabId: number, panelOpen: boolean): Promise<PopupInfo> {
  await restore();
  return {
    frames: [...(counts.get(tabId) ?? new Map()).entries()].map(([frameId, pcs]) => ({ frameId, pcs })),
    level: levels.get(tabId) ?? null,
    panelOpen
  };
}
