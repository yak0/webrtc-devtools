<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { NCard, NCheckbox, NDataTable, NEmpty, NTag, type DataTableColumns } from 'naive-ui';
import type { MediaCall, TrackEvent } from '@/shared/protocol';
import { session } from '../store/session';
import { compactJson, formatTime } from '../lib/format';
import JsonBlock from './common/JsonBlock.vue';

const showEnumerate = ref(false);
const selected = ref<MediaCall | null>(null);

const calls = computed(() => {
  void session.mediaRev;
  return session.media.filter((m) => showEnumerate.value || m.api !== 'enumerateDevices').slice().reverse();
});
const trackEvents = computed(() => {
  void session.mediaRev;
  return session.trackEvents.slice().reverse();
});

const columns: DataTableColumns<MediaCall> = [
  { title: 'Time', key: 'ts', width: 100, render: (m) => h('span', { class: 'mono' }, formatTime(m.ts)) },
  { title: 'API', key: 'api', width: 130 },
  { title: 'Constraints', key: 'constraints', ellipsis: { tooltip: true }, render: (m) => h('span', { class: 'mono' }, compactJson(m.constraints, 200)) },
  {
    title: 'Result',
    key: 'result',
    render: (m) => {
      if (m.pending) return h(NTag, { size: 'tiny', bordered: false, type: 'warning' }, () => 'pending (permission prompt?)');
      if (m.error) return h(NTag, { size: 'tiny', bordered: false, type: 'error' }, () => `${m.error!.name}${m.error!.constraint ? ` (${m.error!.constraint})` : ''}`);
      if (m.result?.tracks) return h('span', m.result.tracks.map((t) => `${t.kind}: ${t.label || t.id}`).join(' · '));
      if (m.result?.devices) return h('span', `${(m.result.devices as unknown[]).length} devices`);
      return '';
    }
  },
  { title: 'Duration', key: 'duration', width: 80, align: 'right', render: (m) => (m.duration !== undefined ? `${m.duration} ms` : '') }
];

const trackColumns: DataTableColumns<TrackEvent> = [
  { title: 'Time', key: 'ts', width: 100, render: (e) => h('span', { class: 'mono' }, formatTime(e.ts)) },
  { title: 'Event', key: 'event', width: 80, render: (e) => h(NTag, { size: 'tiny', bordered: false, type: e.event === 'ended' || e.event === 'stop' ? 'error' : e.event === 'mute' ? 'warning' : 'success' }, () => e.event) },
  { title: 'Kind', key: 'kind', width: 70 },
  { title: 'Track', key: 'trackId', render: (e) => h('span', { class: 'mono' }, e.trackId) }
];

const rowProps = (m: MediaCall) => ({ style: 'cursor:pointer', onClick: () => (selected.value = m) });
</script>

<template>
  <div class="wrd-scroll">
    <div class="wrd-pad wrd-grid">
      <n-card size="small">
        <template #header>
          <div style="display: flex; align-items: center; gap: 12px">
            <span>getUserMedia / getDisplayMedia</span>
            <n-checkbox v-model:checked="showEnumerate" size="small">Show enumerateDevices</n-checkbox>
          </div>
        </template>
        <n-data-table v-if="calls.length" size="small" :columns="columns" :data="calls" :row-props="rowProps" :bordered="false" max-height="320" />
        <n-empty v-else size="small" description="No media requests on this page yet" />
      </n-card>

      <n-card v-if="selected" size="small" :title="`${selected.api} at ${formatTime(selected.ts)}`" closable @close="selected = null">
        <div class="wrd-grid cols-2">
          <div>
            <div class="wrd-section-title">Constraints</div>
            <JsonBlock :value="selected.constraints ?? null" :max-height="320" />
            <template v-if="selected.error">
              <div class="wrd-section-title" style="margin-top: 8px; color: #d03050">Error</div>
              <JsonBlock :value="selected.error" />
            </template>
            <template v-if="selected.stack">
              <div class="wrd-section-title" style="margin-top: 8px">Called from</div>
              <JsonBlock :value="selected.stack" raw />
            </template>
          </div>
          <div>
            <div class="wrd-section-title">Result</div>
            <JsonBlock :value="selected.result ?? null" :max-height="460" />
          </div>
        </div>
      </n-card>

      <n-card size="small" :title="`Track events (${trackEvents.length})`">
        <n-data-table v-if="trackEvents.length" size="small" :columns="trackColumns" :data="trackEvents" :bordered="false" max-height="260" />
        <div v-else class="wrd-muted">No ended / mute / unmute / stop events yet</div>
      </n-card>
    </div>
  </div>
</template>
