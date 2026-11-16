import type { TraceEvent } from '@/shared/protocol';
import type { StatsObject, StatsTimeline } from './stats-timeline';

export interface ParsedCandidate {
  foundation: string;
  component: string;
  protocol: string;
  priority: number;
  address: string;
  port: number;
  type: string;
  relatedAddress?: string;
  relatedPort?: number;
  tcpType?: string;
  networkId?: string;
  networkCost?: string;
  ufrag?: string;
}

/** Parses an "candidate:..." line (with or without the "a=" / "candidate:" prefix). */
export function parseCandidate(line: string): ParsedCandidate | null {
  const s = line.replace(/^a=/, '').replace(/^candidate:/, '').trim();
  const parts = s.split(/\s+/);
  if (parts.length < 8 || parts[6] !== 'typ') return null;
  const c: ParsedCandidate = {
    foundation: parts[0],
    component: parts[1],
    protocol: parts[2].toLowerCase(),
    priority: Number(parts[3]),
    address: parts[4],
    port: Number(parts[5]),
    type: parts[7]
  };
  for (let i = 8; i < parts.length - 1; i += 2) {
    const k = parts[i];
    const v = parts[i + 1];
    if (k === 'raddr') c.relatedAddress = v;
    else if (k === 'rport') c.relatedPort = Number(v);
    else if (k === 'tcptype') c.tcpType = v;
    else if (k === 'network-id') c.networkId = v;
    else if (k === 'network-cost') c.networkCost = v;
    else if (k === 'ufrag') c.ufrag = v;
  }
  return c;
}

export interface CandidateRow {
  key: string;
  side: 'local' | 'remote';
  source: 'stats' | 'trace';
  address: string;
  port: number | string;
  protocol: string;
  type: string;
  relayProtocol?: string;
  networkType?: string;
  url?: string;
  priority?: number;
  relatedAddress?: string;
  statsId?: string;
  ts?: number;
}

export interface PairRow {
  id: string;
  state: string;
  nominated: boolean;
  selected: boolean;
  local?: StatsObject;
  remote?: StatsObject;
  bytesSent: number;
  bytesReceived: number;
  rtt: number | null;
  availableOutgoingBitrate: number | null;
  requestsSent: number;
  responsesReceived: number;
  priority?: number;
}

export function selectedPairIds(stats: StatsTimeline): Set<string> {
  const ids = new Set<string>();
  for (const t of stats.byType('transport')) {
    if (typeof t.selectedCandidatePairId === 'string') ids.add(t.selectedCandidatePairId);
  }
  return ids;
}

export function candidatePairs(stats: StatsTimeline): PairRow[] {
  const selected = selectedPairIds(stats);
  return stats
    .byType('candidate-pair')
    .map((p) => ({
      id: String(p.id),
      state: String(p.state ?? ''),
      nominated: !!p.nominated,
      selected: selected.has(String(p.id)),
      local: stats.current.get(String(p.localCandidateId)),
      remote: stats.current.get(String(p.remoteCandidateId)),
      bytesSent: Number(p.bytesSent ?? 0),
      bytesReceived: Number(p.bytesReceived ?? 0),
      rtt: typeof p.currentRoundTripTime === 'number' ? p.currentRoundTripTime : null,
      availableOutgoingBitrate: typeof p.availableOutgoingBitrate === 'number' ? p.availableOutgoingBitrate : null,
      requestsSent: Number(p.requestsSent ?? 0),
      responsesReceived: Number(p.responsesReceived ?? 0),
      priority: typeof p.priority === 'number' ? p.priority : undefined
    }))
    .sort((a, b) => Number(b.selected) - Number(a.selected) || Number(b.nominated) - Number(a.nominated) || b.bytesReceived - a.bytesReceived);
}

export function selectedPair(stats: StatsTimeline): PairRow | undefined {
  return candidatePairs(stats).find((p) => p.selected);
}

