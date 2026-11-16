<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NSelect } from 'naive-ui';
import { createLevelMeter, errorText, listDevices, recordClip, stopStream } from '../media';

const mics = ref<{ label: string; value: string }[]>([]);
const deviceId = ref<string | null>(null);
const echoCancellation = ref(true);
const noiseSuppression = ref(true);
const autoGainControl = ref(true);
const stream = ref<MediaStream | null>(null);
const error = ref('');
const rms = ref(-100);
const peak = ref(-100);
const peakHold = ref(-100);
const clipped = ref(0);
const silentFor = ref(0);
const settings = ref<(MediaTrackSettings & { latency?: number }) | null>(null);
const recording = ref(false);
const clipUrl = ref('');
const wave = ref<HTMLCanvasElement>();
let stopMeter: (() => void) | null = null;
let lastLoud = 0;

async function loadDevices() {
  const list = (await listDevices()).filter((d) => d.kind === 'audioinput');
  mics.value = list.map((d, i) => ({ label: d.label || `Microphone ${i + 1}`, value: d.deviceId }));
  if (!deviceId.value && mics.value[0]) deviceId.value = mics.value[0].value;
}

function draw(samples: Float32Array) {
  const c = wave.value;
  if (!c) return;
  const ctx = c.getContext('2d')!;
  const w = (c.width = c.clientWidth * devicePixelRatio);
  const h = (c.height = c.clientHeight * devicePixelRatio);
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = '#18a058';
  ctx.lineWidth = devicePixelRatio;
  ctx.beginPath();
  const step = samples.length / w;
  for (let x = 0; x < w; x++) {
    const y = h / 2 - samples[Math.floor(x * step)] * (h / 2);
    if (x) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
}

async function start() {
  stop();
  error.value = '';
  try {
    stream.value = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId.value ? { deviceId: { exact: deviceId.value } } : {}),
        echoCancellation: echoCancellation.value,
        noiseSuppression: noiseSuppression.value,
        autoGainControl: autoGainControl.value
      }
    });
    await loadDevices();
    const track = stream.value.getAudioTracks()[0];
    deviceId.value = track.getSettings().deviceId ?? deviceId.value;
    settings.value = track.getSettings();
    lastLoud = performance.now();
    peakHold.value = -100;
    clipped.value = 0;
    stopMeter = createLevelMeter(stream.value, (s) => {
      rms.value = s.rmsDb;
      peak.value = s.peakDb;
      peakHold.value = Math.max(peakHold.value - 0.3, s.peakDb);
      if (s.clipping) clipped.value++;
      if (s.rmsDb > -50) lastLoud = performance.now();
      silentFor.value = (performance.now() - lastLoud) / 1000;
      draw(s.samples);
    });
  } catch (e) {
    error.value = errorText(e);
  }
}

function stop() {
  stopMeter?.();
  stopMeter = null;
  stopStream(stream.value);
  stream.value = null;
  rms.value = -100;
  peak.value = -100;
}

async function record() {
  if (!stream.value) return;
  recording.value = true;
  if (clipUrl.value) URL.revokeObjectURL(clipUrl.value);
  clipUrl.value = '';
  try {
    clipUrl.value = URL.createObjectURL(await recordClip(stream.value, 5000));
  } catch (e) {
    error.value = errorText(e);
  } finally {
    recording.value = false;
  }
}

onMounted(loadDevices);
onBeforeUnmount(() => {
  stop();
  if (clipUrl.value) URL.revokeObjectURL(clipUrl.value);
});

const pct = (db: number) => `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`;
const verdict = computed(() => {
  if (!stream.value) return null;
  if (clipped.value > 5) return { tone: 'error', text: 'The signal is clipping: lower the input gain or move away from the mic.' };
  if (silentFor.value > 3) return { tone: 'warning', text: `No sound for ${Math.round(silentFor.value)}s: say something. Is the right mic selected, or is it muted in hardware/OS?` };
  if (peakHold.value < -30) return { tone: 'warning', text: 'Very quiet: speak closer or raise the input gain.' };
  return { tone: 'success', text: 'The microphone picks up sound.' };
});
</script>

