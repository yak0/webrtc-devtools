<script setup lang="ts">
import { computed, onBeforeUnmount, provide } from 'vue';
import { NConfigProvider, NMessageProvider, NDialogProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import type { Bridge } from './bridge';
import { getPc, session } from './store/session';
import Sidebar from './components/Sidebar.vue';
import ConnectionView from './components/ConnectionView.vue';
import MediaView from './components/MediaView.vue';
import EmptyState from './components/EmptyState.vue';
import ToolsView from './components/ToolsView.vue';
import CompareView from './components/CompareView.vue';
import { startProblemWatcher } from './store/problems';

const props = defineProps<{ bridge: Bridge }>();
provide('bridge', props.bridge);

const dark = props.bridge.theme() === 'dark';
provide('dark', dark);
const theme = dark ? darkTheme : null;
const overrides: GlobalThemeOverrides = {
  common: {
    fontSize: '12px',
    fontSizeMedium: '12px',
    fontSizeSmall: '12px',
    fontSizeTiny: '11px',
    heightMedium: '28px',
    heightSmall: '24px',
    heightTiny: '20px',
    borderRadius: '4px',
    fontFamilyMono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    ...(dark ? { bodyColor: '#1e1e1e', cardColor: '#262626', modalColor: '#262626', popoverColor: '#2b2b2b' } : {})
  },
  Card: { paddingSmall: '8px 12px' },
  DataTable: { thPaddingSmall: '4px 8px', tdPaddingSmall: '3px 8px', fontSizeSmall: '12px' },
  Tabs: { tabFontSizeSmall: '12px', tabPaddingSmallLine: '6px 0' }
};

const pc = computed(() => getPc(session.selected));
const stopWatcher = startProblemWatcher(props.bridge);
onBeforeUnmount(stopWatcher);
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="overrides" abstract inline-theme-disabled>
    <n-message-provider>
      <n-dialog-provider>
        <div class="wrd-app" :style="{ background: dark ? '#1e1e1e' : '#fff', color: dark ? '#ddd' : '#222', '--wrd-bg': dark ? '#1e1e1e' : '#fff' }">
          <Sidebar />
          <main class="wrd-main">
            <MediaView v-if="session.view === 'media'" />
            <ToolsView v-else-if="session.view === 'tools'" />
            <CompareView v-else-if="session.view === 'compare'" />
            <ConnectionView v-else-if="pc" :key="pc.id" :pc="pc" />
            <EmptyState v-else />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
