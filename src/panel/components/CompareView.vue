<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NCard, NEmpty, NSelect } from 'naive-ui';
import { session, getPc, type PcModel } from '../store/session';
import { summarize, sumSeries, SUMMARY_ROWS, type PcSummary } from '../lib/summary';
import { formatBitrate } from '../lib/format';
import UPlotChart from './common/UPlotChart.vue';

const a = ref<string | null>(null);
const b = ref<string | null>(null);

const label = (pc: PcModel) => `PC ${pc.index}${pc.importedFrom ? ` · ${pc.importedFrom}` : ''}${pc.stale ? ' (previous page)' : ''}`;
const options = computed(() => session.pcs.map((pc) => ({ label: label(pc), value: pc.id })));
watch(
  options,
  (o) => {
    if (!a.value && o[0]) a.value = o[0].value;
    if (!b.value && o[1]) b.value = o[1].value;
  },
  { immediate: true }
);

const pcA = computed(() => getPc(a.value));
const pcB = computed(() => getPc(b.value));
const rev = computed(() => `${pcA.value?.statsRev}:${pcB.value?.statsRev}:${pcA.value?.rev}:${pcB.value?.rev}`);
const sa = computed<PcSummary | null>(() => (void rev.value, pcA.value ? summarize(pcA.value) : null));
const sb = computed<PcSummary | null>(() => (void rev.value, pcB.value ? summarize(pcB.value) : null));

function fmt(v: unknown, digits = 0, unit = '') {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  return String(v);
}
function better(row: (typeof SUMMARY_ROWS)[number], side: 'a' | 'b'): boolean {
  if (!row.better || !sa.value || !sb.value) return false;
  const x = sa.value[row.key];
  const y = sb.value[row.key];
  if (typeof x !== 'number' || typeof y !== 'number' || x === y) return false;
  const aWins = row.better === 'higher' ? x > y : x < y;
  return side === 'a' ? aWins : !aWins;
}

/** Both connections on one chart, aligned on "seconds since the connection was created". */
const chart = computed(() => {
  void rev.value;
  if (!pcA.value || !pcB.value) return null;
  const rel = (pc: PcModel) => {
    const s = pc.stats;
    const send = sumSeries(s, 'transport', '[bytesSent_in_bits/s]');
    const recv = sumSeries(s, 'transport', '[bytesReceived_in_bits/s]');
    return s.times.map((t, i) => ({ t: Math.round((t - pc.info.createdAt) / 1000), send: send[i], recv: recv[i] }));
  };
  const ra = rel(pcA.value);
  const rb = rel(pcB.value);
  const secs = [...new Set([...ra, ...rb].map((p) => p.t))].sort((x, y) => x - y);
  const pick = (list: typeof ra, key: 'send' | 'recv') => {
    const m = new Map(list.map((p) => [p.t, p[key]]));
    return secs.map((s) => m.get(s) ?? null);
  };
  return {
    // uPlot expects ms here (UPlotChart divides by 1000); x axis shows seconds since creation.
    times: secs.map((s) => s * 1000),
    series: [
      { label: `A send`, data: pick(ra, 'send'), color: '#2080f0' },
      { label: `A recv`, data: pick(ra, 'recv'), color: '#18a058' },
      { label: `B send`, data: pick(rb, 'send'), color: '#f0a020' },
      { label: `B recv`, data: pick(rb, 'recv'), color: '#d03050' }
    ]
  };
});
</script>

<template>
  <div class="wrd-scroll">
    <div class="wrd-pad wrd-grid">
      <n-empty v-if="session.pcs.length < 2" description="Need at least two connections to compare">
        <template #extra>
          <div class="wrd-muted" style="max-width: 420px; text-align: center">
            Use “Preserve log” to keep connections across reloads, or import a file with “Add to session” to compare with an earlier run or a webrtc-internals dump.
          </div>
        </template>
      </n-empty>
      <template v-else>
        <div style="display: flex; gap: 12px; align-items: center">
          <strong>A</strong>
          <n-select v-model:value="a" :options="options" size="small" style="max-width: 320px" />
          <strong>B</strong>
          <n-select v-model:value="b" :options="options" size="small" style="max-width: 320px" />
        </div>
        <n-card size="small" title="Summary">
          <table class="cmp">
            <thead>
              <tr><th></th><th>A</th><th>B</th></tr>
            </thead>
            <tr v-for="row in SUMMARY_ROWS" :key="row.key">
              <td class="wrd-muted">{{ row.label }}</td>
              <td class="mono" :class="{ win: better(row, 'a') }">{{ fmt(sa?.[row.key], row.digits, row.unit) }}</td>
              <td class="mono" :class="{ win: better(row, 'b') }">{{ fmt(sb?.[row.key], row.digits, row.unit) }}</td>
            </tr>
          </table>
        </n-card>
        <n-card v-if="chart && chart.times.length > 1" size="small" title="Bitrate (x = time since connection creation)">
          <UPlotChart :times="chart.times" :series="chart.series" :version="rev.length + chart.times.length" :height="180" :format="(v) => formatBitrate(v)" relative-x />
        </n-card>
      </template>
    </div>
  </div>
</template>

<style scoped>
.cmp {
  border-collapse: collapse;
  width: 100%;
}
.cmp td,
.cmp th {
  text-align: left;
  padding: 3px 12px 3px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.cmp th {
  font-weight: 600;
}
.win {
  color: #18a058;
  font-weight: 600;
}
</style>
