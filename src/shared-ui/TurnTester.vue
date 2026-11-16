<script setup lang="ts">
import { ref } from 'vue';
import { NButton, NCheckbox, NInput, NInputNumber, NSelect, NTag } from 'naive-ui';
import { runTurnTest, serversFromInput, type TurnTestResult } from '@/panel/lib/turn-test';
import { turnProvider } from '@/panel/lib/sdk';

/** Optional presets (e.g. the ICE servers of connections on the inspected page). */
const props = defineProps<{ sources?: { label: string; urls: string[]; username?: string }[] }>();

const urls = ref('stun:stun.l.google.com:19302');
const username = ref('');
const credential = ref('');
const relayOnly = ref(false);
const timeout = ref(10);
const running = ref(false);
const result = ref<TurnTestResult | null>(null);

function usePreset(i: number) {
  const s = props.sources?.[i];
  if (!s) return;
  urls.value = s.urls.join('\n');
  username.value = s.username ?? '';
  credential.value = ''; // never available: the collector masks credentials
}

async function run() {
  running.value = true;
  result.value = null;
  try {
    result.value = await runTurnTest(
      serversFromInput(urls.value, username.value, credential.value),
      { relayOnly: relayOnly.value, timeoutMs: timeout.value * 1000 },
      (r) => (result.value = r)
    );
  } finally {
    running.value = false;
  }
}
const typeTone = (t: string) => (t === 'host' ? 'success' : t === 'relay' ? 'warning' : 'info');
</script>

<template>
  <div class="turn wrd-grid cols-2">
    <div class="wrd-grid" style="gap: 8px">
      <n-select
        v-if="sources?.length"
        placeholder="Use the ICE servers of a connection…"
        :options="sources.map((s, i) => ({ label: s.label, value: i }))"
        size="small"
        @update:value="usePreset"
      />
      <n-input v-model:value="urls" type="textarea" :autosize="{ minRows: 3, maxRows: 8 }" placeholder="One URL per line: stun:… turn:… turns:…" class="mono" />
      <div style="display: flex; gap: 8px">
        <n-input v-model:value="username" size="small" placeholder="TURN username" />
        <n-input v-model:value="credential" size="small" type="password" show-password-on="click" placeholder="TURN credential" />
      </div>
      <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap">
        <n-checkbox v-model:checked="relayOnly" size="small">Relay only</n-checkbox>
        <span class="wrd-muted">Timeout</span>
        <n-input-number v-model:value="timeout" size="tiny" :min="2" :max="60" style="width: 80px"><template #suffix>s</template></n-input-number>
        <span style="flex: 1" />
        <n-button size="small" type="primary" :loading="running" @click="run">Run test</n-button>
      </div>
      <div class="wrd-muted">Runs from this browser (same network as the page). Credentials are only used for this test and never stored.</div>
    </div>
    <div>
      <template v-if="result">
        <div v-for="(v, i) in result.verdict" :key="i" :style="{ color: v.ok ? '#18a058' : '#d03050', marginBottom: '4px' }">{{ v.ok ? '✓' : '✕' }} {{ v.text }}</div>
        <div class="wrd-muted" style="margin: 4px 0 8px">
          {{ result.candidates.length }} candidates in {{ result.durationMs }} ms{{ result.timedOut ? ' (timed out)' : '' }}
        </div>
        <table class="cands">
          <tr v-for="(c, i) in result.candidates" :key="i">
            <td><n-tag size="tiny" :bordered="false" :type="typeTone(c.type)">{{ c.type }}</n-tag></td>
            <td class="mono">{{ c.address }}:{{ c.port }}</td>
            <td>{{ c.protocol }}</td>
            <td class="mono wrd-muted">{{ c.url ?? '' }}{{ c.url && turnProvider(c.url) ? ` · ${turnProvider(c.url)}` : '' }}</td>
            <td class="mono wrd-muted">{{ c.ms }} ms</td>
          </tr>
          <tr v-for="(e, i) in result.errors" :key="'e' + i">
            <td><n-tag size="tiny" :bordered="false" type="error">{{ e.errorCode }}</n-tag></td>
            <td colspan="3" class="mono">{{ e.url }} {{ e.errorText }}</td>
            <td class="mono wrd-muted">{{ e.ms }} ms</td>
          </tr>
        </table>
      </template>
      <div v-else class="wrd-muted">Results appear here.</div>
    </div>
  </div>
</template>

<style scoped>
.cands td {
  padding: 2px 8px 2px 0;
  white-space: nowrap;
}
</style>
