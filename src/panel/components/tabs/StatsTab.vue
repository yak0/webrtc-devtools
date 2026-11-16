<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { NCheckbox, NEmpty, NInput, NTag } from 'naive-ui';
import type { PcModel } from '../../store/session';
import { formatNumber } from '../../lib/format';
import UPlotChart from '../common/UPlotChart.vue';

const props = defineProps<{ pc: PcModel }>();
const query = ref('');
const selectedId = ref<string | null>(null);
/** statId -> charted fields */
const charted = reactive<Record<string, string[]>>({});

const TYPE_ORDER = ['outbound-rtp', 'inbound-rtp', 'remote-inbound-rtp', 'remote-outbound-rtp', 'media-source', 'media-playout', 'candidate-pair', 'transport', 'data-channel', 'peer-connection', 'local-candidate', 'remote-candidate', 'codec', 'certificate'];

const groups = computed(() => {
  void props.pc.statsRev;
  const q = query.value.trim().toLowerCase();
  const map = new Map<string, { id: string; label: string }[]>();
  for (const obj of props.pc.stats.current.values()) {
    const type = String(obj.type ?? 'unknown');
    const id = String(obj.id);
    const label = [obj.kind, obj.rid ? `rid=${obj.rid}` : '', obj.ssrc ? `ssrc ${obj.ssrc}` : '', obj.mimeType, obj.candidateType, obj.address, obj.label, obj.state]
      .filter(Boolean)
      .join(' ');
    if (q && !`${type} ${id} ${label}`.toLowerCase().includes(q)) continue;
    if (!map.has(type)) map.set(type, []);
    map.get(type)!.push({ id, label });
  }
  return [...map.entries()].sort((a, b) => {
    const ia = TYPE_ORDER.indexOf(a[0]);
    const ib = TYPE_ORDER.indexOf(b[0]);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0]);
  });
});

watch(
  groups,
  (g) => {
    if (!selectedId.value || !props.pc.stats.current.has(selectedId.value)) selectedId.value = g[0]?.[1][0]?.id ?? null;
  },
  { immediate: true }
);

const selected = computed(() => {
  void props.pc.statsRev;
  return selectedId.value ? props.pc.stats.current.get(selectedId.value) : undefined;
});

const DEFAULT_CHARTS: Record<string, string[]> = {
  'outbound-rtp': ['[bytesSent_in_bits/s]', 'framesPerSecond', '[packetsSent/s]'],
  'inbound-rtp': ['[bytesReceived_in_bits/s]', 'framesPerSecond', '[packetLoss%]', 'jitter'],
  'remote-inbound-rtp': ['roundTripTime', 'fractionLost', 'jitter'],
  'candidate-pair': ['currentRoundTripTime', 'availableOutgoingBitrate', '[bytesSent_in_bits/s]', '[bytesReceived_in_bits/s]'],
  transport: ['[bytesSent_in_bits/s]', '[bytesReceived_in_bits/s]'],
  'media-source': ['audioLevel', 'framesPerSecond'],
  'data-channel': ['[messagesSent/s]', '[messagesReceived/s]', '[bytesSent_in_bits/s]', '[bytesReceived_in_bits/s]']
};

const fieldsOfSelected = computed(() => {
  void props.pc.statsRev;
  const id = selectedId.value;
  const obj = selected.value;
  if (!id || !obj) return [];
  const seriesFields = new Set(props.pc.stats.fields(id));
  const rows: { field: string; value: string; chartable: boolean }[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'id' || k === 'type') continue;
    rows.push({ field: k, value: typeof v === 'object' ? JSON.stringify(v) : formatNumber(v, 4), chartable: seriesFields.has(k) });
  }
  for (const f of seriesFields) {
    if (f.startsWith('[')) rows.push({ field: f, value: formatNumber(props.pc.stats.latest(id, f), 2), chartable: true });
  }
  return rows.sort((a, b) => Number(a.field.startsWith('[')) - Number(b.field.startsWith('[')) || a.field.localeCompare(b.field));
});

const chartFields = computed(() => {
  const id = selectedId.value;
  if (!id) return [];
  if (!charted[id]) {
    const available = new Set(props.pc.stats.fields(id));
    charted[id] = (DEFAULT_CHARTS[String(selected.value?.type)] ?? []).filter((f) => available.has(f));
  }
  return charted[id];
});

function toggle(field: string, on: boolean) {
  const id = selectedId.value!;
  const list = chartFields.value.filter((f) => f !== field);
  charted[id] = on ? [...list, field] : list;
}
</script>

<template>
  <div class="stats">
    <nav class="list">
      <div style="padding: 6px">
        <n-input v-model:value="query" size="small" placeholder="Filter stats" clearable />
      </div>
      <template v-for="[type, items] in groups" :key="type">
        <div class="group">{{ type }} · {{ items.length }}</div>
        <div v-for="it in items" :key="it.id" class="item" :class="{ active: it.id === selectedId }" @click="selectedId = it.id">
          <div class="mono">{{ it.id }}</div>
          <div class="wrd-muted ellipsis">{{ it.label }}</div>
        </div>
      </template>
      <div v-if="!groups.length" class="wrd-muted" style="padding: 10px">No stats yet</div>
    </nav>
    <section class="view">
      <n-empty v-if="!selected" description="Select a stats object" style="margin-top: 40px" />
      <div v-else class="wrd-pad">
        <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px">
          <n-tag size="small" :bordered="false" type="info">{{ selected.type }}</n-tag>
          <strong class="mono">{{ selected.id }}</strong>
        </div>
        <div v-if="chartFields.length && pc.stats.times.length > 1" class="charts">
          <div v-for="f in chartFields" :key="f" class="chart">
            <div class="mono wrd-muted">{{ f }}</div>
            <UPlotChart :times="pc.stats.times" :series="[{ label: f, data: pc.stats.get(selectedId!, f) }]" :version="pc.statsRev" :height="100" :legend="false" :sync-key="pc.id" />
          </div>
        </div>
        <table class="fields">
          <tr v-for="r in fieldsOfSelected" :key="r.field">
            <td style="width: 24px">
              <n-checkbox v-if="r.chartable" size="small" :checked="chartFields.includes(r.field)" @update:checked="(v: boolean) => toggle(r.field, v)" />
            </td>
            <td class="mono k">{{ r.field }}</td>
            <td class="mono">{{ r.value }}</td>
          </tr>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.stats {
  display: flex;
  height: 100%;
  min-height: 0;
}
.list {
  width: 240px;
  flex: none;
  overflow: auto;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
}
.group {
  padding: 8px 10px 2px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.6;
}
.item {
  padding: 3px 10px;
  cursor: pointer;
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(32, 128, 240, 0.2);
}
.ellipsis {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.view {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.charts {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.fields {
  border-collapse: collapse;
  width: 100%;
}
.fields td {
  padding: 1px 8px 1px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.1);
  word-break: break-all;
}
.fields .k {
  opacity: 0.75;
  white-space: nowrap;
  width: 1%;
}
@media (max-width: 600px) {
  .stats {
    flex-direction: column;
  }
  .list {
    width: auto;
    max-height: 30%;
    border-right: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
}
</style>
