<script setup lang="ts">
import { NTag } from 'naive-ui';
import { formatRelative, formatTime, stateTone } from '../../lib/format';

defineProps<{ title: string; current: string; changes: { ts: number; value: string }[]; origin: number }>();
</script>

<template>
  <div class="state-tl">
    <div class="head">
      <span class="wrd-section-title" style="margin: 0">{{ title }}</span>
      <n-tag size="small" :type="stateTone(current)" :bordered="false">{{ current }}</n-tag>
    </div>
    <div class="steps">
      <div v-for="(c, i) in changes" :key="i" class="step" :title="formatTime(c.ts)">
        <span class="wrd-dot" :class="stateTone(c.value)" />
        <span class="v">{{ c.value }}</span>
        <span class="t mono">{{ formatRelative(c.ts, origin) }}</span>
      </div>
      <span v-if="!changes.length" class="wrd-muted">no changes yet</span>
    </div>
  </div>
</template>

<style scoped>
.state-tl {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.steps {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 0;
}
.step {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 10px;
  margin-right: 6px;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
}
.step:last-child {
  border-right: none;
}
.t {
  opacity: 0.5;
}
</style>
