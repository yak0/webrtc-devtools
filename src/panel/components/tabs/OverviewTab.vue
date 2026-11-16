<script setup lang="ts">
import { computed } from 'vue';
import { NCard, NCollapse, NCollapseItem, NEmpty } from 'naive-ui';
import type { PcModel } from '../../store/session';
import { computeInsights } from '../../lib/insights';
import { iceServerUrls, selectedPair, describeCandidate } from '../../lib/ice';
import { formatBitrate, formatBytes } from '../../lib/format';
import StateTimeline from '../common/StateTimeline.vue';
import JsonBlock from '../common/JsonBlock.vue';
import UPlotChart from '../common/UPlotChart.vue';
import InsightList from '../common/InsightList.vue';
import { sumSeries } from '../../lib/summary';
import { turnProvider } from '../../lib/sdk';

const props = defineProps<{ pc: PcModel }>();

const insights = computed(() => {
  void props.pc.rev;
  void props.pc.statsRev;
  return computeInsights(props.pc);
});

const STATE_EVENTS = [
  ['Connection state', 'connectionstatechange', 'connectionState'],
  ['ICE connection state', 'iceconnectionstatechange', 'iceConnectionState'],
  ['ICE gathering state', 'icegatheringstatechange', 'iceGatheringState'],
  ['Signaling state', 'signalingstatechange', 'signalingState']
] as const;

const timelines = computed(() => {
  void props.pc.rev;
  return STATE_EVENTS.map(([title, event, key]) => ({
    title,
    current: props.pc.states[key],
    changes: props.pc.events
      .filter((e) => e.kind === 'event' && e.name === event && typeof e.value === 'string')
      .map((e) => ({ ts: e.ts, value: e.value as string }))
  }));
});

const config = computed(() => (props.pc.info.effectiveConfig ?? props.pc.info.config) as Record<string, unknown> | undefined);
const configRows = computed(() => {
  const c = config.value ?? {};
  return ['bundlePolicy', 'rtcpMuxPolicy', 'iceTransportPolicy', 'iceCandidatePoolSize', 'sdpSemantics', 'encodedInsertableStreams']
    .filter((k) => c[k] !== undefined)
    .map((k) => [k, String(c[k])]);
});
const servers = computed(() => iceServerUrls(config.value));

const summary = computed(() => {
  void props.pc.statsRev;
  const s = props.pc.stats;
  const pair = selectedPair(s);
  const transports = s.byType('transport');
  const t = transports[0];
  let up = 0;
  let down = 0;
  let any = false;
  for (const tr of transports) {
    const u = s.latest(String(tr.id), '[bytesSent_in_bits/s]');
    const d = s.latest(String(tr.id), '[bytesReceived_in_bits/s]');
    if (u !== null || d !== null) any = true;
    up += u ?? 0;
    down += d ?? 0;
  }
  return {
    pair,
    rtt: pair?.rtt !== null && pair?.rtt !== undefined ? `${Math.round(pair.rtt * 1000)} ms` : '—',
    up: any ? formatBitrate(up) : '—',
    down: any ? formatBitrate(down) : '—',
    available: pair?.availableOutgoingBitrate ? formatBitrate(pair.availableOutgoingBitrate) : '—',
    sent: t ? formatBytes(Number(t.bytesSent ?? 0)) : '—',
    received: t ? formatBytes(Number(t.bytesReceived ?? 0)) : '—',
    dtls: t ? `${t.dtlsState ?? '—'}${t.tlsVersion ? ` · TLS ${t.tlsVersion}` : ''}` : '—',
    cipher: t?.srtpCipher ? String(t.srtpCipher) : '—',
    transports: transports.length
  };
});

const chart = computed(() => {
  void props.pc.statsRev;
  const s = props.pc.stats;
  const sum = (field: string) => {
    const out: (number | null)[] = new Array(s.times.length).fill(null);
    for (const tr of s.byType('transport')) {
      s.get(String(tr.id), field).forEach((v, i) => {
        if (v !== null) out[i] = (out[i] ?? 0) + v;
      });
    }
    return out;
  };
  return {
    times: s.times,
    series: [
      { label: 'send', data: sum('[bytesSent_in_bits/s]'), color: '#2080f0' },
      { label: 'receive', data: sum('[bytesReceived_in_bits/s]'), color: '#18a058' }
    ]
  };
});

