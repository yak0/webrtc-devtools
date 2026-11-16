<script setup lang="ts">
import { computed, h, ref } from 'vue';
import { NAlert, NCard, NDataTable, NEmpty, NInput, NSelect, NTag, type DataTableColumns } from 'naive-ui';
import type { DataChannelMessage } from '@/shared/protocol';
import type { DcModel, PcModel } from '../../store/session';
import { settings } from '../../settings';
import { formatBytes, formatTime, stateTone } from '../../lib/format';

const props = defineProps<{ pc: PcModel }>();
const channelFilter = ref<string>('');
const query = ref('');
const selected = ref<DataChannelMessage | null>(null);

const channels = computed(() => {
  void props.pc.dcRev;
  return [...props.pc.dataChannels.values()];
});
const labelOf = computed(() => {
  const map = new Map<string, string>();
  for (const c of channels.value) map.set(c.key, c.label);
  return map;
});
const messages = computed(() => {
  void props.pc.dcRev;
  const q = query.value.toLowerCase();
  return props.pc.dcMessages
    .filter((m) => (!channelFilter.value || m.key === channelFilter.value) && (!q || m.preview.toLowerCase().includes(q)))
    .slice()
    .reverse();
});

const channelColumns: DataTableColumns<DcModel> = [
  { title: 'Label', key: 'label', width: 120, render: (c) => h('strong', c.label || '(empty)') },
  { title: 'id', key: 'id', width: 50, render: (c) => (c.id === null ? '—' : String(c.id)) },
  { title: 'State', key: 'readyState', width: 90, render: (c) => h(NTag, { size: 'tiny', bordered: false, type: stateTone(c.readyState) }, () => c.readyState) },
  { title: 'Created by', key: 'origin', width: 90, render: (c) => (c.origin === 'local' ? 'this side' : 'remote') },
  {
    title: 'Reliability',
    key: 'rel',
    render: (c) =>
      `${c.ordered ? 'ordered' : 'unordered'}${c.maxRetransmits !== null ? `, maxRetransmits ${c.maxRetransmits}` : ''}${c.maxPacketLifeTime !== null ? `, maxPacketLifeTime ${c.maxPacketLifeTime}` : ''}${c.negotiated ? ', negotiated' : ''}`
  },
  { title: 'Protocol', key: 'protocol', width: 80, render: (c) => c.protocol || '—' },
  { title: 'Sent', key: 'sent', render: (c) => `${c.messagesSent} msg · ${formatBytes(c.bytesSent)}` },
  { title: 'Received', key: 'recv', render: (c) => `${c.messagesReceived} msg · ${formatBytes(c.bytesReceived)}` }
];

const messageColumns: DataTableColumns<DataChannelMessage> = [
  { title: 'Time', key: 'ts', width: 100, render: (m) => h('span', { class: 'mono' }, formatTime(m.ts)) },
  { title: '', key: 'dir', width: 28, render: (m) => h('span', { style: `color:${m.direction === 'sent' ? '#2080f0' : '#18a058'}` }, m.direction === 'sent' ? '↑' : '↓') },
  { title: 'Channel', key: 'key', width: 110, ellipsis: true, render: (m) => labelOf.value.get(m.key) ?? m.key },
  { title: 'Size', key: 'size', width: 80, render: (m) => formatBytes(m.size) },
  {
    title: 'Data',
    key: 'preview',
    ellipsis: true,
    render: (m) => h('span', { class: 'mono' }, [m.binary ? h(NTag, { size: 'tiny', bordered: false, style: 'margin-right:6px' }, () => 'binary') : null, m.preview.slice(0, 300)])
  }
];

const channelOptions = computed(() => [{ label: 'All channels', value: '' }, ...channels.value.map((c) => ({ label: c.label || c.key, value: c.key }))]);
const rowProps = (m: DataChannelMessage) => ({ style: 'cursor:pointer', onClick: () => (selected.value = m) });
const prettyPreview = computed(() => {
  const m = selected.value;
  if (!m || m.binary) return m?.preview ?? '';
  try {
    return JSON.stringify(JSON.parse(m.preview), null, 2);
  } catch {
    return m.preview;
  }
});
</script>

<template>
  <div class="dc">
    <div class="wrd-pad">
      <n-card size="small" :title="`Channels (${channels.length})`">
        <n-data-table v-if="channels.length" size="small" :scroll-x="860" :columns="channelColumns" :data="channels" :row-key="(c: DcModel) => c.key" :bordered="false" />
        <n-empty v-else size="small" description="No data channels on this connection" />
      </n-card>
    </div>
    <div class="filters">
      <strong>Messages</strong>
      <n-select v-model:value="channelFilter" :options="channelOptions" size="small" style="width: 180px" />
      <n-input v-model:value="query" size="small" placeholder="Search payloads" clearable style="max-width: 240px" />
      <span class="wrd-muted">{{ pc.dcMessages.length }} captured</span>
      <span v-if="pc.dcDropped" style="color: #f0a020">{{ pc.dcDropped }} dropped (rate limit 300 msg/s)</span>
    </div>
    <n-alert v-if="!settings.captureDataChannelMessages" type="info" :bordered="false" style="margin: 0 12px 8px">
      Message capture is turned off in settings.
    </n-alert>
    <div class="body">
      <n-data-table class="table" size="small" :columns="messageColumns" :data="messages" :row-props="rowProps" virtual-scroll flex-height :bordered="false" />
      <aside v-if="selected" class="detail wrd-pad">
        <div style="display: flex; justify-content: space-between; margin-bottom: 6px">
          <span>
            <strong>{{ selected.direction === 'sent' ? 'Sent' : 'Received' }}</strong>
            on {{ labelOf.get(selected.key) }} · {{ formatBytes(selected.size) }} · {{ formatTime(selected.ts) }}
          </span>
          <a style="cursor: pointer" @click="selected = null">✕</a>
        </div>
        <div v-if="selected.truncated" class="wrd-muted" style="margin-bottom: 4px">Preview truncated</div>
        <pre class="wrd-pre">{{ prettyPreview }}</pre>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.dc {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.filters {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 0 12px 8px;
  flex-wrap: wrap;
}
.body {
  flex: 1;
  min-height: 220px;
  display: flex;
}
.table {
  flex: 1;
  min-width: 0;
  height: 100%;
}
.detail {
  width: 40%;
  overflow: auto;
  border-left: 1px solid rgba(128, 128, 128, 0.25);
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
