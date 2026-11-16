<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { NCard, NCheckbox, NEmpty, NRadioButton, NRadioGroup, NTag } from 'naive-ui';
import type { PcModel } from '../../store/session';
import { previousOf, sdpHistory, type SdpEntry } from '../../lib/sdp-history';
import { isAuxCodec, parseSdp, shortExtension, splitLines } from '../../lib/sdp';
import { diffLines, diffStats } from '../../lib/diff';
import { formatRelative } from '../../lib/format';
import JsonBlock from '../common/JsonBlock.vue';
import { explainNegotiation } from '../../lib/negotiation';

const props = defineProps<{ pc: PcModel }>();
const mode = ref<'parsed' | 'raw' | 'diff'>('parsed');
const selectedKey = ref<string | null>(null);
const showAux = ref(false);

const list = computed(() => {
  void props.pc.rev;
  return sdpHistory(props.pc.events);
});

watch(
  list,
  (l) => {
    if (!l.find((e) => e.key === selectedKey.value)) {
      const lastApplied = [...l].reverse().find((e) => e.applied);
      selectedKey.value = (lastApplied ?? l[l.length - 1])?.key ?? null;
    }
  },
  { immediate: true }
);

const entry = computed<SdpEntry | undefined>(() => list.value.find((e) => e.key === selectedKey.value));
const parsed = computed(() => (entry.value?.sdp ? parseSdp(entry.value.sdp) : null));
const previous = computed(() => (entry.value ? previousOf(list.value, entry.value) : undefined));
const diff = computed(() => {
  if (!entry.value?.sdp || !previous.value) return null;
  const lines = diffLines(splitLines(previous.value.sdp), splitLines(entry.value.sdp));
  return { lines, ...diffStats(lines) };
});

const negotiation = computed(() => {
  void props.pc.rev;
  void props.pc.statsRev;
  return explainNegotiation(props.pc.events, props.pc.stats);
});
const showNegotiation = ref(true);

const dirTone = (d: string) => (d === 'sendrecv' ? 'success' : d === 'inactive' ? 'default' : 'info');
</script>

