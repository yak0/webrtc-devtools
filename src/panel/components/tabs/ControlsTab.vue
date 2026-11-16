<script setup lang="ts">
import { computed, ref } from 'vue';
import { NAlert, NButton, NCard, NPopconfirm, NSelect, NSwitch, useMessage } from 'naive-ui';
import type { PageCommand } from '@/shared/protocol';
import { sendCommand, session, type PcModel } from '../../store/session';

const props = defineProps<{ pc: PcModel }>();
const message = useMessage();
const busy = ref(false);
const videoCap = ref<number | null>(null);
const audioCap = ref<number | null>(null);
const videoOn = ref(true);
const audioOn = ref(true);

const live = computed(() => !props.pc.imported && !props.pc.stale && !props.pc.closed && !session.imported);

const VIDEO_CAPS = [
  { label: 'No limit', value: null as any },
  { label: '2.5 Mbps', value: 2_500_000 },
  { label: '1 Mbps', value: 1_000_000 },
  { label: '500 kbps', value: 500_000 },
  { label: '250 kbps', value: 250_000 },
  { label: '100 kbps', value: 100_000 },
  { label: '30 kbps (starve)', value: 30_000 }
];
const AUDIO_CAPS = [
  { label: 'No limit', value: null as any },
  { label: '32 kbps', value: 32_000 },
  { label: '16 kbps', value: 16_000 },
  { label: '8 kbps', value: 8_000 }
];

async function run(command: PageCommand) {
  busy.value = true;
  const r = await sendCommand(props.pc.frameId, command);
  busy.value = false;
  if (r.ok) message.success(r.message ?? 'Done');
  else message.error(r.message ?? 'Failed');
}
</script>

<template>
  <div class="wrd-pad wrd-grid">
    <n-alert v-if="!live" type="info" :bordered="false">Controls only work on live, open connections.</n-alert>
    <n-alert v-else type="warning" :bordered="false">
      These actions change the running app (for testing). They are recorded in the Timeline as <span class="mono">devtools.action</span>.
    </n-alert>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="Console">
        <p class="wrd-muted" style="margin-top: 0">Store this RTCPeerConnection as a global variable in the page's console.</p>
        <n-button size="small" :disabled="!live || busy" @click="run({ op: 'expose', pcId: pc.id, name: `$pc${pc.index}` })">
          Store as <span class="mono" style="margin-left: 4px">$pc{{ pc.index }}</span>
        </n-button>
      </n-card>

      <n-card size="small" title="Connection">
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <n-button size="small" :disabled="!live || busy" @click="run({ op: 'restartIce', pcId: pc.id })">Restart ICE</n-button>
          <n-popconfirm @positive-click="run({ op: 'close', pcId: pc.id })">
            <template #trigger>
              <n-button size="small" type="error" secondary :disabled="!live || busy">Close connection</n-button>
            </template>
            Calls pc.close() in the page. The app will see the connection as closed.
          </n-popconfirm>
        </div>
        <p class="wrd-muted" style="margin-bottom: 0">Restart ICE fires negotiationneeded; the app has to renegotiate.</p>
      </n-card>

      <n-card size="small" title="Send bitrate cap">
        <div class="row">
          <span>Video</span>
          <n-select v-model:value="videoCap" :options="VIDEO_CAPS" size="small" style="width: 160px" :disabled="!live" @update:value="(v: number | null) => run({ op: 'maxBitrate', pcId: pc.id, kind: 'video', bps: v })" />
        </div>
        <div class="row">
          <span>Audio</span>
          <n-select v-model:value="audioCap" :options="AUDIO_CAPS" size="small" style="width: 160px" :disabled="!live" @update:value="(v: number | null) => run({ op: 'maxBitrate', pcId: pc.id, kind: 'audio', bps: v })" />
        </div>
        <p class="wrd-muted" style="margin-bottom: 0">Uses RTCRtpSender.setParameters() on every encoding (simulcast layers included).</p>
      </n-card>

      <n-card size="small" title="Outgoing tracks">
        <div class="row">
          <span>Video enabled</span>
          <n-switch v-model:value="videoOn" :disabled="!live" @update:value="(v: boolean) => run({ op: 'trackEnabled', pcId: pc.id, kind: 'video', enabled: v })" />
        </div>
        <div class="row">
          <span>Audio enabled</span>
          <n-switch v-model:value="audioOn" :disabled="!live" @update:value="(v: boolean) => run({ op: 'trackEnabled', pcId: pc.id, kind: 'audio', enabled: v })" />
        </div>
        <p class="wrd-muted" style="margin-bottom: 0">Sets track.enabled: the remote side receives black video / silence.</p>
      </n-card>
    </div>
    <div class="wrd-muted">
      Candidate filtering, signaling delays, forced TURN and data channel loss are page-wide: see
      <a style="cursor: pointer; text-decoration: underline" @click="session.view = 'tools'">Tools → Chaos mode</a>.
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
</style>
