<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NSelect } from 'naive-ui';
import { errorText, stopStream, watchFps } from '../media';

const withAudio = ref(false);
const frameRate = ref(30);
const video = ref<HTMLVideoElement>();
const stream = ref<MediaStream | null>(null);
const error = ref('');
const fps = ref<number | null>(null);
const settings = ref<(MediaTrackSettings & { displaySurface?: string; cursor?: string; logicalSurface?: boolean }) | null>(null);
const ended = ref(false);
let stopFps: (() => void) | null = null;

async function start() {
  stop();
  error.value = '';
  ended.value = false;
  try {
    stream.value = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: frameRate.value }, audio: withAudio.value });
    const track = stream.value.getVideoTracks()[0];
    track.addEventListener('ended', () => {
      ended.value = true;
      stop();
    });
    video.value!.srcObject = stream.value;
    await video.value!.play().catch(() => {});
    stopFps = watchFps(video.value!, (n) => {
      fps.value = n;
      settings.value = track.getSettings();
    });
    settings.value = track.getSettings();
  } catch (e) {
    error.value = (e as Error).name === 'NotAllowedError' ? 'Sharing was cancelled or not allowed.' : errorText(e);
  }
}

function stop() {
  stopFps?.();
  stopFps = null;
  stopStream(stream.value);
  stream.value = null;
}
onBeforeUnmount(stop);
</script>

<template>
  <div class="wrd-grid">
    <n-card size="small">
      <div class="controls">
        <n-select
          v-model:value="frameRate"
          :options="[5, 15, 30, 60].map((v) => ({ label: `${v} fps`, value: v }))"
          size="small"
          style="width: 110px"
        />
        <n-checkbox v-model:checked="withAudio" size="small">Share audio (tab / system)</n-checkbox>
        <n-button size="small" type="primary" @click="start">{{ stream ? 'Share something else' : 'Start screen share' }}</n-button>
        <n-button v-if="stream" size="small" @click="stop">Stop</n-button>
      </div>
    </n-card>
    <n-alert v-if="error" type="warning" :bordered="false">{{ error }}</n-alert>
    <n-alert v-if="ended" type="info" :bordered="false">Sharing ended from the browser's “Stop sharing” bar (track "ended" event).</n-alert>
    <div class="wrd-grid cols-2">
      <n-card size="small" title="Preview">
        <div class="stage">
          <video ref="video" muted playsinline />
          <div v-if="!stream" class="placeholder">Nothing shared</div>
        </div>
      </n-card>
      <n-card size="small" title="Capture">
        <div v-if="!stream" class="wrd-muted">Start sharing to see what the browser captures.</div>
        <div v-else class="wrd-kv">
          <span class="k">Surface</span><span class="v">{{ settings?.displaySurface ?? '—' }}</span>
          <span class="k">Resolution</span><span class="v">{{ settings?.width }}×{{ settings?.height }}</span>
          <span class="k">Frame rate</span><span class="v">{{ settings?.frameRate ? Math.round(settings.frameRate) : '—' }} max · {{ fps ?? '…' }} rendered</span>
          <span class="k">Cursor</span><span class="v">{{ settings?.cursor ?? '—' }}</span>
          <span class="k">Audio</span><span class="v">{{ stream.getAudioTracks().length ? 'yes' : 'no' }}</span>
        </div>
        <p class="wrd-muted" style="margin-bottom: 0">
          Static screens produce few frames: a low rendered fps while nothing moves is expected (content-hint “detail” encoders send frames on change).
        </p>
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
.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #aaa;
}
</style>
