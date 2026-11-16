<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { NCard, NEmpty, NSwitch, NTag, NTooltip } from 'naive-ui';
import { sendCommand, session, type PcModel } from '../../store/session';
import { audioMos, scoreTone, videoScore, type QualityScore } from '../../lib/quality';
import { selectedPair } from '../../lib/ice';
import type { StatsObject } from '../../lib/stats-timeline';
import { formatBitrate, formatNumber } from '../../lib/format';
import UPlotChart from '../common/UPlotChart.vue';

const props = defineProps<{ pc: PcModel }>();

interface Metric {
  label: string;
  value: string;
  tone?: 'warn' | 'bad';
}

interface StreamCard {
  id: string;
  trackId?: string;
  /** 0..1 audio level for the meter. */
  level?: number | null;
  quality?: { name: string; q: QualityScore };
  title: string;
  subtitle: string;
  tags: { label: string; type?: 'warning' | 'error' | 'info' | 'success' }[];
  metrics: Metric[];
  charts: { title: string; series: { label: string; data: (number | null)[]; right?: boolean }[]; format?: (v: number) => string; formatRight?: (v: number) => string }[];
}

// ---- live previews ----
const previews = ref(false);
const live = computed(() => !props.pc.imported && !props.pc.stale && !props.pc.closed && !session.imported);
async function togglePreviews(on: boolean) {
  previews.value = on;
  await sendCommand(props.pc.frameId, { op: 'preview', pcId: props.pc.id, enabled: on });
}
onBeforeUnmount(() => {
  if (previews.value) void sendCommand(props.pc.frameId, { op: 'preview', pcId: props.pc.id, enabled: false });
});
function previewOf(trackId?: string) {
  void session.previewRev;
  if (!previews.value || !trackId) return undefined;
  const p = session.previews.get(trackId);
  return p && Date.now() - p.ts < 5000 ? p : undefined;
}

// ---- simulcast / SVC ----
interface Layer {
  id: string;
  rid: string;
  active: boolean;
  resolution: string;
  fps: string;
  bitrate: string;
  target: string;
  limitation: string;
  scalability: string;
  configured: string;
}
const layers = computed(() => {
  void props.pc.statsRev;
  void props.pc.rev;
  const s = props.pc.stats;
  // Most recent encodings configured by the app, keyed by rid.
  const configured = new Map<string, Record<string, unknown>>();
  for (const e of props.pc.events) {
    const encs =
      e.name === 'addTransceiver' ? (e.args as any)?.[1]?.sendEncodings : e.name === 'setParameters' ? (e.args as any)?.[0]?.encodings : undefined;
    // Keyed by rid, or by position for single-encoding / SVC senders (matches stats' encodingIndex).
    if (Array.isArray(encs)) encs.forEach((enc: any, i: number) => configured.set(enc?.rid ? String(enc.rid) : `#${i}`, enc));
  }
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const o of s.byType('outbound-rtp')) {
    if (o.kind !== 'video') continue;
    const key = String(o.mid ?? o.mediaSourceId ?? o.id);
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const out: { mid: string; layers: Layer[] }[] = [];
  for (const [mid, list] of groups) {
    const svc = list.some((o) => typeof o.scalabilityMode === 'string' && !/^L1T1$/.test(o.scalabilityMode as string));
    if (list.length < 2 && !svc) continue;
    out.push({
      mid,
      layers: list
        .sort((a, b) => Number(b.frameHeight ?? 0) - Number(a.frameHeight ?? 0))
        .map((o) => {
          const c = configured.get(o.rid ? String(o.rid) : `#${o.encodingIndex ?? 0}`);
          const id = String(o.id);
          return {
            id,
            rid: String(o.rid ?? '—'),
            active: o.active !== false,
            resolution: o.frameWidth ? `${o.frameWidth}×${o.frameHeight}` : '—',
            fps: formatNumber(o.framesPerSecond, 0),
            bitrate: formatBitrate(s.latest(id, '[bytesSent_in_bits/s]')),
            target: formatBitrate(o.targetBitrate as number | undefined),
            limitation: String(o.qualityLimitationReason ?? '—'),
            scalability: String(o.scalabilityMode ?? '—'),
            configured: c
              ? [
                  c.scaleResolutionDownBy !== undefined ? `÷${c.scaleResolutionDownBy}` : '',
                  c.maxBitrate !== undefined ? `max ${formatBitrate(c.maxBitrate as number)}` : '',
                  c.maxFramerate !== undefined ? `${c.maxFramerate} fps` : '',
                  c.active === false ? 'inactive' : ''
                ]
                  .filter(Boolean)
                  .join(' · ')
              : '—'
          };
        })
    });
  }
  return out;
});

