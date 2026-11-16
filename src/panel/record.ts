import { RECORD_ORIGINS_KEY } from '@/shared/protocol';

// Per-origin opt-in for recording stats from page load (stored in chrome.storage.local,
// read by the content script before DevTools is opened).

export function storageAvailable(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local;
}

export async function getRecordOrigins(): Promise<string[]> {
  if (!storageAvailable()) return [];
  const v = await chrome.storage.local.get(RECORD_ORIGINS_KEY);
  return (v[RECORD_ORIGINS_KEY] as string[] | undefined) ?? [];
}

export async function setRecordOrigin(origin: string, on: boolean): Promise<void> {
  const list = new Set(await getRecordOrigins());
  if (on) list.add(origin);
  else list.delete(origin);
  await chrome.storage.local.set({ [RECORD_ORIGINS_KEY]: [...list] });
}

export function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : null;
  } catch {
    return null;
  }
}
