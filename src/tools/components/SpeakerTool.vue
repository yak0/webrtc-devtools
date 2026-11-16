<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { NAlert, NButton, NCard, NSelect, NSlider } from 'naive-ui';
import { errorText, listDevices, unlockLabels } from '../media';

const outputs = ref<{ label: string; value: string }[]>([]);
const sinkId = ref<string>('default');
const volume = ref(30);
const error = ref('');
const playing = ref<string | null>(null);
const supportsSink = 'setSinkId' in HTMLMediaElement.prototype;
const hiddenLabels = ref(false);
let ctx: AudioContext | null = null;
let audio: HTMLAudioElement | null = null;

async function loadDevices() {
  const list = (await listDevices()).filter((d) => d.kind === 'audiooutput');
  hiddenLabels.value = list.some((d) => !d.label);
  outputs.value = list.map((d, i) => ({ label: d.label || `Output ${i + 1}`, value: d.deviceId }));
  if (!outputs.value.some((o) => o.value === sinkId.value) && outputs.value[0]) sinkId.value = outputs.value[0].value;
}

async function grant() {
  try {
    await unlockLabels('audio');
  } catch (e) {
    error.value = errorText(e);
  }
  await loadDevices();
}

function stopTone() {
  audio?.pause();
  audio = null;
  void ctx?.close();
  ctx = null;
  playing.value = null;
}

/** Plays a short tone sequence on one channel through the selected output device. */
async function play(channel: 'left' | 'right' | 'both') {
  stopTone();
  error.value = '';
  try {
    ctx = new AudioContext();
    const dest = ctx.createMediaStreamDestination();
    const gain = ctx.createGain();
    gain.gain.value = volume.value / 100;
    const pan = ctx.createStereoPanner();
    pan.pan.value = channel === 'left' ? -1 : channel === 'right' ? 1 : 0;
    gain.connect(pan).connect(dest);
    const t = ctx.currentTime;
    // Three short beeps, rising pitch: easy to recognize and to tell left from right.
    [523, 659, 784].forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const env = ctx!.createGain();
      osc.frequency.value = f;
      env.gain.setValueAtTime(0, t + i * 0.35);
      env.gain.linearRampToValueAtTime(1, t + i * 0.35 + 0.02);
      env.gain.linearRampToValueAtTime(0, t + i * 0.35 + 0.3);
      osc.connect(env).connect(gain);
      osc.start(t + i * 0.35);
      osc.stop(t + i * 0.35 + 0.32);
    });
    audio = new Audio();
    audio.srcObject = dest.stream;
    if (supportsSink && sinkId.value) await (audio as any).setSinkId(sinkId.value);
    await audio.play();
    playing.value = channel;
    setTimeout(() => playing.value === channel && stopTone(), 1200);
  } catch (e) {
    error.value = errorText(e);
    stopTone();
  }
}

onMounted(() => {
  void loadDevices();
  navigator.mediaDevices.addEventListener('devicechange', loadDevices);
});
onBeforeUnmount(() => {
  stopTone();
  navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
});
</script>

<template>
  <div class="wrd-grid">
    <n-card size="small">
      <div class="controls">
        <n-select v-if="supportsSink" v-model:value="sinkId" :options="outputs" size="small" style="min-width: 260px; flex: 1" />
        <span v-else class="wrd-muted">This browser cannot choose the output device; the system default is used.</span>
        <n-button v-if="hiddenLabels" size="small" @click="grant">Show device names</n-button>
        <span class="wrd-muted">Volume</span>
        <n-slider v-model:value="volume" :min="5" :max="100" style="width: 140px" />
      </div>
    </n-card>
    <n-alert v-if="error" type="error" :bordered="false">{{ error }}</n-alert>
    <n-card size="small" title="Play a test sound">
      <div class="buttons">
        <n-button :type="playing === 'left' ? 'primary' : 'default'" @click="play('left')">◀ Left</n-button>
        <n-button :type="playing === 'both' ? 'primary' : 'default'" @click="play('both')">Both</n-button>
        <n-button :type="playing === 'right' ? 'primary' : 'default'" @click="play('right')">Right ▶</n-button>
      </div>
      <p class="wrd-muted" style="margin-bottom: 0">
        You should hear three rising beeps from the chosen side. If “Left” plays on the right, the channels are swapped; if you hear nothing,
        the wrong output is selected or the device is muted.
      </p>
    </n-card>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.buttons {
  display: flex;
  gap: 8px;
}
</style>
