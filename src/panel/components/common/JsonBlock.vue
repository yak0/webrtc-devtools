<script setup lang="ts">
import { computed } from 'vue';
import { NButton, NIcon, useMessage } from 'naive-ui';
import { Copy } from '@vicons/carbon';
import { prettyJson } from '../../lib/format';

const props = defineProps<{ value: unknown; maxHeight?: number; raw?: boolean }>();
const message = useMessage();
const text = computed(() => (props.raw && typeof props.value === 'string' ? props.value : prettyJson(props.value)));

async function copy() {
  try {
    await navigator.clipboard.writeText(text.value);
  } catch {
    // DevTools panels may not have clipboard permission: fall back to execCommand.
    const ta = document.createElement('textarea');
    ta.value = text.value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  message.success('Copied');
}
</script>

<template>
  <div class="json-block">
    <n-button class="copy" quaternary size="tiny" @click="copy">
      <template #icon><n-icon :component="Copy" /></template>
    </n-button>
    <pre class="wrd-pre" :style="{ maxHeight: maxHeight ? maxHeight + 'px' : undefined, overflow: 'auto' }">{{ text }}</pre>
  </div>
</template>

<style scoped>
.json-block {
  position: relative;
  background: rgba(128, 128, 128, 0.08);
  border-radius: 4px;
  padding: 6px 8px;
}
.copy {
  position: absolute;
  right: 2px;
  top: 2px;
  opacity: 0.6;
}
</style>
