<script lang="ts">
import { ref } from 'vue';
// Shared across connections so switching PCs keeps the current tab.
const tab = ref('overview');
</script>

<script setup lang="ts">
import { computed } from 'vue';
import { NPopover, NTab, NTabs, NTag } from 'naive-ui';
import type { PcModel } from '../store/session';
import { formatTime, hostOf, stateTone } from '../lib/format';
import OverviewTab from './tabs/OverviewTab.vue';
import TimelineTab from './tabs/TimelineTab.vue';
import SdpTab from './tabs/SdpTab.vue';
import IceTab from './tabs/IceTab.vue';
import MediaTab from './tabs/MediaTab.vue';
import StatsTab from './tabs/StatsTab.vue';
import DataChannelsTab from './tabs/DataChannelsTab.vue';
import ControlsTab from './tabs/ControlsTab.vue';
import PcMetaTags from './PcMetaTags.vue';

const props = defineProps<{ pc: PcModel }>();

const dcCount = computed(() => {
  void props.pc.dcRev;
  return props.pc.dataChannels.size;
});
const eventCount = computed(() => {
  void props.pc.rev;
  return props.pc.events.length;
});
const tabs = computed(() => [
  { name: 'overview', label: 'Overview' },
  { name: 'timeline', label: `Timeline (${eventCount.value})` },
  { name: 'sdp', label: 'SDP' },
  { name: 'ice', label: 'ICE' },
  { name: 'media', label: 'Media' },
  { name: 'stats', label: 'Stats' },
  { name: 'datachannels', label: `Data channels${dcCount.value ? ` (${dcCount.value})` : ''}` },
  ...(props.pc.imported ? [] : [{ name: 'controls', label: 'Controls' }])
]);
</script>

<template>
  <div class="conn">
    <header class="conn-head">
      <strong>PC {{ pc.index }}</strong>
      <n-tag size="small" :bordered="false" :type="stateTone(pc.states.connectionState)">{{ pc.states.connectionState }}</n-tag>
      <n-tag v-if="pc.closed" size="small" :bordered="false">closed</n-tag>
      <n-tag v-if="pc.collected" size="small" :bordered="false" type="warning">garbage collected</n-tag>
      <n-tag v-if="pc.stale" size="small" :bordered="false">previous page</n-tag>
      <n-tag v-if="pc.imported" size="small" :bordered="false" type="info">imported</n-tag>
      <PcMetaTags :pc="pc" />
      <span class="wrd-muted mono ellipsis" :title="pc.frameUrl">{{ hostOf(pc.frameUrl) }}</span>
      <span style="flex: 1" />
      <n-popover v-if="pc.info.stack" trigger="hover" placement="bottom-end" style="max-width: 640px">
        <template #trigger>
          <span class="wrd-muted created">created {{ formatTime(pc.info.createdAt) }}</span>
        </template>
        <div class="wrd-section-title">new RTCPeerConnection() called from</div>
        <pre class="wrd-pre">{{ pc.info.stack }}</pre>
      </n-popover>
      <span v-else class="wrd-muted">created {{ formatTime(pc.info.createdAt) }}</span>
    </header>
    <n-tabs v-model:value="tab" type="line" size="small" class="conn-tabs" :tabs-padding="12">
      <n-tab v-for="t in tabs" :key="t.name" :name="t.name">{{ t.label }}</n-tab>
    </n-tabs>
    <div class="wrd-scroll">
      <OverviewTab v-if="tab === 'overview' || (tab === 'controls' && pc.imported)" :pc="pc" />
      <TimelineTab v-else-if="tab === 'timeline'" :pc="pc" />
      <SdpTab v-else-if="tab === 'sdp'" :pc="pc" />
      <IceTab v-else-if="tab === 'ice'" :pc="pc" />
      <MediaTab v-else-if="tab === 'media'" :pc="pc" />
      <StatsTab v-else-if="tab === 'stats'" :pc="pc" />
      <DataChannelsTab v-else-if="tab === 'datachannels'" :pc="pc" />
      <ControlsTab v-else-if="tab === 'controls'" :pc="pc" />
    </div>
  </div>
</template>

<style scoped>
.conn {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}
.conn-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  min-width: 0;
}
.ellipsis {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.created {
  cursor: help;
  text-decoration: underline dotted;
  white-space: nowrap;
}
.conn-tabs {
  flex: none;
}
</style>
