import type { StatsDelta } from '@/shared/protocol';
import { applyStatsDelta } from '@/injected/stats-differ';

export type StatsObject = Record<string, unknown> & { type?: string; id?: string };
export type Series = (number | null)[];

/** Stats types whose values never change meaningfully over time: no series kept. */
const STATIC_TYPES = new Set(['codec', 'certificate', 'local-candidate', 'remote-candidate']);

/** Counters turned into per-second rates, like webrtc-internals does. */
const BYTE_COUNTERS = new Set([
  'bytesSent',
  'bytesReceived',
  'headerBytesSent',
  'headerBytesReceived',
  'retransmittedBytesSent',
  'retransmittedBytesReceived',
  'bytesDiscardedOnSend'
]);
const COUNTERS = new Set([
  'packetsSent',
  'packetsReceived',
  'packetsLost',
  'packetsDiscarded',
  'retransmittedPacketsSent',
  'retransmittedPacketsReceived',
  'framesEncoded',
  'framesDecoded',
  'framesSent',
  'framesReceived',
  'framesDropped',
  'keyFramesEncoded',
  'keyFramesDecoded',
  'nackCount',
  'pliCount',
  'firCount',
  'concealedSamples',
  'silentConcealedSamples',
  'insertedSamplesForDeceleration',
  'removedSamplesForAcceleration',
  'totalSamplesReceived',
  'fecPacketsReceived',
  'fecPacketsDiscarded',
  'requestsSent',
  'requestsReceived',
  'responsesSent',
  'responsesReceived',
  'consentRequestsSent',
  'messagesSent',
  'messagesReceived',
  'hugeFramesSent',
  'freezeCount',
  'pauseCount'
]);

/** "[a/b]" derived ratios: Δa / Δb (× scale). */
const RATIOS: [string, string, string, number][] = [
  ['jitterBufferDelay', 'jitterBufferEmittedCount', '[jitterBufferDelay/jitterBufferEmittedCount_in_ms]', 1000],
  ['jitterBufferTargetDelay', 'jitterBufferEmittedCount', '[jitterBufferTargetDelay/jitterBufferEmittedCount_in_ms]', 1000],
  ['totalDecodeTime', 'framesDecoded', '[totalDecodeTime/framesDecoded_in_ms]', 1000],
  ['totalEncodeTime', 'framesEncoded', '[totalEncodeTime/framesEncoded_in_ms]', 1000],
  ['totalProcessingDelay', 'framesDecoded', '[totalProcessingDelay/framesDecoded_in_ms]', 1000],
  ['totalAssemblyTime', 'framesAssembledFromMultiplePackets', '[totalAssemblyTime/framesAssembledFromMultiplePackets_in_ms]', 1000],
  ['qpSum', 'framesDecoded', '[qpSum/framesDecoded]', 1],
  ['qpSum', 'framesEncoded', '[qpSum/framesEncoded]', 1],
  ['totalPacketSendDelay', 'packetsSent', '[totalPacketSendDelay/packetsSent_in_ms]', 1000],
  ['totalRoundTripTime', 'roundTripTimeMeasurements', '[totalRoundTripTime/roundTripTimeMeasurements_in_ms]', 1000],
  ['totalRoundTripTime', 'responsesReceived', '[totalRoundTripTime/responsesReceived_in_ms]', 1000]
];

export function rateFieldName(field: string): string {
  return BYTE_COUNTERS.has(field) ? `[${field}_in_bits/s]` : `[${field}/s]`;
}

export class StatsTimeline {
  /** Latest merged value of every stats object. */
  readonly current = new Map<string, StatsObject>();
  /** Report timestamps (ms since epoch), shared x axis of all series. */
  times: number[] = [];
  /** statId -> field -> values aligned with `times` (may be shorter: pad with null at the end). */
  readonly series = new Map<string, Map<string, Series>>();
  private prev = new Map<string, StatsObject>();
  private prevTs = 0;

  constructor(public cap = 900) {}

