<script setup lang="ts">
import { reactive } from 'vue';
import type { Insight } from '../../lib/insights';

defineProps<{ insights: Insight[] }>();
/** User toggles by insight id; errors start expanded, everything else collapsed. */
const toggled = reactive<Record<string, boolean>>({});
const open = (i: Insight) => toggled[i.id] ?? i.level === 'error';
const expandable = (i: Insight) => !!i.detail || !!i.items?.length;
const ICON: Record<Insight['level'], string> = { error: '✕', warning: '!', info: 'i', success: '✓' };
</script>

<template>
  <div class="insights">
    <div v-for="i in insights" :key="i.id" class="row" :class="[i.level, { open: open(i), clickable: expandable(i) }]">
      <div class="head" @click="expandable(i) && (toggled[i.id] = !open(i))">
        <span class="icon">{{ ICON[i.level] }}</span>
        <span class="title">{{ i.title }}</span>
        <span v-if="i.items?.length" class="count">{{ i.items.length }}</span>
        <span v-if="expandable(i)" class="chev">{{ open(i) ? '▾' : '▸' }}</span>
      </div>
      <div v-if="open(i) && expandable(i)" class="body">
        <div v-if="i.detail">{{ i.detail }}</div>
        <ul v-if="i.items?.length">
          <li v-for="item in i.items" :key="item" class="mono">{{ item }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insights {
  display: flex;
  flex-direction: column;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.2);
}
.row {
  border-left: 3px solid var(--c);
  background: color-mix(in srgb, var(--c) 7%, transparent);
}
.row + .row {
  border-top: 1px solid rgba(128, 128, 128, 0.15);
}
.row.error {
  --c: #d03050;
}
.row.warning {
  --c: #f0a020;
}
.row.info {
  --c: #2080f0;
}
.row.success {
  --c: #18a058;
}
.head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  min-height: 22px;
}
.clickable .head {
  cursor: pointer;
}
.clickable .head:hover {
  background: rgba(128, 128, 128, 0.08);
}
.icon {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.open .title {
  white-space: normal;
}
.count {
  font-size: 10px;
  opacity: 0.7;
  border: 1px solid rgba(128, 128, 128, 0.4);
  border-radius: 8px;
  padding: 0 5px;
}
.chev {
  opacity: 0.5;
  width: 10px;
}
.body {
  padding: 0 10px 6px 32px;
  opacity: 0.85;
  line-height: 1.5;
}
.body ul {
  margin: 4px 0 0;
  padding-left: 16px;
}
</style>
