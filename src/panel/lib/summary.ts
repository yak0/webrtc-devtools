// One-line numbers per connection, used by the compare view.
import type { PcModel } from '../store/session';
import { selectedPair } from './ice';
import type { Series, StatsTimeline } from './stats-timeline';

export interface PcSummary {
  finalState: string;
  setupMs: number | null;
  gatheringMs: number | null;
  durationS: number;
  sendKbpsAvg: number | null;
  sendKbpsMax: number | null;
  recvKbpsAvg: number | null;
  recvKbpsMax: number | null;
  rttAvgMs: number | null;
  rttMaxMs: number | null;
  lossAvgPct: number | null;
  fpsOutAvg: number | null;
  fpsInAvg: number | null;
  heightOutMax: number | null;
  heightInMax: number | null;
  codecs: string;
  path: string;
  iceRestarts: number;
  failedCalls: number;
}

const nums = (s: Series) => s.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
const avg = (s: number[]) => (s.length ? s.reduce((a, b) => a + b, 0) / s.length : null);
const max = (s: number[]) => (s.length ? Math.max(...s) : null);

export function sumSeries(stats: StatsTimeline, type: string, field: string, filter: (o: Record<string, unknown>) => boolean = () => true): Series {
  const out: Series = new Array(stats.times.length).fill(null);
  for (const o of stats.byType(type)) {
    if (!filter(o)) continue;
    stats.get(String(o.id), field).forEach((v, i) => {
      if (v !== null) out[i] = (out[i] ?? 0) + v;
    });
  }
  return out;
}

function collect(stats: StatsTimeline, type: string, field: string, filter: (o: Record<string, unknown>) => boolean = () => true): number[] {
  return stats.byType(type).filter(filter).flatMap((o) => nums(stats.get(String(o.id), field)));
}

export function summarize(pc: PcModel): PcSummary {
  const s = pc.stats;
  const first = (name: string, value: string) => pc.events.find((e) => e.name === name && e.value === value)?.ts;
  const connectedAt = first('connectionstatechange', 'connected');
  const gStart = first('icegatheringstatechange', 'gathering');
  const gEnd = first('icegatheringstatechange', 'complete');
  const send = nums(sumSeries(s, 'transport', '[bytesSent_in_bits/s]')).map((v) => v / 1000);
  const recv = nums(sumSeries(s, 'transport', '[bytesReceived_in_bits/s]')).map((v) => v / 1000);
  const pair = selectedPair(s);
  const rtt = pair ? nums(s.get(pair.id, 'currentRoundTripTime')).map((v) => v * 1000) : [];
  const video = (o: Record<string, unknown>) => o.kind === 'video';
  const codecs = new Set<string>();
  for (const t of ['outbound-rtp', 'inbound-rtp']) {
    for (const o of s.byType(t)) {
      const c = s.current.get(String(o.codecId));
      if (c?.mimeType) codecs.add(String(c.mimeType).split('/')[1]);
    }
  }
  const lt = pair?.local?.candidateType;
  const rt = pair?.remote?.candidateType;
  return {
    finalState: pc.closed ? 'closed' : pc.states.connectionState,
    setupMs: connectedAt ? connectedAt - pc.info.createdAt : null,
    gatheringMs: gStart && gEnd ? gEnd - gStart : null,
    durationS: s.times.length > 1 ? (s.times[s.times.length - 1] - s.times[0]) / 1000 : 0,
    sendKbpsAvg: avg(send),
    sendKbpsMax: max(send),
    recvKbpsAvg: avg(recv),
    recvKbpsMax: max(recv),
    rttAvgMs: avg(rtt),
    rttMaxMs: max(rtt),
    lossAvgPct: avg(collect(s, 'inbound-rtp', '[packetLoss%]')),
    fpsOutAvg: avg(collect(s, 'outbound-rtp', 'framesPerSecond', video)),
    fpsInAvg: avg(collect(s, 'inbound-rtp', 'framesPerSecond', video)),
    heightOutMax: max(collect(s, 'outbound-rtp', 'frameHeight', video)),
    heightInMax: max(collect(s, 'inbound-rtp', 'frameHeight', video)),
    codecs: [...codecs].join(', ') || '—',
    path: pair ? `${lt ?? '?'} ↔ ${rt ?? '?'} ${pair.local?.protocol ?? ''}${pair.local?.relayProtocol ? ` (relay ${pair.local.relayProtocol})` : ''}` : '—',
    iceRestarts: pc.events.filter((e) => e.name === 'restartIce' || (e.name === 'createOffer' && JSON.stringify(e.args ?? '').includes('"iceRestart":true'))).length,
    failedCalls: pc.events.filter((e) => e.kind === 'call' && e.error).length
  };
}

/** Rows for the compare table: label, getter, formatter, and whether higher is better. */
export const SUMMARY_ROWS: { key: keyof PcSummary; label: string; unit?: string; better?: 'higher' | 'lower'; digits?: number }[] = [
  { key: 'finalState', label: 'State' },
  { key: 'path', label: 'Selected path' },
  { key: 'codecs', label: 'Codecs' },
  { key: 'setupMs', label: 'Time to connected', unit: 'ms', better: 'lower', digits: 0 },
  { key: 'gatheringMs', label: 'ICE gathering time', unit: 'ms', better: 'lower', digits: 0 },
  { key: 'durationS', label: 'Stats duration', unit: 's', digits: 0 },
  { key: 'sendKbpsAvg', label: 'Send bitrate avg', unit: 'kbps', better: 'higher', digits: 0 },
  { key: 'sendKbpsMax', label: 'Send bitrate max', unit: 'kbps', digits: 0 },
  { key: 'recvKbpsAvg', label: 'Receive bitrate avg', unit: 'kbps', better: 'higher', digits: 0 },
  { key: 'recvKbpsMax', label: 'Receive bitrate max', unit: 'kbps', digits: 0 },
  { key: 'rttAvgMs', label: 'RTT avg', unit: 'ms', better: 'lower', digits: 0 },
  { key: 'rttMaxMs', label: 'RTT max', unit: 'ms', better: 'lower', digits: 0 },
  { key: 'lossAvgPct', label: 'Incoming loss avg', unit: '%', better: 'lower', digits: 2 },
  { key: 'fpsOutAvg', label: 'Outgoing fps avg', better: 'higher', digits: 1 },
  { key: 'fpsInAvg', label: 'Incoming fps avg', better: 'higher', digits: 1 },
  { key: 'heightOutMax', label: 'Outgoing max height', unit: 'px', better: 'higher', digits: 0 },
  { key: 'heightInMax', label: 'Incoming max height', unit: 'px', better: 'higher', digits: 0 },
  { key: 'iceRestarts', label: 'ICE restarts', better: 'lower', digits: 0 },
  { key: 'failedCalls', label: 'Failed API calls', better: 'lower', digits: 0 }
];