const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(1)} ms`);

const cards = computed(() => {
  void props.pc.statsRev;
  const s = props.pc.stats;
  const codecName = (o: StatsObject) => {
    const c = s.current.get(String(o.codecId));
    return c ? `${String(c.mimeType ?? '').split('/')[1] ?? ''}${c.sdpFmtpLine ? '' : ''}` : '';
  };
  const out: { outbound: StreamCard[]; inbound: StreamCard[] } = { outbound: [], inbound: [] };

  const outbound = s.byType('outbound-rtp').sort((a, b) => String(a.kind).localeCompare(String(b.kind)) || String(a.rid ?? '').localeCompare(String(b.rid ?? '')));
  for (const o of outbound) {
    const id = String(o.id);
    const remote = [...s.current.values()].find((r) => r.type === 'remote-inbound-rtp' && r.localId === id);
    const source = s.current.get(String(o.mediaSourceId));
    const bitrate = s.latest(id, '[bytesSent_in_bits/s]');
    const reason = o.qualityLimitationReason as string | undefined;
    const remoteLossPct = typeof remote?.fractionLost === 'number' ? remote.fractionLost * 100 : null;
    const remoteRttMs = typeof remote?.roundTripTime === 'number' ? remote.roundTripTime * 1000 : null;
    const card: StreamCard = {
      id,
      trackId: source?.trackIdentifier as string | undefined,
      level: o.kind === 'audio' && typeof source?.audioLevel === 'number' ? source.audioLevel : undefined,
      quality:
        o.kind === 'audio'
          ? { name: 'MOS', q: audioMos({ rttMs: remoteRttMs, lossPct: remoteLossPct, jitterBufferMs: 40 }) }
          : {
              name: 'Video',
              q: videoScore({
                fps: o.framesPerSecond as number | undefined,
                height: o.frameHeight as number | undefined,
                lossPct: remoteLossPct,
                limitation: reason,
                rttMs: remoteRttMs
              })
            },
      title: `${o.kind} ↑${o.rid ? ` rid=${o.rid}` : ''}`,
      subtitle: `ssrc ${o.ssrc} · mid ${o.mid ?? '—'}${source?.trackIdentifier ? ` · track ${String(source.trackIdentifier).slice(0, 8)}` : ''}`,
      tags: [
        ...(codecName(o) ? [{ label: codecName(o) }] : []),
        ...(o.active === false ? [{ label: 'inactive', type: 'warning' as const }] : []),
        ...(o.encoderImplementation ? [{ label: String(o.encoderImplementation) }] : []),
        ...(o.scalabilityMode ? [{ label: String(o.scalabilityMode) }] : []),
        ...(reason && reason !== 'none' ? [{ label: `limited: ${reason}`, type: 'warning' as const }] : [])
      ],
      metrics: [
        { label: 'Bitrate', value: formatBitrate(bitrate) },
        { label: 'Target', value: formatBitrate(o.targetBitrate as number | undefined) },
        { label: 'Packets/s', value: formatNumber(s.latest(id, '[packetsSent/s]'), 0) },
        ...(o.kind === 'video'
          ? [
              { label: 'Resolution', value: o.frameWidth ? `${o.frameWidth}×${o.frameHeight}` : '—' },
              { label: 'FPS', value: formatNumber(o.framesPerSecond, 1) },
              { label: 'Encode/frame', value: ms(s.latest(id, '[totalEncodeTime/framesEncoded_in_ms]')) },
              { label: 'QP', value: formatNumber(s.latest(id, '[qpSum/framesEncoded]'), 1) },
              { label: 'NACK / PLI / FIR', value: `${o.nackCount ?? 0} / ${o.pliCount ?? 0} / ${o.firCount ?? 0}` }
            ]
          : [{ label: 'NACK', value: String(o.nackCount ?? 0) }]),
        ...(remote
          ? [
              { label: 'Remote RTT', value: typeof remote.roundTripTime === 'number' ? `${Math.round(remote.roundTripTime * 1000)} ms` : '—' },
              {
                label: 'Remote loss',
                value: typeof remote.fractionLost === 'number' ? `${(remote.fractionLost * 100).toFixed(1)}%` : '—',
                tone: typeof remote.fractionLost === 'number' && remote.fractionLost > 0.05 ? ('warn' as const) : undefined
              },
              { label: 'Remote jitter', value: typeof remote.jitter === 'number' ? `${(remote.jitter * 1000).toFixed(1)} ms` : '—' }
            ]
          : []),
        ...(source?.kind === 'audio' && typeof source.audioLevel === 'number' ? [{ label: 'Mic level', value: source.audioLevel.toFixed(3) }] : [])
      ],
      charts: [
        {
          title: o.kind === 'video' ? 'Bitrate / FPS' : 'Bitrate',
          series: [
            { label: 'bitrate', data: s.get(id, '[bytesSent_in_bits/s]') },
            ...(o.kind === 'video' ? [{ label: 'fps', data: s.get(id, 'framesPerSecond'), right: true }] : [])
          ],
          format: formatBitrate,
          formatRight: (v) => v.toFixed(0)
        }
      ]
    };
    out.outbound.push(card);
  }

  for (const i of s.byType('inbound-rtp').sort((a, b) => String(a.kind).localeCompare(String(b.kind)))) {
    const id = String(i.id);
    const loss = s.latest(id, '[packetLoss%]');
    const pairRtt = selectedPair(s)?.rtt;
    const rttMs = typeof pairRtt === 'number' ? pairRtt * 1000 : null;
    const freezesPerSec = s.latest(id, '[freezeCount/s]');
    const card: StreamCard = {
      id,
      trackId: i.trackIdentifier as string | undefined,
      level: i.kind === 'audio' && typeof i.audioLevel === 'number' ? i.audioLevel : undefined,
      quality:
        i.kind === 'audio'
          ? { name: 'MOS', q: audioMos({ rttMs, lossPct: loss, jitterBufferMs: s.latest(id, '[jitterBufferDelay/jitterBufferEmittedCount_in_ms]') }) }
          : {
              name: 'Video',
              q: videoScore({
                fps: i.framesPerSecond as number | undefined,
                height: i.frameHeight as number | undefined,
                lossPct: loss,
                freezesPerMin: freezesPerSec === null ? null : freezesPerSec * 60,
                rttMs
              })
            },
      title: `${i.kind} ↓`,
      subtitle: `ssrc ${i.ssrc} · mid ${i.mid ?? '—'}${i.trackIdentifier ? ` · track ${String(i.trackIdentifier).slice(0, 8)}` : ''}`,
      tags: [
        ...(codecName(i) ? [{ label: codecName(i) }] : []),
        ...(i.decoderImplementation ? [{ label: String(i.decoderImplementation) }] : []),
        ...(i.powerEfficientDecoder ? [{ label: 'hw decoder', type: 'success' as const }] : [])
      ],
      metrics: [
        { label: 'Bitrate', value: formatBitrate(s.latest(id, '[bytesReceived_in_bits/s]')) },
        { label: 'Packets/s', value: formatNumber(s.latest(id, '[packetsReceived/s]'), 0) },
        { label: 'Packet loss', value: loss === null ? '—' : `${loss.toFixed(1)}%`, tone: loss !== null && loss > 5 ? ('warn' as const) : undefined },
        { label: 'Packets lost', value: formatNumber(i.packetsLost, 0) },
        { label: 'Jitter', value: typeof i.jitter === 'number' ? `${(i.jitter * 1000).toFixed(1)} ms` : '—' },
        { label: 'Jitter buffer', value: ms(s.latest(id, '[jitterBufferDelay/jitterBufferEmittedCount_in_ms]')) },
        ...(i.kind === 'video'
          ? [
              { label: 'Resolution', value: i.frameWidth ? `${i.frameWidth}×${i.frameHeight}` : '—' },
              { label: 'FPS', value: formatNumber(i.framesPerSecond, 1) },
              { label: 'Decode/frame', value: ms(s.latest(id, '[totalDecodeTime/framesDecoded_in_ms]')) },
              { label: 'Dropped frames', value: formatNumber(i.framesDropped, 0) },
              { label: 'Freezes', value: formatNumber(i.freezeCount, 0), tone: Number(i.freezeCount) > 0 ? ('warn' as const) : undefined },
              { label: 'NACK / PLI / FIR', value: `${i.nackCount ?? 0} / ${i.pliCount ?? 0} / ${i.firCount ?? 0}` }
            ]
          : [
              { label: 'Audio level', value: formatNumber(i.audioLevel, 3) },
              {
                label: 'Concealed',
                value:
                  typeof i.concealedSamples === 'number' && typeof i.totalSamplesReceived === 'number' && i.totalSamplesReceived > 0
                    ? `${((i.concealedSamples / i.totalSamplesReceived) * 100).toFixed(2)}%`
                    : '—'
              }
            ])
      ],
      charts: [
        {
          title: i.kind === 'video' ? 'Bitrate / FPS' : 'Bitrate / audio level',
          series: [
            { label: 'bitrate', data: s.get(id, '[bytesReceived_in_bits/s]') },
            i.kind === 'video' ? { label: 'fps', data: s.get(id, 'framesPerSecond'), right: true } : { label: 'level', data: s.get(id, 'audioLevel'), right: true }
          ],
          format: formatBitrate,
          formatRight: (v) => (i.kind === 'video' ? v.toFixed(0) : v.toFixed(2))
        },
        {
          title: 'Loss % / jitter (ms)',
          series: [
            { label: 'loss %', data: s.get(id, '[packetLoss%]') },
            { label: 'jitter ms', data: s.get(id, 'jitter').map((v) => (v === null ? null : v * 1000)), right: true }
          ],
          format: (v) => v.toFixed(1),
          formatRight: (v) => v.toFixed(0)
        }
      ]
    };
    out.inbound.push(card);
  }
  return out;
});
</script>

<template>
  <div class="wrd-pad wrd-grid">
    <div v-if="live" style="display: flex; align-items: center; gap: 8px">
      <n-switch :value="previews" size="small" @update:value="togglePreviews" />
      <span>Live video previews</span>
      <span class="wrd-muted">(1 frame/s grabbed from the page's tracks; only while this tab is open)</span>
    </div>
    <n-empty v-if="!cards.outbound.length && !cards.inbound.length" description="No RTP streams in getStats() yet" style="margin-top: 40px" />
    <n-card v-for="g in layers" :key="g.mid" size="small" :title="`Simulcast / SVC layers · mid ${g.mid}`">
      <table class="layers">
        <thead>
          <tr><th>rid</th><th>Active</th><th>Resolution</th><th>FPS</th><th>Bitrate</th><th>Target</th><th>Limited by</th><th>Mode</th><th>Configured</th></tr>
        </thead>
        <tbody>
          <tr v-for="l in g.layers" :key="l.id" :class="{ off: !l.active }">
            <td class="mono"><strong>{{ l.rid }}</strong></td>
            <td>{{ l.active ? 'yes' : 'no' }}</td>
            <td class="mono">{{ l.resolution }}</td>
            <td class="mono">{{ l.fps }}</td>
            <td class="mono">{{ l.bitrate }}</td>
            <td class="mono">{{ l.target }}</td>
            <td :style="{ color: l.limitation !== 'none' && l.limitation !== '—' ? '#f0a020' : '' }">{{ l.limitation }}</td>
            <td class="mono">{{ l.scalability }}</td>
            <td class="mono wrd-muted">{{ l.configured }}</td>
          </tr>
        </tbody>
      </table>
    </n-card>
    <template v-for="group in (['outbound', 'inbound'] as const)" :key="group">
      <div v-if="cards[group].length" class="wrd-section-title" style="margin-top: 4px">
        {{ group === 'outbound' ? 'Sending' : 'Receiving' }} · {{ cards[group].length }}
      </div>
      <div v-if="cards[group].length" class="wrd-grid cols-2">
        <n-card v-for="c in cards[group]" :key="c.id" size="small">
          <template #header>
            <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap">
              <strong>{{ c.title }}</strong>
              <n-tag v-for="t in c.tags" :key="t.label" size="tiny" :bordered="false" :type="t.type ?? 'default'">{{ t.label }}</n-tag>
              <span style="flex: 1" />
              <n-tooltip v-if="c.quality">
                <template #trigger>
                  <n-tag size="small" :type="scoreTone(c.quality.q.label)" style="cursor: help">
                    {{ c.quality.name }} {{ c.quality.q.score.toFixed(1) }}
                  </n-tag>
                </template>
                Estimated {{ c.quality.q.label }}{{ c.quality.q.reasons.length ? `: ${c.quality.q.reasons.join(', ')}` : '' }}
                <br />
                <span style="opacity: 0.7">{{ c.quality.name === 'MOS' ? 'Simplified E-model (1–4.5)' : 'Heuristic score (1–5)' }}</span>
              </n-tooltip>
            </div>
            <div class="wrd-muted mono" style="font-weight: 400">{{ c.subtitle }}</div>
          </template>
          <div v-if="previewOf(c.trackId)" class="preview">
            <img :src="previewOf(c.trackId)!.dataUrl" alt="" />
            <span class="wrd-muted mono">{{ previewOf(c.trackId)!.width }}×{{ previewOf(c.trackId)!.height }}</span>
          </div>
          <div v-if="c.level !== undefined && c.level !== null" class="meter" :title="`audio level ${c.level.toFixed(3)}`">
            <div class="bar" :style="{ width: `${Math.min(100, Math.sqrt(c.level) * 100)}%` }" />
          </div>
          <div class="metrics">
            <div v-for="m in c.metrics" :key="m.label" class="wrd-metric">
              <span class="label">{{ m.label }}</span>
              <span class="value small" :class="m.tone">{{ m.value }}</span>
            </div>
          </div>
          <div v-for="ch in c.charts" :key="ch.title" style="margin-top: 8px">
            <div class="wrd-muted" style="margin-bottom: 2px">{{ ch.title }}</div>
            <UPlotChart :times="pc.stats.times" :series="ch.series" :version="pc.statsRev" :height="110" :format="ch.format" :format-right="ch.formatRight" :sync-key="pc.id" />
          </div>
        </n-card>
      </div>
    </template>
  </div>
</template>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(105px, 1fr));
  gap: 8px 12px;
}
.layers {
  width: 100%;
  border-collapse: collapse;
}
.layers th,
.layers td {
  text-align: left;
  padding: 2px 10px 2px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
  white-space: nowrap;
}
.layers th {
  font-weight: 500;
  opacity: 0.6;
}
.layers tr.off {
  opacity: 0.45;
}
.preview {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  margin-bottom: 8px;
}
.preview img {
  width: 192px;
  border-radius: 4px;
  background: #000;
}
.meter {
  height: 6px;
  border-radius: 3px;
  background: rgba(128, 128, 128, 0.2);
  margin-bottom: 8px;
  overflow: hidden;
}
.meter .bar {
  height: 100%;
  background: #18a058;
  transition: width 0.3s;
}
.value.small {
  font-size: 13px;
}
.value.warn {
  color: #f0a020;
}
.value.bad {
  color: #d03050;
}
</style>