/** Candidates from stats, completed by what the trace saw (gathered before the panel attached, or signaled). */
/** Candidates seen in the trace (icecandidate events / addIceCandidate calls), keyed by side|port|protocol. */
function traceCandidates(events: TraceEvent[]): Map<string, { side: 'local' | 'remote'; c: ParsedCandidate; ts: number }> {
  const out = new Map<string, { side: 'local' | 'remote'; c: ParsedCandidate; ts: number }>();
  for (const ev of events) {
    let raw: unknown;
    let side: 'local' | 'remote';
    if (ev.kind === 'event' && ev.name === 'icecandidate' && ev.value) {
      raw = (ev.value as any).candidate;
      side = 'local';
    } else if (ev.kind === 'call' && ev.name === 'addIceCandidate' && Array.isArray(ev.args) && ev.args[0]) {
      const a = ev.args[0] as any;
      raw = typeof a === 'string' ? a : a.candidate;
      side = 'remote';
    } else continue;
    if (typeof raw !== 'string' || !raw) continue;
    const c = parseCandidate(raw);
    if (c) out.set(`${side}|${c.port}|${c.protocol}`, { side, c, ts: ev.ts });
  }
  return out;
}

/**
 * Chrome hides host addresses in getStats() (privacy); recover them from the trace when possible.
 */
export function resolveAddress(c: StatsObject | undefined, events: TraceEvent[]): string {
  if (!c) return '';
  const addr = String(c.address ?? c.ip ?? '');
  if (addr) return addr;
  const side = c.type === 'remote-candidate' ? 'remote' : 'local';
  return traceCandidates(events).get(`${side}|${c.port}|${String(c.protocol ?? '').toLowerCase()}`)?.c.address ?? '';
}

export function candidates(stats: StatsTimeline, events: TraceEvent[]): CandidateRow[] {
  const rows: CandidateRow[] = [];
  const seen = new Set<string>();
  const trace = traceCandidates(events);
  for (const type of ['local-candidate', 'remote-candidate'] as const) {
    for (const c of stats.byType(type)) {
      const side = type === 'local-candidate' ? 'local' : 'remote';
      const tkey = `${side}|${c.port}|${String(c.protocol ?? '').toLowerCase()}`;
      const fromTrace = trace.get(tkey);
      const address = String(c.address ?? c.ip ?? '') || fromTrace?.c.address || '(hidden)';
      const key = `${side}|${address}|${c.port}|${c.protocol}`;
      seen.add(key);
      seen.add(tkey);
      rows.push({
        key,
        side,
        source: 'stats',
        address,
        port: Number(c.port),
        protocol: String(c.protocol ?? ''),
        type: String(c.candidateType ?? ''),
        relayProtocol: c.relayProtocol as string | undefined,
        networkType: c.networkType as string | undefined,
        url: c.url as string | undefined,
        priority: c.priority as number | undefined,
        relatedAddress: c.relatedAddress as string | undefined,
        statsId: String(c.id)
      });
    }
  }
  for (const [tkey, { side, c: p, ts }] of trace) {
    const key = `${side}|${p.address}|${p.port}|${p.protocol}`;
    if (seen.has(key) || seen.has(tkey)) continue;
    seen.add(key);
    rows.push({
      key,
      side,
      source: 'trace',
      address: p.address,
      port: p.port,
      protocol: p.protocol,
      type: p.type,
      priority: p.priority,
      relatedAddress: p.relatedAddress,
      ts
    });
  }
  return rows;
}

export function describeCandidate(c?: StatsObject, events: TraceEvent[] = []): string {
  if (!c) return '—';
  const relay = c.candidateType === 'relay' && c.relayProtocol ? `/${c.relayProtocol}` : '';
  return `${resolveAddress(c, events) || '(hidden)'}:${c.port} ${c.protocol} (${c.candidateType}${relay})`;
}

export function iceServerUrls(config: unknown): { urls: string[]; username?: string }[] {
  const servers = (config as any)?.iceServers;
  if (!Array.isArray(servers)) return [];
  return servers.map((s: any) => ({
    urls: Array.isArray(s?.urls) ? s.urls : typeof s?.urls === 'string' ? [s.urls] : typeof s?.url === 'string' ? [s.url] : [],
    username: s?.username
  }));
}