<template>
  <div class="sdp">
    <nav class="list">
      <div
        v-for="e in list"
        :key="e.key"
        class="item"
        :class="{ active: e.key === selectedKey }"
        @click="selectedKey = e.key"
      >
        <div class="row1">
          <span class="wrd-dot" :class="e.error ? 'error' : e.applied ? 'success' : 'info'" />
          <strong>{{ e.side }}</strong>
          <span>{{ e.type || '—' }}</span>
        </div>
        <div class="row2 wrd-muted">
          <span>{{ e.source }}</span>
          <span class="mono">{{ formatRelative(e.ts, pc.info.createdAt) }}</span>
        </div>
      </div>
      <div v-if="!list.length" class="wrd-muted" style="padding: 10px">No SDP exchanged yet</div>
    </nav>

    <section class="view">
      <n-empty v-if="!entry" description="Select a description" style="margin-top: 40px" />
      <template v-else>
        <div class="bar">
          <n-radio-group v-model:value="mode" size="small">
            <n-radio-button value="parsed">Parsed</n-radio-button>
            <n-radio-button value="raw">Raw</n-radio-button>
            <n-radio-button value="diff" :disabled="!previous">Diff vs previous</n-radio-button>
          </n-radio-group>
          <n-checkbox v-if="mode === 'parsed'" v-model:checked="showAux" size="small">Show rtx/red/fec codecs</n-checkbox>
          <span v-if="entry.error" style="color: #d03050">{{ entry.error.name }}: {{ entry.error.message }}</span>
        </div>

        <div v-if="mode === 'raw'" class="wrd-pad"><JsonBlock :value="entry.sdp" raw /></div>

        <div v-else-if="mode === 'diff' && diff" class="wrd-pad">
          <div class="wrd-muted" style="margin-bottom: 6px">
            Compared with {{ previous!.side }} {{ previous!.type }} from {{ previous!.source }} ({{ formatRelative(previous!.ts, pc.info.createdAt) }}):
            <span style="color: #18a058">+{{ diff.added }}</span> / <span style="color: #d03050">−{{ diff.removed }}</span>
          </div>
          <pre class="wrd-pre diff"><div v-for="(l, i) in diff.lines" :key="i" :class="l.op">{{ l.op === 'add' ? '+ ' : l.op === 'del' ? '- ' : '  ' }}{{ l.text }}</div></pre>
        </div>

        <div v-else-if="parsed" class="wrd-pad wrd-grid">
          <n-card v-if="negotiation.length" size="small" title="Codec negotiation (latest offer/answer)">
            <template #header-extra>
              <a style="cursor: pointer" class="wrd-muted" @click="showNegotiation = !showNegotiation">{{ showNegotiation ? 'hide' : 'show' }}</a>
            </template>
            <table v-if="showNegotiation" class="codecs">
              <thead><tr><th>mid</th><th>Offered</th><th>Answer kept</th><th>In use</th><th>Notes</th></tr></thead>
              <tbody>
                <tr v-for="n in negotiation" :key="n.mid">
                  <td class="mono">{{ n.mid }} <span class="wrd-muted">{{ n.kind }}</span></td>
                  <td class="mono">{{ n.offered.join(', ') }}</td>
                  <td class="mono">
                    <template v-for="(c, i) in n.answered" :key="c"><strong v-if="i === 0">{{ c }}</strong><span v-else>, {{ c }}</span></template>
                    <span v-if="n.removed.length" style="color: #d03050"> (dropped: {{ n.removed.join(', ') }})</span>
                  </td>
                  <td class="mono">
                    <span v-if="n.sending">↑ {{ n.sending }}</span>
                    <span v-if="n.receiving"> ↓ {{ n.receiving }}</span>
                    <span v-if="!n.sending && !n.receiving" class="wrd-muted">—</span>
                  </td>
                  <td>
                    <div v-for="note in n.notes" :key="note" class="wrd-muted">{{ note }}</div>
                    <div v-if="n.preferencesCalled" class="wrd-muted">setCodecPreferences() was called for this transceiver.</div>
                  </td>
                </tr>
              </tbody>
            </table>
          </n-card>
          <n-card size="small" title="Session">
            <div class="wrd-kv">
              <template v-for="g in parsed.groups" :key="g.semantics">
                <span class="k">group</span><span class="v">{{ g.semantics }} {{ g.mids.join(' ') }}</span>
              </template>
              <span class="k">origin</span><span class="v">{{ parsed.origin }}</span>
              <template v-if="parsed.iceOptions"><span class="k">ice-options</span><span class="v">{{ parsed.iceOptions }}</span></template>
              <template v-if="parsed.msidSemantic"><span class="k">msid-semantic</span><span class="v">{{ parsed.msidSemantic }}</span></template>
              <span class="k">extmap-allow-mixed</span><span class="v">{{ parsed.extmapAllowMixed }}</span>
            </div>
          </n-card>
          <n-card v-for="m in parsed.media" :key="m.index" size="small">
            <template #header>
              <span style="display: flex; gap: 8px; align-items: center">
                <strong>m={{ m.kind }}</strong>
                <span class="wrd-muted">mid {{ m.mid ?? '—' }}</span>
                <n-tag size="tiny" :bordered="false" :type="dirTone(m.direction)">{{ m.direction }}</n-tag>
                <n-tag v-if="m.port === 0" size="tiny" :bordered="false" type="warning">rejected (port 0)</n-tag>
                <n-tag v-if="m.simulcast" size="tiny" :bordered="false" type="info">simulcast</n-tag>
              </span>
            </template>
            <div class="wrd-kv" style="margin-bottom: 8px">
              <span class="k">protocol</span><span class="v">{{ m.protocol }}</span>
              <template v-if="m.msid"><span class="k">msid</span><span class="v">{{ m.msid }}</span></template>
              <template v-if="m.setup"><span class="k">setup</span><span class="v">{{ m.setup }}</span></template>
              <template v-if="m.iceUfrag"><span class="k">ice-ufrag</span><span class="v">{{ m.iceUfrag }}</span></template>
              <span class="k">rtcp-mux / rsize</span><span class="v">{{ m.rtcpMux }} / {{ m.rtcpRsize }}</span>
              <template v-if="m.bandwidth.length"><span class="k">bandwidth</span><span class="v">{{ m.bandwidth.map((b) => `${b.type}:${b.value}`).join(' ') }}</span></template>
              <template v-if="m.simulcast"><span class="k">simulcast</span><span class="v">{{ m.simulcast }}</span></template>
              <template v-if="m.rids.length"><span class="k">rids</span><span class="v">{{ m.rids.map((r) => `${r.id} (${r.direction}${r.params ? ' ' + r.params : ''})`).join(', ') }}</span></template>
              <template v-if="m.sctpPort"><span class="k">sctp-port</span><span class="v">{{ m.sctpPort }} (max-message-size {{ m.maxMessageSize ?? '—' }})</span></template>
              <template v-if="m.candidates.length"><span class="k">candidates</span><span class="v">{{ m.candidates.length }} in SDP</span></template>
              <template v-if="m.ssrcs.length"><span class="k">ssrcs</span><span class="v">{{ m.ssrcs.map((s) => s.ssrc).join(', ') }}</span></template>
              <template v-for="g in m.ssrcGroups" :key="g.semantics + g.ssrcs.join()"><span class="k">ssrc-group</span><span class="v">{{ g.semantics }} {{ g.ssrcs.join(' ') }}</span></template>
            </div>
            <table v-if="m.codecs.length && m.kind !== 'application'" class="codecs">
              <thead><tr><th>PT</th><th>Codec</th><th>Clock</th><th>fmtp</th><th>rtcp-fb</th></tr></thead>
              <tbody>
                <tr v-for="c in m.codecs.filter((c) => showAux || !isAuxCodec(c.name))" :key="c.pt">
                  <td class="mono">{{ c.pt }}</td>
                  <td><strong>{{ c.name }}</strong>{{ c.channels ? `/${c.channels}` : '' }}</td>
                  <td class="mono">{{ c.clockRate }}</td>
                  <td class="mono">{{ c.fmtp }}</td>
                  <td class="mono">{{ c.rtcpFb.join(', ') }}</td>
                </tr>
              </tbody>
            </table>
            <div v-if="m.extensions.length" class="exts">
              <span class="wrd-muted">Header extensions:</span>
              <n-tag v-for="x in m.extensions" :key="x.id" size="tiny" :bordered="false" :title="x.uri">{{ x.id }}: {{ shortExtension(x.uri) }}</n-tag>
            </div>
          </n-card>
        </div>
      </template>
    </section>
  </div>
