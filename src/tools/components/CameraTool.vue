<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NCollapse, NCollapseItem, NSelect, NTag } from 'naive-ui';
import { createFrameProbe, errorText, listDevices, stopStream, watchFps } from '../media';
import JsonBlock from '@/panel/components/common/JsonBlock.vue';

const RESOLUTIONS = [
  { label: 'Camera default', value: '' },
  { label: '320×240 (QVGA)', value: '320x240' },
  { label: '640×480 (VGA)', value: '640x480' },
  { label: '1280×720 (HD)', value: '1280x720' },
  { label: '1920×1080 (Full HD)', value: '1920x1080' },
  { label: '2560×1440 (QHD)', value: '2560x1440' },
  { label: '3840×2160 (4K)', value: '3840x2160' }
];
const FPS = [
  { label: 'Default fps', value: 0 },
  { label: '15 fps', value: 15 },
  { label: '24 fps', value: 24 },
  { label: '30 fps', value: 30 },
  { label: '60 fps', value: 60 }
];

const cameras = ref<{ label: string; value: string }[]>([]);
const deviceId = ref<string | null>(null);
const resolution = ref('1280x720');
const fps = ref(0);
const mirror = ref(true);
const video = ref<HTMLVideoElement>();
const stream = ref<MediaStream | null>(null);
const error = ref('');
const measuredFps = ref<number | null>(null);
const probe = ref<{ luma: number; black: boolean; frozen: boolean } | null>(null);
const settings = ref<(MediaTrackSettings & { resizeMode?: string }) | null>(null);
const capabilities = ref<MediaTrackCapabilities | null>(null);
const scan = ref<{ label: string; ok: boolean; actual: string }[]>([]);
const scanning = ref(false);
let stopFps: (() => void) | null = null;
let probeTimer: ReturnType<typeof setInterval> | null = null;

async function loadDevices() {
  const list = (await listDevices()).filter((d) => d.kind === 'videoinput');
  cameras.value = list.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, value: d.deviceId }));
  if (!deviceId.value && cameras.value[0]) deviceId.value = cameras.value[0].value;
}

function constraints(): MediaTrackConstraints {
  const c: MediaTrackConstraints = {};
  if (deviceId.value) c.deviceId = { exact: deviceId.value };
  if (resolution.value) {
    const [w, h] = resolution.value.split('x').map(Number);
    c.width = { ideal: w };
    c.height = { ideal: h };
  }
  if (fps.value) c.frameRate = { ideal: fps.value };
  return c;
}

const track = () => stream.value?.getVideoTracks()[0];

async function start() {
  stop();
  error.value = '';
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({ video: constraints() });
    await loadDevices();
    deviceId.value = track()?.getSettings().deviceId ?? deviceId.value;
    video.value!.srcObject = stream.value;
    await video.value!.play().catch(() => {});
    stopFps = watchFps(video.value!, (n) => (measuredFps.value = n));
    const p = createFrameProbe();
    probeTimer = setInterval(() => {
      probe.value = p(video.value!);
      settings.value = track()?.getSettings() ?? null;
    }, 500);
    settings.value = track()?.getSettings() ?? null;
    capabilities.value = track()?.getCapabilities?.() ?? null;
  } catch (e) {
    error.value = errorText(e);
  }
}

function stop() {
  stopFps?.();
  stopFps = null;
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
  stopStream(stream.value);
  stream.value = null;
  measuredFps.value = null;
  probe.value = null;
}

/** Tries every preset with exact constraints, like the "resolution scanner" WebRTC sample. */
async function scanResolutions() {
  scanning.value = true;
  scan.value = [];
  stop();
  for (const r of RESOLUTIONS.filter((x) => x.value)) {
    const [w, h] = r.value.split('x').map(Number);
    let s: MediaStream | null = null;
    try {
      s = await navigator.mediaDevices.getUserMedia({
        video: { ...(deviceId.value ? { deviceId: { exact: deviceId.value } } : {}), width: { exact: w }, height: { exact: h } }
      });
      const st = s.getVideoTracks()[0].getSettings();
      scan.value.push({ label: r.label, ok: true, actual: `${st.width}×${st.height} @ ${Math.round(st.frameRate ?? 0)} fps` });
    } catch (e) {
      scan.value.push({ label: r.label, ok: false, actual: (e as Error).name });
    } finally {
      stopStream(s);
    }
  }
  scanning.value = false;
}

onMounted(loadDevices);
onBeforeUnmount(stop);

