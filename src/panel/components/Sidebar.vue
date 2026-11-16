<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import {
  NButton,
  NCheckbox,
  NDropdown,
  NIcon,
  NInputNumber,
  NPopover,
  NSelect,
  NSwitch,
  NTag,
  NTooltip,
  useDialog,
  useMessage
} from 'naive-ui';
import { ChartLineData, Download, Microphone, Settings, Tools, TrashCan, Upload } from '@vicons/carbon';
import { chaosActive } from '@/shared/protocol';
import { appendModels, clearSession, loadModels, session, type PcModel } from '../store/session';
import { metaOf } from '../store/meta';
import { chaos, settings } from '../settings';
import { exportSession, importDump, readDumpFile } from '../lib/dump';
import { buildHtmlReport } from '../lib/html-report';
import { formatTime, hostOf, stateTone } from '../lib/format';
import { getRecordOrigins, originOf, setRecordOrigin, storageAvailable } from '../record';
import type { Bridge } from '../bridge';

const bridge = inject<Bridge>('bridge')!;
const message = useMessage();
const dialog = useDialog();
const fileInput = ref<HTMLInputElement>();
const isReport = bridge.kind === 'report';
const chaosOn = computed(() => chaosActive(chaos));

// ---- record from page load (per origin) ----
const origin = computed(() => originOf(session.pageUrl));
const recording = ref(false);
watch(
  origin,
  async (o) => {
    recording.value = !!o && (await getRecordOrigins()).includes(o);
  },
  { immediate: true }
);
async function toggleRecording(on: boolean) {
  if (!origin.value) return;
  await setRecordOrigin(origin.value, on);
  recording.value = on;
  message.info(on ? `Stats are now recorded from page load on ${origin.value} (takes effect on next load)` : 'Recording from page load turned off');
}

// ---- compact navigation (side panel / narrow DevTools): one select instead of the list ----
const navKey = computed(() => (session.view === 'pc' ? `pc:${session.selected ?? ''}` : session.view));
const navOptions = computed(() => [
  ...pcs.value.map((pc) => {
    const p = session.problems[pc.id];
    const flag = p?.errors ? ` ✕${p.errors}` : p?.warnings ? ` !${p.warnings}` : '';
    const sub = subtitle(pc);
    return { label: `PC ${pc.index} · ${stateOf(pc)}${sub ? ` · ${sub}` : ''}${flag}`, value: `pc:${pc.id}` };
  }),
  { label: `Media devices${mediaCount.value ? ` (${mediaCount.value})` : ''}`, value: 'media' },
  { label: 'Compare', value: 'compare' },
  ...(isReport ? [] : [{ label: chaosOn.value ? 'Tools (chaos active)' : 'Tools', value: 'tools' }])
]);
function navigate(key: string) {
  if (key.startsWith('pc:')) {
    session.view = 'pc';
    session.selected = key.slice(3);
  } else {
    session.view = key as typeof session.view;
  }
}

function subtitle(pc: PcModel) {
  void pc.rev;
  void pc.dcRev;
  const m = metaOf(pc);
  return [m.sdk && m.sdk.confidence !== 'low' ? m.sdk.name : '', m.role !== 'unknown' ? m.role : ''].filter(Boolean).join(' · ');
}

const pcs = computed(() => [...session.pcs].sort((a, b) => Number(a.stale) - Number(b.stale) || a.info.createdAt - b.info.createdAt));
const multiFrame = computed(() => new Set(session.pcs.map((p) => p.frameUrl)).size > 1);
const mediaCount = computed(() => {
  void session.mediaRev;
  return session.media.filter((m) => m.api !== 'enumerateDevices').length;
});

function stateOf(pc: PcModel) {
  void pc.rev;
  if (pc.collected) return 'collected';
  if (pc.closed) return 'closed';
  return pc.states.connectionState;
}

function select(pc: PcModel) {
  session.view = 'pc';
  session.selected = pc.id;
}

