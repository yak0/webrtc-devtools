import type { TraceEvent } from '@/shared/protocol';

export interface SdpEntry {
  key: string;
  ts: number;
  seq: number;
  side: 'local' | 'remote';
  /** What produced it: createOffer, createAnswer, setLocalDescription, setRemoteDescription. */
  source: string;
  type: string;
  sdp: string;
  /** Applied to the connection (set*Description succeeded). */
  applied: boolean;
  error?: { name: string; message: string };
}

function desc(v: unknown): { type: string; sdp: string } | null {
  if (v && typeof v === 'object' && typeof (v as any).sdp === 'string') {
    return { type: String((v as any).type ?? ''), sdp: (v as any).sdp };
  }
  return null;
}

/** Extracts every SDP seen in the trace, in order. */
export function sdpHistory(events: TraceEvent[]): SdpEntry[] {
  const out: SdpEntry[] = [];
  for (const ev of events) {
    if (ev.kind !== 'call') continue;
    const base = { ts: ev.ts, seq: ev.seq, source: ev.name, error: ev.error };
    if (ev.name === 'createOffer' || ev.name === 'createAnswer') {
      const d = desc(ev.result);
      if (d) out.push({ ...base, key: `${ev.seq}`, side: 'local', ...d, applied: false });
    } else if (ev.name === 'setLocalDescription' || ev.name === 'setRemoteDescription') {
      const side = ev.name === 'setLocalDescription' ? 'local' : 'remote';
      const applied = (ev.result as any)?.[side === 'local' ? 'localDescription' : 'remoteDescription'];
      const fromArgs = desc(Array.isArray(ev.args) ? ev.args[0] : undefined);
      const d = desc(applied) ?? fromArgs;
      if (d) out.push({ ...base, key: `${ev.seq}`, side, ...d, applied: !ev.error && !ev.pending && !!applied });
      else if (ev.error) out.push({ ...base, key: `${ev.seq}`, side, type: '', sdp: '', applied: false });
    }
  }
  return out;
}

/** Previous applied SDP on the same side, used as diff base. */
export function previousOf(list: SdpEntry[], entry: SdpEntry): SdpEntry | undefined {
  const i = list.indexOf(entry);
  for (let j = i - 1; j >= 0; j--) {
    if (list[j].side === entry.side && list[j].sdp && (list[j].applied || !entry.applied)) return list[j];
  }
  return undefined;
}
