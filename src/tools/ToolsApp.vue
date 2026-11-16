<script setup lang="ts">
import { computed, onBeforeUnmount, provide, ref } from 'vue';
import { NConfigProvider, NMessageProvider, darkTheme, type GlobalThemeOverrides } from 'naive-ui';
import DevicesTool from './components/DevicesTool.vue';
import CameraTool from './components/CameraTool.vue';
import MicTool from './components/MicTool.vue';
import SpeakerTool from './components/SpeakerTool.vue';
import ScreenTool from './components/ScreenTool.vue';
import LoopbackTool from './components/LoopbackTool.vue';
import TurnTool from './components/TurnTool.vue';

const TOOLS = [
  { id: 'devices', label: 'Devices', desc: 'Cameras, microphones and speakers' },
  { id: 'camera', label: 'Camera', desc: 'Preview, resolutions, frame rate' },
  { id: 'microphone', label: 'Microphone', desc: 'Level, processing, recording' },
  { id: 'speakers', label: 'Speakers', desc: 'Output device and channels' },
  { id: 'screen', label: 'Screen share', desc: 'getDisplayMedia check' },
  { id: 'loopback', label: 'Call quality', desc: 'Local encode/decode test' },
  { id: 'turn', label: 'STUN / TURN', desc: 'ICE server reachability' }
] as const;
type ToolId = (typeof TOOLS)[number]['id'];

const current = ref<ToolId>('devices');
function fromHash() {
  const h = location.hash.slice(1) as ToolId;
  current.value = TOOLS.some((t) => t.id === h) ? h : 'devices';
}
fromHash();
window.addEventListener('hashchange', fromHash);
onBeforeUnmount(() => window.removeEventListener('hashchange', fromHash));

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
provide('dark', dark);
const overrides: GlobalThemeOverrides = {
  common: {
    fontSize: '13px',
    fontSizeMedium: '13px',
    borderRadius: '4px',
    ...(dark ? { bodyColor: '#1e1e1e', cardColor: '#262626', popoverColor: '#2b2b2b' } : {})
  }
};
const title = computed(() => TOOLS.find((t) => t.id === current.value));
</script>

<template>
  <n-config-provider :theme="dark ? darkTheme : null" :theme-overrides="overrides" abstract>
    <n-message-provider>
      <div class="wrd-app tools" :style="{ background: dark ? '#1e1e1e' : '#f7f7f8', color: dark ? '#ddd' : '#222', '--wrd-bg': dark ? '#1e1e1e' : '#f7f7f8' }">
        <nav class="nav">
          <div class="brand"><img src="/icons/32.png" alt="" /> WebRTC DevTools</div>
          <div class="sub wrd-muted">Device & network tests</div>
          <a v-for="t in TOOLS" :key="t.id" :href="`#${t.id}`" class="item" :class="{ active: t.id === current }">
            <span class="label">{{ t.label }}</span>
            <span class="desc">{{ t.desc }}</span>
          </a>
          <div class="note wrd-muted">Everything runs locally in this tab. Nothing is uploaded.</div>
        </nav>
        <main class="wrd-main">
          <div class="wrd-scroll">
            <div class="content">
              <h1>{{ title?.label }}</h1>
              <DevicesTool v-if="current === 'devices'" />
              <CameraTool v-else-if="current === 'camera'" />
              <MicTool v-else-if="current === 'microphone'" />
              <SpeakerTool v-else-if="current === 'speakers'" />
              <ScreenTool v-else-if="current === 'screen'" />
              <LoopbackTool v-else-if="current === 'loopback'" />
              <TurnTool v-else-if="current === 'turn'" />
            </div>
          </div>
        </main>
      </div>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.tools {
  height: 100vh;
}
.nav {
  width: 220px;
  flex: none;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
  padding: 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  font-size: 14px;
  padding: 0 8px;
}
.brand img {
  width: 20px;
}
.sub {
  padding: 0 8px 10px 36px;
  font-size: 12px;
}
.item {
  display: flex;
  flex-direction: column;
  padding: 6px 10px;
  border-radius: 6px;
  color: inherit;
  text-decoration: none;
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(32, 128, 240, 0.18);
}
.label {
  font-weight: 500;
}
.desc {
  font-size: 11px;
  opacity: 0.6;
}
.note {
  margin-top: auto;
  font-size: 11px;
  padding: 8px;
}
.content {
  max-width: 1100px;
  padding: 16px 24px 40px;
}
h1 {
  font-size: 20px;
  margin: 0 0 14px;
}
@media (max-width: 700px) {
  .tools {
    flex-direction: column;
    height: auto;
    min-height: 100vh;
  }
  .nav {
    width: auto;
    flex-direction: row;
    flex-wrap: wrap;
    border-right: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
  .desc,
  .sub,
  .note {
    display: none;
  }
}
</style>
