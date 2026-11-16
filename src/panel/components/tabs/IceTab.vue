<script setup lang="ts">
import { computed, h } from 'vue';
import { NCard, NDataTable, NEmpty, NTag, type DataTableColumns } from 'naive-ui';
import type { PcModel } from '../../store/session';
import { candidatePairs, candidates, describeCandidate, iceServerUrls, type CandidateRow, type PairRow } from '../../lib/ice';
import { formatBitrate, formatBytes, formatTime, stateTone } from '../../lib/format';
import UPlotChart from '../common/UPlotChart.vue';
import { turnProvider } from '../../lib/sdk';

const props = defineProps<{ pc: PcModel }>();

const pairs = computed(() => {
  void props.pc.statsRev;
  return candidatePairs(props.pc.stats);
});
const cands = computed(() => {
  void props.pc.statsRev;
  void props.pc.rev;
  return candidates(props.pc.stats, props.pc.events);
});
const local = computed(() => cands.value.filter((c) => c.side === 'local'));
const remote = computed(() => cands.value.filter((c) => c.side === 'remote'));
const errors = computed(() => {
  void props.pc.rev;
  return props.pc.events.filter((e) => e.name === 'icecandidateerror').map((e) => ({ ts: e.ts, ...(e.value as any) }));
});
const servers = computed(() => iceServerUrls(props.pc.info.effectiveConfig ?? props.pc.info.config));

const typeTone = (t: string) => (t === 'host' ? 'success' : t === 'srflx' || t === 'prflx' ? 'info' : t === 'relay' ? 'warning' : 'default');

const pairColumns: DataTableColumns<PairRow> = [
  {
    title: 'State',
    key: 'state',
    width: 140,
    render: (p) =>
      h('span', { style: 'display:flex;gap:4px;align-items:center' }, [
        h(NTag, { size: 'tiny', bordered: false, type: stateTone(p.state) }, () => p.state),
        p.selected ? h(NTag, { size: 'tiny', type: 'success' }, () => 'selected') : p.nominated ? h(NTag, { size: 'tiny', bordered: false }, () => 'nominated') : null
      ])
  },
  { title: 'Local', key: 'local', width: 220, render: (p) => h('span', { class: 'mono' }, describeCandidate(p.local, props.pc.events)) },
  { title: 'Remote', key: 'remote', width: 220, render: (p) => h('span', { class: 'mono' }, describeCandidate(p.remote, props.pc.events)) },
  { title: 'Sent / Received', key: 'bytes', width: 150, render: (p) => `${formatBytes(p.bytesSent)} / ${formatBytes(p.bytesReceived)}` },
  { title: 'RTT', key: 'rtt', width: 70, render: (p) => (p.rtt === null ? '—' : `${Math.round(p.rtt * 1000)} ms`) },
  { title: 'Avail. out', key: 'aob', width: 90, render: (p) => formatBitrate(p.availableOutgoingBitrate) },
  { title: 'Req / Resp', key: 'req', width: 90, render: (p) => `${p.requestsSent} / ${p.responsesReceived}` }
];

const candColumns: DataTableColumns<CandidateRow> = [
  { title: 'Type', key: 'type', width: 80, render: (c) => h(NTag, { size: 'tiny', bordered: false, type: typeTone(c.type) }, () => c.type) },
  { title: 'Address', key: 'address', width: 190, render: (c) => h('span', { class: 'mono' }, `${c.address}:${c.port}`) },
  { title: 'Protocol', key: 'protocol', width: 90, render: (c) => `${c.protocol}${c.relayProtocol ? ` (relay ${c.relayProtocol})` : ''}` },
  { title: 'Network', key: 'networkType', width: 90, render: (c) => c.networkType ?? '' },
  { title: 'Related', key: 'related', width: 120, render: (c) => h('span', { class: 'mono' }, c.relatedAddress ?? '') },
  { title: 'Server', key: 'url', width: 160, ellipsis: { tooltip: true }, render: (c) => h('span', { class: 'mono' }, c.url ?? '') },
  {
    title: 'Source',
    key: 'source',
    width: 70,
    render: (c) => h('span', { class: 'wrd-muted', title: c.source === 'trace' ? 'Seen in the trace, not (or no longer) in getStats()' : 'getStats()' }, c.source)
  }
];

const rttChart = computed(() => {
  void props.pc.statsRev;
  const s = props.pc.stats;
  const selected = pairs.value.filter((p) => p.selected);
  return {
    times: s.times,
    series: selected.map((p) => ({ label: `RTT ${p.id}`, data: s.get(p.id, 'currentRoundTripTime').map((v) => (v === null ? null : v * 1000)) }))
  };
});
</script>

<template>
  <div class="wrd-pad wrd-grid">
    <n-card size="small" :title="`Candidate pairs (${pairs.length})`">
      <n-data-table v-if="pairs.length" size="small" :scroll-x="900" :columns="pairColumns" :data="pairs" :row-key="(p: PairRow) => p.id" :bordered="false" />
      <n-empty v-else size="small" description="No candidate pairs in getStats() yet" />
      <div v-if="rttChart.series.length && rttChart.times.length > 1" style="margin-top: 10px">
        <div class="wrd-section-title">Selected pair round-trip time (ms)</div>
        <UPlotChart :times="rttChart.times" :series="rttChart.series" :version="pc.statsRev" :height="120" :format="(v) => `${Math.round(v)}`" :sync-key="pc.id" />
      </div>
    </n-card>

    <div class="wrd-grid cols-2">
      <n-card size="small" :title="`Local candidates (${local.length})`">
        <n-data-table v-if="local.length" size="small" :scroll-x="720" :columns="candColumns" :data="local" :row-key="(c: CandidateRow) => c.key" :bordered="false" />
        <n-empty v-else size="small" description="No local candidates gathered" />
      </n-card>
      <n-card size="small" :title="`Remote candidates (${remote.length})`">
        <n-data-table v-if="remote.length" size="small" :scroll-x="720" :columns="candColumns" :data="remote" :row-key="(c: CandidateRow) => c.key" :bordered="false" />
        <n-empty v-else size="small" description="No remote candidates received" />
      </n-card>
    </div>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="ICE servers">
        <div v-if="!servers.length" class="wrd-muted">No STUN/TURN servers configured</div>
        <div v-for="(s, i) in servers" :key="i" style="margin-bottom: 4px">
          <div v-for="u in s.urls" :key="u" class="mono">
            <n-tag size="tiny" :bordered="false" :type="/^turns?:/.test(u) ? 'warning' : 'info'">{{ u.split(':')[0] }}</n-tag>
            {{ u }}
            <span v-if="turnProvider(u)" class="wrd-muted"> · {{ turnProvider(u) }}</span>
          </div>
        </div>
      </n-card>
      <n-card size="small" :title="`Candidate errors (${errors.length})`">
        <div v-if="!errors.length" class="wrd-muted">No icecandidateerror events</div>
        <table v-else class="errors">
          <tr v-for="(e, i) in errors" :key="i">
            <td class="mono wrd-muted">{{ formatTime(e.ts) }}</td>
            <td><n-tag size="tiny" :bordered="false" type="error">{{ e.errorCode }}</n-tag></td>
            <td class="mono">{{ e.url }}</td>
            <td>{{ e.errorText }}</td>
          </tr>
        </table>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.errors td {
  padding: 2px 8px 2px 0;
  white-space: nowrap;
}
</style>
