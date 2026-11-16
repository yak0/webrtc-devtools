export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (Math.abs(v) >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatBitrate(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return '—';
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  if (bps >= 1000) return `${(bps / 1000).toFixed(0)} kbps`;
  return `${Math.round(bps)} bps`;
}

export function formatTime(ts: number, withMs = true): string {
  const d = new Date(ts);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  const base = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  return withMs ? `${base}.${p(d.getMilliseconds(), 3)}` : base;
}

export function formatRelative(ts: number, origin: number): string {
  const s = (ts - origin) / 1000;
  return `+${s < 10 ? s.toFixed(3) : s < 100 ? s.toFixed(2) : s.toFixed(1)}s`;
}

export function formatNumber(v: unknown, digits = 2): string {
  if (typeof v !== 'number') return v === undefined || v === null ? '—' : String(v);
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  return v.toFixed(digits);
}

export function compactJson(v: unknown, max = 160): string {
  if (v === undefined) return '';
  let s: string;
  try {
    s = typeof v === 'string' ? v : JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2) ?? '';
  } catch {
    return String(v);
  }
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.host + (u.pathname !== '/' ? u.pathname : '');
  } catch {
    return url;
  }
}

export type StateTone = 'success' | 'warning' | 'error' | 'default' | 'info';

export function stateTone(state: string | undefined): StateTone {
  switch (state) {
    case 'connected':
    case 'completed':
    case 'stable':
    case 'complete':
    case 'open':
    case 'succeeded':
      return 'success';
    case 'checking':
    case 'connecting':
    case 'gathering':
    case 'have-local-offer':
    case 'have-remote-offer':
    case 'have-local-pranswer':
    case 'have-remote-pranswer':
    case 'in-progress':
    case 'waiting':
      return 'warning';
    case 'failed':
    case 'disconnected':
      return 'error';
    case 'closed':
    case 'closing':
      return 'default';
    default:
      return 'info';
  }
}