</template>

<style scoped>
.sdp {
  display: flex;
  height: 100%;
  min-height: 0;
}
.list {
  width: 210px;
  flex: none;
  overflow: auto;
  border-right: 1px solid rgba(128, 128, 128, 0.25);
}
.item {
  padding: 6px 10px;
  cursor: pointer;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.item:hover {
  background: rgba(128, 128, 128, 0.12);
}
.item.active {
  background: rgba(32, 128, 240, 0.2);
}
.row1 {
  display: flex;
  gap: 6px;
  align-items: center;
}
.row2 {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
}
.view {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.bar {
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 8px 12px 0;
}
.codecs {
  width: 100%;
  border-collapse: collapse;
}
.codecs th,
.codecs td {
  text-align: left;
  padding: 2px 8px 2px 0;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
  vertical-align: top;
}
.codecs th {
  font-weight: 500;
  opacity: 0.6;
}
.exts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
  align-items: center;
}
.diff .add {
  background: rgba(24, 160, 88, 0.18);
}
.diff .del {
  background: rgba(208, 48, 80, 0.18);
}
@media (max-width: 600px) {
  .sdp {
    flex-direction: column;
  }
  .list {
    width: auto;
    max-height: 30%;
    border-right: none;
    border-bottom: 1px solid rgba(128, 128, 128, 0.25);
  }
}
</style>