const requested = computed(() => {
  const [w, h] = resolution.value ? resolution.value.split('x').map(Number) : [null, null];
  return { w, h };
});
const mismatch = computed(
  () => settings.value && requested.value.w && (settings.value.width !== requested.value.w || settings.value.height !== requested.value.h)
);
</script>

<template>
  <div class="wrd-grid">
    <n-card size="small">
      <div class="controls">
        <n-select v-model:value="deviceId" :options="cameras" placeholder="Camera" size="small" style="min-width: 220px; flex: 1" />
        <n-select v-model:value="resolution" :options="RESOLUTIONS" size="small" style="width: 180px" />
        <n-select v-model:value="fps" :options="FPS" size="small" style="width: 130px" />
        <n-button size="small" type="primary" @click="start">{{ stream ? 'Restart' : 'Start camera' }}</n-button>
        <n-button v-if="stream" size="small" @click="stop">Stop</n-button>
      </div>
    </n-card>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="Preview">
        <template #header-extra><n-checkbox v-model:checked="mirror" size="small">Mirror</n-checkbox></template>
        <div class="stage">
          <video ref="video" muted playsinline :class="{ mirror }" />
          <div v-if="!stream" class="placeholder wrd-muted">Camera is off</div>
          <div v-else class="badges">
            <n-tag v-if="probe?.black" type="error" size="small">Black image</n-tag>
            <n-tag v-else-if="probe?.frozen" type="warning" size="small">Image not changing</n-tag>
          </div>
        </div>
      </n-card>

      <n-card size="small" title="What the camera delivers">
        <div v-if="!stream" class="wrd-muted">Start the camera to see its real settings.</div>
        <div v-else class="wrd-kv">
          <span class="k">Device</span><span class="v">{{ track()?.label }}</span>
          <span class="k">Resolution</span>
          <span class="v">
            {{ settings?.width }}×{{ settings?.height }}
            <span v-if="mismatch" style="color: #f0a020"> (asked {{ requested.w }}×{{ requested.h }})</span>
          </span>
          <span class="k">Frame rate</span><span class="v">{{ settings?.frameRate ? Math.round(settings.frameRate) : '—' }} fps configured</span>
          <span class="k">Measured</span>
          <span class="v" :style="{ color: measuredFps !== null && settings?.frameRate && measuredFps < settings.frameRate * 0.7 ? '#f0a020' : '' }">
            {{ measuredFps ?? '…' }} fps rendered
          </span>
          <span class="k">Brightness</span><span class="v">{{ probe ? Math.round(probe.luma) : '…' }} / 255{{ probe && probe.luma < 40 && !probe.black ? ' (dark: check lighting)' : '' }}</span>
          <span class="k">Track</span><span class="v">{{ track()?.readyState }}{{ track()?.muted ? ' · muted' : '' }}</span>
          <template v-if="settings?.resizeMode"><span class="k">Resize mode</span><span class="v">{{ settings.resizeMode }}</span></template>
          <template v-if="settings?.facingMode"><span class="k">Facing</span><span class="v">{{ settings.facingMode }}</span></template>
        </div>
        <n-collapse v-if="capabilities" style="margin-top: 10px">
          <n-collapse-item title="Capabilities (getCapabilities)" name="caps">
            <JsonBlock :value="capabilities" :max-height="260" />
          </n-collapse-item>
          <n-collapse-item title="All settings (getSettings)" name="settings">
            <JsonBlock :value="settings" :max-height="260" />
          </n-collapse-item>
        </n-collapse>
      </n-card>
    </div>

    <n-card size="small" title="Supported resolutions">
      <template #header-extra>
        <n-button size="small" :loading="scanning" @click="scanResolutions">Scan</n-button>
      </template>
      <div v-if="!scan.length" class="wrd-muted">Opens the camera once per resolution with exact constraints to see which ones it really supports.</div>
      <table v-else class="scan">
        <tr v-for="r in scan" :key="r.label">
          <td>{{ r.ok ? '✓' : '✕' }}</td>
          <td>{{ r.label }}</td>
          <td class="mono wrd-muted">{{ r.actual }}</td>
        </tr>
      </table>
    </n-card>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  align-items: center;
}
.stage {
  position: relative;
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
}
.stage video {
  width: 100%;
  height: 100%;
  object-fit: contain;
}
.stage video.mirror {
  transform: scaleX(-1);
}
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
}
.badges {
  position: absolute;
  left: 8px;
  top: 8px;
  display: flex;
  gap: 6px;
}
.scan td {
  padding: 2px 12px 2px 0;
}
</style>