<template>
  <div class="wrd-grid">
    <n-card size="small">
      <div class="controls">
        <n-select v-model:value="deviceId" :options="mics" placeholder="Microphone" size="small" style="min-width: 240px; flex: 1" />
        <n-checkbox v-model:checked="echoCancellation" size="small">Echo cancellation</n-checkbox>
        <n-checkbox v-model:checked="noiseSuppression" size="small">Noise suppression</n-checkbox>
        <n-checkbox v-model:checked="autoGainControl" size="small">Auto gain</n-checkbox>
        <n-button size="small" type="primary" @click="start">{{ stream ? 'Restart' : 'Start microphone' }}</n-button>
        <n-button v-if="stream" size="small" @click="stop">Stop</n-button>
      </div>
    </n-card>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>

    <n-card size="small" title="Input level">
      <div class="meter">
        <div class="fill" :style="{ width: pct(rms) }" :class="{ hot: peak > -3 }" />
        <div class="hold" :style="{ left: pct(peakHold) }" />
        <div class="scale"><span>-60</span><span>-40</span><span>-20</span><span>0 dBFS</span></div>
      </div>
      <div class="nums mono">
        <span>RMS {{ rms <= -100 ? 'silence' : `${rms.toFixed(1)} dB` }}</span>
        <span>Peak hold {{ peakHold <= -100 ? 'silence' : `${peakHold.toFixed(1)} dB` }}</span>
        <span :style="{ color: clipped ? '#d03050' : '' }">Clipped frames {{ clipped }}</span>
      </div>
      <canvas ref="wave" class="wave" />
      <n-alert v-if="verdict" :type="verdict.tone as any" :bordered="false" style="margin-top: 8px">{{ verdict.text }}</n-alert>
    </n-card>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="Record & play back">
        <p class="wrd-muted" style="margin-top: 0">Records 5 seconds with the processing options above so you can hear what others would hear.</p>
        <n-button size="small" :disabled="!stream" :loading="recording" @click="record">{{ recording ? 'Recording…' : 'Record 5 s' }}</n-button>
        <audio v-if="clipUrl" :src="clipUrl" controls style="display: block; margin-top: 10px; width: 100%" />
      </n-card>
      <n-card size="small" title="What the microphone delivers">
        <div v-if="!settings" class="wrd-muted">Start the microphone to see its settings.</div>
        <div v-else class="wrd-kv">
          <span class="k">Device</span><span class="v">{{ stream?.getAudioTracks()[0]?.label }}</span>
          <span class="k">Sample rate</span><span class="v">{{ settings.sampleRate ?? '—' }} Hz</span>
          <span class="k">Channels</span><span class="v">{{ settings.channelCount ?? '—' }}</span>
          <span class="k">Latency</span><span class="v">{{ settings.latency !== undefined ? `${(settings.latency * 1000).toFixed(1)} ms` : '—' }}</span>
          <span class="k">Echo cancellation</span><span class="v">{{ settings.echoCancellation }}</span>
          <span class="k">Noise suppression</span><span class="v">{{ settings.noiseSuppression }}</span>
          <span class="k">Auto gain</span><span class="v">{{ settings.autoGainControl }}</span>
        </div>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.meter {
  position: relative;
  height: 18px;
  border-radius: 4px;
  background: linear-gradient(90deg, rgba(24, 160, 88, 0.15) 0 70%, rgba(240, 160, 32, 0.18) 70% 95%, rgba(208, 48, 80, 0.2) 95%);
  margin-bottom: 18px;
}
.fill {
  height: 100%;
  border-radius: 4px;
  background: #18a058;
  transition: width 0.05s linear;
}
.fill.hot {
  background: #d03050;
}
.hold {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: currentColor;
  opacity: 0.7;
}
.scale {
  position: absolute;
  top: 20px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  opacity: 0.6;
}
.nums {
  display: flex;
  gap: 18px;
  margin-bottom: 8px;
}
.wave {
  width: 100%;
  height: 90px;
  background: rgba(128, 128, 128, 0.08);
  border-radius: 4px;
}
</style>
