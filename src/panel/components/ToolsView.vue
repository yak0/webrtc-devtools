<script setup lang="ts">
import { computed } from 'vue';
import { NAlert, NButton, NCard, NCheckbox, NCheckboxGroup, NInputNumber, NSlider, NSwitch, NTag } from 'naive-ui';
import { chaosActive, NO_CHAOS } from '@/shared/protocol';
import { chaos } from '../settings';
import { session } from '../store/session';
import { iceServerUrls } from '../lib/ice';
import TurnTester from '@/shared-ui/TurnTester.vue';

const active = computed(() => chaosActive(chaos));
function resetChaos() {
  Object.assign(chaos, { ...NO_CHAOS, blockCandidateTypes: [], blockProtocols: [] });
}
const dropPct = computed({
  get: () => Math.round(chaos.dcDropRate * 100),
  set: (v: number) => (chaos.dcDropRate = v / 100)
});

// ---- TURN tester sources: ICE servers of the connections on the page ----
const sources = computed(() =>
  session.pcs
    .map((pc) => ({ pc, servers: iceServerUrls(pc.info.effectiveConfig ?? pc.info.config) }))
    .filter((x) => x.servers.length)
    .map((x) => ({
      label: `PC ${x.pc.index}: ${x.servers.flatMap((s) => s.urls).join(', ').slice(0, 80)}`,
      urls: x.servers.flatMap((s) => s.urls),
      username: x.servers.find((s) => s.username)?.username
    }))
);

function openTools(hash: string) {
  window.open(new URL(`../tools/tools.html#${hash}`, location.href).href, '_blank');
}
</script>

<template>
  <div class="wrd-scroll">
    <div class="wrd-pad wrd-grid">
      <n-card size="small">
        <template #header>
          <div style="display: flex; align-items: center; gap: 8px">
            Chaos mode
            <n-tag v-if="active" size="small" type="warning">active</n-tag>
          </div>
        </template>
        <template #header-extra>
          <n-button size="tiny" :disabled="!active" @click="resetChaos">Turn everything off</n-button>
        </template>
        <n-alert type="warning" :bordered="false" style="margin-bottom: 12px">
          Fault injection for testing: changes apply to every frame of the inspected page while this panel is open and are not saved.
          Drops are visible in the Timeline as <span class="mono">devtools.chaos</span>.
        </n-alert>
        <div class="wrd-grid cols-2">
          <div>
            <div class="wrd-section-title">Drop ICE candidates (local and remote)</div>
            <n-checkbox-group v-model:value="chaos.blockCandidateTypes">
              <n-checkbox value="host" label="host" />
              <n-checkbox value="srflx" label="srflx" />
              <n-checkbox value="prflx" label="prflx" />
              <n-checkbox value="relay" label="relay" />
            </n-checkbox-group>
            <div style="margin-top: 6px">
              <n-checkbox-group v-model:value="chaos.blockProtocols">
                <n-checkbox value="udp" label="all UDP" />
                <n-checkbox value="tcp" label="all TCP" />
              </n-checkbox-group>
            </div>
            <p class="wrd-muted">Example: drop host + srflx to check that calls still work through TURN only. Candidates embedded in a non-trickle SDP are not filtered.</p>
          </div>
          <div>
            <div class="row">
              <span>Force TURN (iceTransportPolicy "relay") for new connections</span>
              <n-switch v-model:value="chaos.forceRelay" size="small" />
            </div>
            <div class="row">
              <span>Delay remote candidates (simulate slow signaling)</span>
              <n-input-number v-model:value="chaos.candidateDelayMs" size="tiny" :min="0" :max="30000" :step="250" style="width: 110px">
                <template #suffix>ms</template>
              </n-input-number>
            </div>
            <div class="wrd-section-title" style="margin-top: 8px">Drop outgoing data channel messages: {{ dropPct }}%</div>
            <n-slider v-model:value="dropPct" :min="0" :max="100" :step="5" />
          </div>
        </div>
      </n-card>

      <n-card size="small" title="STUN / TURN tester">
        <TurnTester :sources="sources" />
      </n-card>

      <n-card size="small" title="Device & network tests">
        <p class="wrd-muted" style="margin-top: 0">Open in a new tab (camera, microphone, speakers, screen sharing, a local call quality test and this TURN tester).</p>
        <div style="display: flex; gap: 8px; flex-wrap: wrap">
          <n-button size="small" @click="openTools('camera')">Camera test</n-button>
          <n-button size="small" @click="openTools('microphone')">Microphone test</n-button>
          <n-button size="small" @click="openTools('speakers')">Speaker test</n-button>
          <n-button size="small" @click="openTools('loopback')">Call quality test</n-button>
          <n-button size="small" @click="openTools('devices')">All devices</n-button>
        </div>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}
</style>
