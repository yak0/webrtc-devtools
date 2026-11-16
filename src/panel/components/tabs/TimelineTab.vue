<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { NButton, NCheckbox, NDataTable, NInput, NTag, type DataTableColumns } from 'naive-ui';
import type { TraceEvent } from '@/shared/protocol';
import type { PcModel } from '../../store/session';
import { compactJson, formatRelative, formatTime, stateTone } from '../../lib/format';
import JsonBlock from '../common/JsonBlock.vue';

const props = defineProps<{ pc: PcModel }>();

const query = ref('');
const showCalls = ref(true);
const showEvents = ref(true);
const showCandidates = ref(true);
const absolute = ref(false);
const selectedSeq = ref<number | null>(null);

const STATE_EVENTS = new Set(['connectionstatechange', 'iceconnectionstatechange', 'icegatheringstatechange', 'signalingstatechange']);
const CANDIDATE_NAMES = new Set(['icecandidate', 'addIceCandidate']);

const rows = computed(() => {
  void props.pc.rev;
  const q = query.value.trim().toLowerCase();
  return props.pc.events.filter((e) => {
    if (!showCandidates.value && CANDIDATE_NAMES.has(e.name)) return false;
    if (!showCalls.value && e.kind === 'call') return false;
    if (!showEvents.value && e.kind !== 'call' && !CANDIDATE_NAMES.has(e.name)) return false;
    if (!q) return true;
    return (
      e.name.toLowerCase().includes(q) ||
      (e.target ?? '').toLowerCase().includes(q) ||
      compactJson(e.value ?? e.args, 2000).toLowerCase().includes(q) ||
      compactJson(e.result, 2000).toLowerCase().includes(q)
    );
  });
});

const selected = computed<TraceEvent | undefined>(() => {
  void props.pc.rev;
  return props.pc.events.find((e) => e.seq === selectedSeq.value);
});

function summary(e: TraceEvent): string {
  if (e.kind === 'call') {
    const args = Array.isArray(e.args) && e.args.length === 0 ? '' : compactJson(e.args, 120);
    if (e.error) return `${args}  ✕ ${e.error.name}: ${e.error.message}`;
    const sdpArg = Array.isArray(e.args) && (e.args[0] as any)?.sdp ? `{type: ${(e.args[0] as any).type}, sdp: …}` : args;
    const res = e.result && typeof e.result === 'object' && ('sdp' in (e.result as any) || 'localDescription' in (e.result as any) || 'remoteDescription' in (e.result as any))
      ? '→ description'
      : e.result !== undefined
        ? `→ ${compactJson(e.result, 80)}`
        : '';
    return `${sdpArg} ${res}`.trim();
  }
  if (e.name === 'icecandidate') return e.value ? String((e.value as any).candidate || '(end-of-candidates for m-line)') : 'null (gathering finished)';
  return compactJson(e.value, 200);
}

const columns = computed<DataTableColumns<TraceEvent>>(() => [
  {
    title: 'Time',
    key: 'ts',
    width: 110,
    render: (e) => h('span', { class: 'mono' }, absolute.value ? formatTime(e.ts) : formatRelative(e.ts, props.pc.info.createdAt))
  },
  {
    title: 'Name',
    key: 'name',
    width: 230,
    ellipsis: { tooltip: true },
    render: (e) =>
      h('span', { style: 'display:flex;align-items:center;gap:6px' }, [
        h(NTag, { size: 'tiny', bordered: false, type: e.kind === 'call' ? 'info' : e.kind === 'note' ? 'default' : 'success' }, () =>
          e.kind === 'call' ? 'call' : e.kind === 'note' ? 'note' : 'event'
        ),
        h('span', { style: e.error ? 'color:#d03050' : '' }, e.target ? `${e.target}.${e.name}` : e.name)
      ])
  },
  {
    title: 'Details',
    key: 'details',
    ellipsis: true,
    render: (e) =>
      STATE_EVENTS.has(e.name) && typeof e.value === 'string'
        ? h(NTag, { size: 'tiny', bordered: false, type: stateTone(e.value) }, () => e.value as string)
        : h('span', { class: 'mono', style: e.error ? 'color:#d03050' : '' }, summary(e))
  },
  {
    title: 'Duration',
    key: 'duration',
    width: 80,
    align: 'right',
    render: (e) => (e.kind !== 'call' ? '' : e.pending ? h('span', { class: 'wrd-muted' }, 'pending') : e.duration !== undefined ? `${e.duration} ms` : '')
  }
]);

const rowProps = (e: TraceEvent) => ({
  style: 'cursor:pointer',
  class: e.seq === selectedSeq.value ? 'row-selected' : '',
  onClick: () => (selectedSeq.value = e.seq === selectedSeq.value ? null : e.seq)
});
</script>

<template>
  <div class="timeline">
    <div class="filters">
      <n-input v-model:value="query" size="small" placeholder="Filter (name, SDP, candidate…)" clearable style="max-width: 260px" />
      <n-checkbox v-model:checked="showCalls" size="small">API calls</n-checkbox>
      <n-checkbox v-model:checked="showEvents" size="small">Events</n-checkbox>
      <n-checkbox v-model:checked="showCandidates" size="small">ICE candidates</n-checkbox>
      <n-checkbox v-model:checked="absolute" size="small">Wall clock</n-checkbox>
      <span class="wrd-muted" v-if="pc.droppedEvents">{{ pc.droppedEvents }} older entries dropped</span>
    </div>
    <div class="body">
      <n-data-table
        class="table"
        size="small"
        :columns="columns"
        :data="rows"
        :row-key="(e: TraceEvent) => e.seq"
        :row-props="rowProps"
        virtual-scroll
        flex-height
        :bordered="false"
      />
      <aside v-if="selected" class="detail wrd-pad">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px">
          <strong>{{ selected.target ? `${selected.target}.` : '' }}{{ selected.name }}</strong>
          <span class="wrd-muted mono">{{ formatTime(selected.ts) }}</span>
          <span style="flex: 1" />
          <n-button size="tiny" quaternary @click="selectedSeq = null">✕</n-button>
        </div>
        <template v-if="selected.error">
          <div class="wrd-section-title" style="color: #d03050">Error</div>
          <JsonBlock :value="selected.error" />
        </template>
        <template v-if="selected.args !== undefined">
          <div class="wrd-section-title">Arguments</div>
          <JsonBlock :value="selected.args" :max-height="300" />
        </template>
        <template v-if="selected.result !== undefined">
          <div class="wrd-section-title" style="margin-top: 8px">Result</div>
          <JsonBlock :value="selected.result" :max-height="300" />
        </template>
        <template v-if="selected.value !== undefined">
          <div class="wrd-section-title">Value</div>
          <JsonBlock :value="selected.value" :max-height="300" />
        </template>
        <template v-if="selected.stack">
          <div class="wrd-section-title" style="margin-top: 8px">Called from</div>
          <JsonBlock :value="selected.stack" raw />
        </template>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.timeline {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.filters {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 12px;
  flex-wrap: wrap;
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.table {
  flex: 1;
  min-width: 0;
  height: 100%;
}
.detail {
  width: 42%;
  min-width: 300px;
  overflow: auto;
  border-left: 1px solid rgba(128, 128, 128, 0.25);
}
:deep(.row-selected td) {
  background: rgba(32, 128, 240, 0.15) !important;
}
@media (max-width: 600px) {
  .body {
    position: relative;
  }
  .detail {
    position: absolute;
    inset: 0;
    width: auto;
    min-width: 0;
    z-index: 2;
    background: var(--wrd-bg);
  }
}
</style>