  apply(delta: StatsDelta): void {
    applyStatsDelta(this.current, delta);
    const ts = delta.ts;
    const dt = this.prevTs ? (ts - this.prevTs) / 1000 : 0;
    const gap = delta.full && this.times.length > 0; // re-attached: don't compute rates across the gap
    this.times.push(ts);
    const len = this.times.length;

    for (const [id, obj] of this.current) {
      if (STATIC_TYPES.has(obj.type as string)) continue;
      let fields = this.series.get(id);
      if (!fields) this.series.set(id, (fields = new Map()));
      const prev = gap ? undefined : this.prev.get(id);

      const push = (field: string, value: number | null) => {
        let arr = fields!.get(field);
        if (!arr) {
          arr = new Array(len - 1).fill(null);
          fields!.set(field, arr);
        }
        while (arr.length < len - 1) arr.push(null);
        arr.push(value);
      };

      for (const key in obj) {
        const v = obj[key];
        if (typeof v === 'number' && key !== 'timestamp') push(key, v);
        else if (typeof v === 'boolean') push(key, v ? 1 : 0);
      }

      if (prev && dt > 0) {
        for (const key in obj) {
          const v = obj[key];
          const pv = prev[key];
          if (typeof v !== 'number' || typeof pv !== 'number') continue;
          if (BYTE_COUNTERS.has(key)) push(rateFieldName(key), Math.max(0, ((v - pv) * 8) / dt));
          else if (COUNTERS.has(key)) push(rateFieldName(key), Math.max(0, (v - pv) / dt));
        }
        for (const [num, den, name, scale] of RATIOS) {
          const n1 = obj[num];
          const d1 = obj[den];
          const n0 = prev[num];
          const d0 = prev[den];
          if (typeof n1 === 'number' && typeof d1 === 'number' && typeof n0 === 'number' && typeof d0 === 'number') {
            const dd = d1 - d0;
            push(name, dd > 0 ? ((n1 - n0) / dd) * scale : null);
          }
        }
        if (obj.type === 'inbound-rtp') {
          const lost = (obj.packetsLost as number) - ((prev.packetsLost as number) ?? 0);
          const recv = (obj.packetsReceived as number) - ((prev.packetsReceived as number) ?? 0);
          if (Number.isFinite(lost) && Number.isFinite(recv) && lost + recv > 0) {
            push('[packetLoss%]', Math.max(0, (lost / (lost + recv)) * 100));
          }
        }
      }
      this.prev.set(id, { ...obj });
    }
    for (const id of delta.removed) this.prev.delete(id);
    this.prevTs = ts;
    this.trim();
  }

  private trim() {
    const excess = this.times.length - this.cap;
    if (excess <= this.cap * 0.1) return;
    this.times.splice(0, excess);
    for (const fields of this.series.values()) {
      for (const arr of fields.values()) arr.splice(0, excess);
    }
  }

  /** Values of one field padded to the time axis. */
  get(id: string, field: string): Series {
    const arr = this.series.get(id)?.get(field);
    if (!arr) return new Array(this.times.length).fill(null);
    if (arr.length === this.times.length) return arr;
    return arr.concat(new Array(this.times.length - arr.length).fill(null));
  }

  latest(id: string, field: string): number | null {
    const arr = this.series.get(id)?.get(field);
    if (!arr || arr.length !== this.times.length) return null;
    return arr[arr.length - 1] ?? null;
  }

  fields(id: string): string[] {
    return [...(this.series.get(id)?.keys() ?? [])].sort((a, b) => {
      const da = a.startsWith('[') ? 1 : 0;
      const db = b.startsWith('[') ? 1 : 0;
      return da - db || a.localeCompare(b);
    });
  }

  byType(type: string): StatsObject[] {
    const out: StatsObject[] = [];
    for (const obj of this.current.values()) if (obj.type === type) out.push(obj);
    return out;
  }

  /** Restores a timeline from exported / imported data. */
  static from(data: { current: Record<string, StatsObject>; times: number[]; series: Record<string, Record<string, Series>> }): StatsTimeline {
    const t = new StatsTimeline(Math.max(900, data.times.length));
    for (const [id, obj] of Object.entries(data.current)) t.current.set(id, obj);
    t.times = data.times.slice();
    for (const [id, fields] of Object.entries(data.series)) {
      t.series.set(id, new Map(Object.entries(fields)));
    }
    return t;
  }

  toJSON() {
    const series: Record<string, Record<string, Series>> = {};
    for (const [id, fields] of this.series) series[id] = Object.fromEntries(fields);
    return { current: Object.fromEntries(this.current), times: this.times, series };
  }
}