/** Bandwidth estimation: what the congestion controller allows vs what encoders target vs what is sent. */
const bwe = computed(() => {
  void props.pc.statsRev;
  const s = props.pc.stats;
  const pair = selectedPair(s);
  return {
    times: s.times,
    series: [
      { label: 'available (BWE)', data: pair ? s.get(pair.id, 'availableOutgoingBitrate') : [], color: '#8a2be2' },
      { label: 'target', data: sumSeries(s, 'outbound-rtp', 'targetBitrate'), color: '#f0a020' },
      { label: 'sent (media)', data: sumSeries(s, 'outbound-rtp', '[bytesSent_in_bits/s]'), color: '#2080f0' },
      { label: 'retransmitted', data: sumSeries(s, 'outbound-rtp', '[retransmittedBytesSent_in_bits/s]'), color: '#d03050' }
    ],
    any: s.byType('outbound-rtp').length > 0
  };
});

</script>

<template>
  <div class="wrd-pad wrd-grid">
    <InsightList v-if="insights.length" :insights="insights" />

    <n-card size="small" title="Traffic">
      <div class="wrd-grid cols-4" style="margin-bottom: 8px">
        <div class="wrd-metric"><span class="label">Send</span><span class="value">{{ summary.up }}</span></div>
        <div class="wrd-metric"><span class="label">Receive</span><span class="value">{{ summary.down }}</span></div>
        <div class="wrd-metric"><span class="label">RTT</span><span class="value">{{ summary.rtt }}</span></div>
        <div class="wrd-metric"><span class="label">Available outgoing</span><span class="value">{{ summary.available }}</span></div>
      </div>
      <UPlotChart v-if="chart.times.length > 1" :times="chart.times" :series="chart.series" :version="pc.statsRev" :height="140" :format="(v) => formatBitrate(v)" :sync-key="pc.id" />
      <n-empty v-else size="small" description="Waiting for stats…" />
    </n-card>

    <n-card v-if="bwe.any && bwe.times.length > 1" size="small" title="Bandwidth estimation">
      <div class="wrd-muted" style="margin-bottom: 6px">Sent below target ⇒ encoder limited · target pinned to the estimate ⇒ network limited</div>
      <UPlotChart :times="bwe.times" :series="bwe.series" :version="pc.statsRev" :height="140" :format="(v) => formatBitrate(v)" :sync-key="pc.id" />
    </n-card>

    <div class="wrd-grid cols-2">
      <n-card size="small" title="States">
        <div class="wrd-grid" style="gap: 12px">
          <StateTimeline v-for="t in timelines" :key="t.title" :title="t.title" :current="t.current" :changes="t.changes" :origin="pc.info.createdAt" />
        </div>
      </n-card>

      <n-card size="small" title="Transport">
        <div class="wrd-kv">
          <span class="k">Selected pair</span>
          <span class="v">
            <template v-if="summary.pair">{{ describeCandidate(summary.pair.local, pc.events) }}<br />⇄ {{ describeCandidate(summary.pair.remote, pc.events) }}</template>
            <template v-else>—</template>
          </span>
          <span class="k">DTLS</span><span class="v">{{ summary.dtls }}</span>
          <span class="k">SRTP cipher</span><span class="v">{{ summary.cipher }}</span>
          <span class="k">Bytes sent</span><span class="v">{{ summary.sent }}</span>
          <span class="k">Bytes received</span><span class="v">{{ summary.received }}</span>
          <span class="k">Transports</span><span class="v">{{ summary.transports }}</span>
        </div>
      </n-card>

      <n-card size="small" title="Configuration">
        <div class="wrd-kv" style="margin-bottom: 10px">
          <template v-for="[k, v] in configRows" :key="k">
            <span class="k">{{ k }}</span><span class="v">{{ v }}</span>
          </template>
        </div>
        <div class="wrd-section-title">ICE servers</div>
        <div v-if="!servers.length" class="wrd-muted">none (host candidates only)</div>
        <div v-for="(s, i) in servers" :key="i" class="server">
          <div v-for="u in s.urls" :key="u" class="mono">
            {{ u }}
            <span v-if="turnProvider(u)" class="wrd-muted"> · {{ turnProvider(u) }}</span>
          </div>
          <div v-if="s.username" class="wrd-muted mono">username: {{ s.username }}</div>
        </div>
        <n-collapse style="margin-top: 8px">
          <n-collapse-item title="Raw configuration" name="raw">
            <div class="wrd-section-title">Passed to the constructor</div>
            <JsonBlock :value="pc.info.config" />
            <template v-if="pc.info.effectiveConfig">
              <div class="wrd-section-title" style="margin-top: 8px">getConfiguration() (credentials hidden)</div>
              <JsonBlock :value="pc.info.effectiveConfig" />
            </template>
          </n-collapse-item>
        </n-collapse>
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.server {
  padding: 4px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.15);
}
.server:last-child {
  border-bottom: none;
}
</style>