function download(content: BlobPart, type: string, ext: string) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  const host = hostOf(session.pageUrl).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'page';
  a.href = URL.createObjectURL(blob);
  a.download = `webrtc-devtools-${host}-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const currentDump = () => exportSession(session.pcs, session.media, session.trackEvents, session.pageUrl, session.userAgent, session.envByFrame);
const exportOptions = [
  { label: 'JSON (re-importable)', key: 'json' },
  { label: 'HTML report (opens without the extension)', key: 'html' }
];
async function onExport(key: string) {
  if (key === 'json') return download(JSON.stringify(currentDump()), 'application/json', 'json');
  try {
    const html = await buildHtmlReport(currentDump(), `WebRTC report · ${hostOf(session.pageUrl)}`);
    download(html, 'text/html', 'html');
  } catch (err) {
    message.error((err as Error).message);
  }
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = '';
  if (!file) return;
  let result: ReturnType<typeof importDump>;
  try {
    result = importDump(await readDumpFile(file));
  } catch (err) {
    message.error(`Import failed: ${(err as Error).message}`);
    return;
  }
  const kind = result.kind === 'webrtc-internals' ? 'webrtc-internals dump' : 'export';
  const replace = () => {
    loadModels(result.pcs, result.media, result.trackEvents, { name: file.name, url: result.url, userAgent: result.userAgent, env: result.env });
    message.success(`Imported ${result.pcs.length} connection(s) from ${kind}`);
  };
  if (!session.pcs.length || session.imported || isReport) return replace();
  dialog.info({
    title: `Import ${file.name}`,
    content: `Replace the live view, or add its ${result.pcs.length} connection(s) next to the live ones (e.g. to compare)?`,
    positiveText: 'Add to session',
    negativeText: 'Replace',
    onPositiveClick: () => {
      appendModels(result.pcs, file.name.replace(/\.(json|gz|txt)$/i, ''));
      message.success(`Added ${result.pcs.length} connection(s); open Compare to put them side by side`);
    },
    onNegativeClick: replace
  });
}

function backToLive() {
  clearSession();
}
</script>

<template>
  <aside class="sidebar">
    <div class="toolbar">
      <span class="title">
        <span class="wrd-dot" :class="session.imported ? 'info' : session.connected ? 'success' : 'default'" />
        WebRTC
      </span>
      <span style="flex: 1" />
      <n-tooltip v-if="!isReport">
        <template #trigger>
          <n-button quaternary size="tiny" @click="clearSession()" :disabled="session.imported">
            <template #icon><n-icon :component="TrashCan" /></template>
          </n-button>
        </template>
        Clear
      </n-tooltip>
      <n-dropdown trigger="click" :options="exportOptions" @select="onExport">
        <n-button quaternary size="tiny" :disabled="!session.pcs.length && !session.media.length" title="Export">
          <template #icon><n-icon :component="Download" /></template>
        </n-button>
      </n-dropdown>
      <n-tooltip>
        <template #trigger>
          <n-button quaternary size="tiny" @click="fileInput?.click()">
            <template #icon><n-icon :component="Upload" /></template>
          </n-button>
        </template>
        Import an export or a chrome://webrtc-internals dump
      </n-tooltip>
      <n-popover v-if="!isReport" trigger="click" placement="bottom-start">
        <template #trigger>
          <n-button quaternary size="tiny">
            <template #icon><n-icon :component="Settings" /></template>
          </n-button>
        </template>
        <div class="settings">
          <div class="row">
            <span>Stats interval (ms)</span>
            <n-input-number v-model:value="settings.statsInterval" size="tiny" :min="250" :max="10000" :step="250" style="width: 100px" />
          </div>
          <div class="row">
            <span>Capture data channel messages</span>
            <n-switch v-model:value="settings.captureDataChannelMessages" size="small" />
          </div>
          <div class="row">
            <span>Capture call stacks</span>
            <n-switch v-model:value="settings.captureStacks" size="small" />
          </div>
          <div v-if="storageAvailable() && origin" class="row">
            <span>
              Record stats from page load<br />
              <span class="wrd-muted mono">{{ origin }}</span>
            </span>
            <n-switch :value="recording" size="small" @update:value="toggleRecording" />
          </div>
        </div>
      </n-popover>
      <input ref="fileInput" type="file" accept=".json,.gz,.txt,application/json,application/gzip" hidden @change="onFile" />
    </div>
    <div class="compact">
      <n-select :value="navKey" :options="navOptions" size="small" placeholder="No connections yet" @update:value="navigate" />
    </div>
    <div class="toolbar sub">
      <n-checkbox v-if="!isReport" v-model:checked="settings.preserveLog" size="small" :disabled="session.imported">Preserve log</n-checkbox>
    </div>

    <div v-if="chaosOn" class="chaos" @click="session.view = 'tools'">⚠ Chaos mode active</div>
    <div v-if="session.imported" class="imported">
      <div class="wrd-muted">{{ isReport ? 'Report' : 'Viewing imported file' }}</div>
      <div class="mono" style="word-break: break-all">{{ session.importedName }}</div>
      <n-button v-if="!isReport" size="tiny" secondary style="margin-top: 6px" @click="backToLive">Back to live page</n-button>
    </div>

    <div class="list">
      <div class="item" :class="{ active: session.view === 'media' }" @click="session.view = 'media'">
        <n-icon :component="Microphone" size="14" />
        <span class="name">Media devices</span>
        <n-tag v-if="mediaCount" size="tiny" round :bordered="false">{{ mediaCount }}</n-tag>
      </div>
      <div class="item" :class="{ active: session.view === 'compare' }" @click="session.view = 'compare'">
        <n-icon :component="ChartLineData" size="14" />
        <span class="name">Compare</span>
      </div>
      <div v-if="!isReport" class="item" :class="{ active: session.view === 'tools' }" @click="session.view = 'tools'">
        <n-icon :component="Tools" size="14" />
        <span class="name">Tools</span>
        <n-tag v-if="chaosOn" size="tiny" round :bordered="false" type="warning">chaos</n-tag>
      </div>
      <div class="group">Peer connections · {{ session.pcs.length }}</div>
      <div
        v-for="pc in pcs"
        :key="pc.id"
        class="item"
        :class="{ active: session.view === 'pc' && session.selected === pc.id, stale: pc.stale }"
        @click="select(pc)"
      >
        <span class="wrd-dot" :class="stateTone(stateOf(pc))" />
        <div class="meta">
          <div class="name">
            PC {{ pc.index }}
            <span class="state">{{ stateOf(pc) }}</span>
          </div>
          <div v-if="subtitle(pc)" class="sub">{{ subtitle(pc) }}</div>
          <div class="sub mono">
            {{ formatTime(pc.info.createdAt, false) }}
            <template v-if="pc.importedFrom"> · {{ pc.importedFrom }}</template>
            <template v-else-if="multiFrame || pc.frameId !== 0"> · {{ hostOf(pc.frameUrl) }}</template>
          </div>
        </div>
        <span
          v-if="session.problems[pc.id]?.errors || session.problems[pc.id]?.warnings"
          class="problems"
          :class="session.problems[pc.id].errors ? 'error' : 'warning'"
          :title="`${session.problems[pc.id].errors} error(s), ${session.problems[pc.id].warnings} warning(s)`"
        >
          {{ session.problems[pc.id].errors || session.problems[pc.id].warnings }}
        </span>
      </div>
      <div v-if="!session.pcs.length" class="wrd-muted" style="padding: 8px 12px">None yet</div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 210px;
  transition: width 0.15s;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
  min-height: 0;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 4px 10px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.toolbar.sub {
  padding: 3px 10px;
}
.title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
}
.settings {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 260px;
}
.settings .row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.chaos {
  padding: 5px 10px;
  background: rgba(240, 160, 32, 0.25);
  color: #f0a020;
  font-weight: 600;
  cursor: pointer;
}
.problems {
  font-size: 10px;
  font-weight: 700;
  min-width: 16px;
  text-align: center;
  border-radius: 8px;
  padding: 0 4px;
  color: #fff;
}
.problems.error {
  background: #d03050;
}
.problems.warning {
  background: #f0a020;
}
.imported {
  padding: 8px 10px;
  background: rgba(32, 128, 240, 0.12);
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
}
.list {
  overflow: auto;
  flex: 1;
  padding: 4px 0;
}
.group {
  padding: 8px 10px 4px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  opacity: 0.55;
}
.item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px;
  cursor: pointer;
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(32, 128, 240, 0.2);
}
.item.stale {
  opacity: 0.55;
}
.meta {
  min-width: 0;
  flex: 1;
}
.name {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.name .state {
  font-weight: 400;
  opacity: 0.6;
  margin-left: 4px;
}
.sub {
  opacity: 0.55;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.item > .name {
  flex: 1;
}
/* Narrow DevTools: give the content more room. */
@media (max-width: 760px) {
  .sidebar {
    width: 150px;
  }
  .item .sub.mono {
    display: none;
  }
}
.compact {
  display: none;
}
/* Side panel: the list becomes a select on top. */
@media (max-width: 600px) {
  .sidebar {
    width: auto;
    border-right: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
  .compact {
    display: block;
    padding: 4px 8px;
  }
  .list,
  .toolbar.sub {
    display: none;
  }
  .toolbar {
    border-bottom: none;
  }
}
</style>
