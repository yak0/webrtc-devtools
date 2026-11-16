<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NSelect, NTag } from 'naive-ui';
import { errorText, listDevices, runLoopback, stopStream, videoCodecs, type LoopbackResult } from '../media';
import UPlotChart from '@/panel/components/common/UPlotChart.vue';

const cameras = ref<{ label: string; value: string }[]>([]);
const deviceId = ref<string | null>(null);
const resolution = ref('1280x720');
const codec = ref<string>('');
const maxBitrate = ref<number>(2_500_000);
const duration = ref(15);
const running = ref(false);
const error = ref('');
const result = ref<LoopbackResult | null>(null);
const version = ref(0);
const local = ref<HTMLVideoElement>();
let abort: AbortController | null = null;
let stream: MediaStream | null = null;

const codecs = computed(() => [{ label: 'Browser default', value: '' }, ...videoCodecs().map((c) => ({ label: c, value: c }))]);

async function loadDevices() {
  const list = (await listDevices()).filter((d) => d.kind === 'videoinput');
  cameras.value = list.map((d, i) => ({ label: d.label || `Camera ${i + 1}`, value: d.deviceId }));
  if (!deviceId.value && cameras.value[0]) deviceId.value = cameras.value[0].value;
}

async function run() {
  error.value = '';
  result.value = null;
  running.value = true;
  abort = new AbortController();
  try {
    const [w, h] = resolution.value.split('x').map(Number);
    stream = await navigator.mediaDevices.getUserMedia({
      video: { ...(deviceId.value ? { deviceId: { exact: deviceId.value } } : {}), width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } }
    });
    await loadDevices();
    local.value!.srcObject = stream;
    await local.value!.play().catch(() => {});
    result.value = await runLoopback(
      stream.getVideoTracks()[0],
      { codec: codec.value || undefined, maxBitrate: maxBitrate.value, durationMs: duration.value * 1000, signal: abort.signal },
      (_s, partial) => {
        result.value = { ...partial, samples: [...partial.samples] };
        version.value++;
      }
    );
    version.value++;
  } catch (e) {
    error.value = errorText(e);
  } finally {
    running.value = false;
    stopStream(stream);
    stream = null;
  }
}

function cancel() {
  abort?.abort();
}

onMounted(loadDevices);
onBeforeUnmount(() => {
  abort?.abort();
  stopStream(stream);
});

const chart = computed(() => {
  void version.value;
  const s = result.value?.samples ?? [];
  return {
    times: s.map((x) => x.t * 1000),
    series: [
      { label: 'kbps', data: s.map((x) => x.sendKbps) },
      { label: 'fps', data: s.map((x) => x.sendFps), right: true }
    ]
  };
});
const last = computed(() => result.value?.samples[result.value.samples.length - 1]);
</script>

<template>
  <div class="wrd-grid">
    <n-card size="small">
      <p class="wrd-muted" style="margin-top: 0">
        Sends your camera from one RTCPeerConnection to another inside this tab. No network is involved, so this shows what
        this computer can encode and decode: resolution, frame rate, hardware acceleration and whether the CPU is the bottleneck.
      </p>
      <div class="controls">
        <n-select v-model:value="deviceId" :options="cameras" placeholder="Camera" size="small" style="min-width: 200px; flex: 1" />
        <n-select
          v-model:value="resolution"
          :options="['640x480', '1280x720', '1920x1080', '3840x2160'].map((v) => ({ label: v.replace('x', '×'), value: v }))"
          size="small"
          style="width: 130px"
        />
        <n-select v-model:value="codec" :options="codecs" size="small" style="width: 150px" />
        <n-select
          v-model:value="maxBitrate"
          :options="[500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000].map((v) => ({ label: `max ${v / 1_000_000} Mbps`, value: v }))"
          size="small"
          style="width: 140px"
        />
        <n-select v-model:value="duration" :options="[10, 15, 30, 60].map((v) => ({ label: `${v} s`, value: v }))" size="small" style="width: 90px" />
        <n-button v-if="!running" size="small" type="primary" @click="run">Run test</n-button>
        <n-button v-else size="small" @click="cancel">Stop</n-button>
      </div>
    </n-card>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="Camera">
        <div class="stage"><video ref="local" muted playsinline /></div>
      </n-card>
      <n-card size="small" title="Result">
        <div v-if="!result" class="wrd-muted">{{ running ? 'Starting…' : 'Run the test to see results.' }}</div>
        <template v-else>
          <div v-for="(v, i) in result.verdict" :key="i" :style="{ color: v.ok ? '#18a058' : '#d03050', marginBottom: '4px' }">{{ v.ok ? '✓' : '✕' }} {{ v.text }}</div>
          <div class="wrd-kv" style="margin-top: 8px">
            <span class="k">Codec</span><span class="v">{{ result.codec || '…' }}</span>
            <span class="k">Encoder</span>
            <span class="v">
              {{ result.encoder || '…' }}
              <n-tag v-if="result.hardwareEncoder !== null" size="tiny" :type="result.hardwareEncoder ? 'success' : 'warning'" :bordered="false">
                {{ result.hardwareEncoder ? 'hardware' : 'software' }}
              </n-tag>
            </span>
            <span class="k">Decoder</span>
            <span class="v">
              {{ result.decoder || '…' }}
              <n-tag v-if="result.hardwareDecoder !== null" size="tiny" :type="result.hardwareDecoder ? 'success' : 'warning'" :bordered="false">
                {{ result.hardwareDecoder ? 'hardware' : 'software' }}
              </n-tag>
            </span>
            <span class="k">Now</span>
            <span class="v">{{ last ? `${last.width}×${last.height} · ${last.sendFps ?? '—'} fps · ${Math.round(last.sendKbps)} kbps` : '…' }}</span>
            <span class="k">Encode time</span><span class="v">{{ last?.encodeMsPerFrame ? `${last.encodeMsPerFrame.toFixed(1)} ms/frame` : '—' }}</span>
            <span class="k">QP</span><span class="v">{{ last?.qp ? last.qp.toFixed(1) : '—' }}</span>
            <span class="k">Limited by</span>
            <span class="v">
              {{
                Object.entries(result.limitationShare)
                  .filter(([, v]) => v > 0.01)
                  .map(([k, v]) => `${k} ${Math.round(v * 100)}%`)
                  .join(', ') || '—'
              }}
            </span>
          </div>
        </template>
      </n-card>
    </div>
    <n-card v-if="chart.times.length > 1" size="small" title="Bitrate / frame rate">
      <UPlotChart :times="chart.times" :series="chart.series" :version="version" :height="160" relative-x :format="(v) => `${Math.round(v)}`" />
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
  background: #000;
  border-radius: 6px;
  overflow: hidden;
  aspect-ratio: 16 / 9;
}
.stage video {
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform: scaleX(-1);
}
</style>
