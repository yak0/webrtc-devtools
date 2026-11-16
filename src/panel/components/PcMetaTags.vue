<script setup lang="ts">
import { computed } from 'vue';
import { NPopover, NTag } from 'naive-ui';
import type { PcModel } from '../store/session';
import { metaOf } from '../store/meta';

const props = defineProps<{ pc: PcModel }>();
const meta = computed(() => {
  void props.pc.rev;
  void props.pc.dcRev;
  return metaOf(props.pc);
});
</script>

<template>
  <n-popover v-if="meta.sdk" trigger="hover" style="max-width: 520px">
    <template #trigger>
      <n-tag size="small" :bordered="false" :type="meta.sdk.confidence === 'high' ? 'info' : 'default'" style="cursor: help">
        {{ meta.sdk.name }}{{ meta.sdk.version ? ` ${meta.sdk.version}` : '' }}{{ meta.sdk.confidence === 'low' ? '?' : '' }}
      </n-tag>
    </template>
    <div class="wrd-section-title">Detected {{ meta.sdk.name }} ({{ meta.sdk.confidence }} confidence)</div>
    <ul style="margin: 0; padding-left: 16px">
      <li v-for="e in meta.sdk.evidence" :key="e" class="mono">{{ e }}</li>
    </ul>
  </n-popover>
  <n-tag v-if="meta.role !== 'unknown'" size="small" :bordered="false" :title="meta.offerer === null ? '' : meta.offerer ? 'This side created the offer' : 'This side answered'">
    {{ meta.role }}{{ meta.offerer === null ? '' : meta.offerer ? ' · offerer' : ' · answerer' }}
  </n-tag>
</template>
