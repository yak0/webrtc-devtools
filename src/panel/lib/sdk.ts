// Best-effort detection of the WebRTC SDK behind a connection, and of its role.
// Several independent signals are scored; the UI shows the evidence, not just a name.
import type { PageEnv, TraceEvent } from '@/shared/protocol';
import { iceServerUrls } from './ice';
import { sdpHistory } from './sdp-history';
import { parseSdp } from './sdp';

export interface SdkGuess {
  name: string;
  version?: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  evidence: string[];
}

export type PcRole = 'publisher' | 'subscriber' | 'bidirectional' | 'data only' | 'unknown';

/** Package / file names that show up in stack traces (dev builds, CDN files, source maps). */
const STACK_PATTERNS: [RegExp, string][] = [
  [/livekit-client|livekit\.(umd|esm)/i, 'LiveKit'],
  [/mediasoup-client/i, 'mediasoup'],
  [/twilio-video/i, 'Twilio Video'],
  [/@daily-co|daily-js|daily-iframe/i, 'Daily'],
  [/agora-rtc|AgoraRTC_N/i, 'Agora'],
  [/lib-jitsi-meet|jitsi-meet/i, 'Jitsi'],
  [/janus(\.es|\.min)?\.js|janus-gateway/i, 'Janus'],
  [/@opentok|opentok(\.min)?\.js|@vonage\/client-sdk-video/i, 'Vonage (OpenTok)'],
  [/amazon-chime-sdk/i, 'Amazon Chime'],
  [/@100mslive/i, '100ms'],
  [/@zoom\/videosdk/i, 'Zoom Video SDK'],
  [/@stream-io\/video/i, 'Stream Video'],
  [/peerjs/i, 'PeerJS'],
  [/simple-peer|simplepeer/i, 'simple-peer'],
  [/@millicast|millicast-sdk|@dolbyio/i, 'Dolby.io / Millicast'],
  [/webrtc_adaptor|WebRTCAdaptor/i, 'Ant Media'],
  [/kurento-utils/i, 'Kurento'],
  [/@cloudflare\/(realtimekit|calls)|realtimekit/i, 'Cloudflare Realtime'],
  [/@whereby/i, 'Whereby']
];

/** ICE/TURN hosts operated by SDK vendors. */
const ICE_HOST_PATTERNS: [RegExp, string][] = [
  [/livekit\.cloud|livekit\.io/i, 'LiveKit'],
  [/twilio\.com/i, 'Twilio Video'],
  [/daily\.co|wss\.daily/i, 'Daily'],
  [/agora\.io|agoraio\.cn|sd-rtn\.com/i, 'Agora'],
  [/jit\.si|jitsi\.net|8x8\.vc/i, 'Jitsi'],
  [/chime\.aws/i, 'Amazon Chime'],
  [/100ms\.live/i, '100ms'],
  [/zoom\.us|zoomgov/i, 'Zoom Video SDK'],
  [/stream-io-video\.com|getstream\.io/i, 'Stream Video'],
  [/millicast\.com/i, 'Dolby.io / Millicast'],
  [/tokbox\.com|opentok\.com|vonage/i, 'Vonage (OpenTok)']
];

/** TURN providers are not SDKs but are worth naming in the ICE server list. */
const TURN_PROVIDERS: [RegExp, string][] = [
  [/global\.turn\.twilio\.com|turn\.twilio\.com/i, 'Twilio Network Traversal'],
  [/xirsys\.com/i, 'Xirsys'],
  [/metered\.(ca|live)|relay\.metered/i, 'Metered'],
  [/turn\.cloudflare\.com/i, 'Cloudflare TURN'],
  [/stun\.l\.google\.com|stun\d\.l\.google\.com/i, 'Google STUN'],
  [/livekit\.cloud/i, 'LiveKit Cloud'],
  [/turn\.voximplant/i, 'Voximplant'],
  [/subspace\.com/i, 'Subspace']
];

export function turnProvider(url: string): string | undefined {
  return TURN_PROVIDERS.find(([re]) => re.test(url))?.[1];
}

interface Input {
  stack?: string;
  config?: unknown;
  events: TraceEvent[];
  dataChannelLabels: string[];
  pageUrl?: string;
  env?: PageEnv;
}

export function detectSdk(input: Input): SdkGuess | null {
  const scores = new Map<string, { score: number; evidence: Set<string>; version?: string }>();
  const add = (name: string, score: number, evidence: string, version?: string) => {
    const s = scores.get(name) ?? { score: 0, evidence: new Set<string>() };
    s.score += score;
    s.evidence.add(evidence);
    if (version) s.version = version;
    scores.set(name, s);
  };

  // 1. Stack of `new RTCPeerConnection()`: the strongest signal when it names a package.
  if (input.stack) {
    for (const [re, name] of STACK_PATTERNS) {
      const line = input.stack.split('\n').find((l) => re.test(l));
      if (line) add(name, 4, `created from ${line.replace(/^at\s+/, '').slice(0, 120)}`);
    }
  }

  // 2. Globals exposed on the page.
  for (const g of input.env?.sdks ?? []) add(g.name, 3, `window.${g.global}${g.version ? ` (v${g.version})` : ''} is defined`, g.version);

  // 3. ICE servers.
  for (const s of iceServerUrls(input.config)) {
    for (const url of s.urls) {
      for (const [re, name] of ICE_HOST_PATTERNS) if (re.test(url)) add(name, 2, `ICE server ${url}`);
    }
  }

  // 4. Data channel labels.
  const labels = new Set(input.dataChannelLabels);
  if (labels.has('_reliable') || labels.has('_lossy')) add('LiveKit', 4, 'data channels "_reliable" / "_lossy"');
  if (labels.has('JVBDataChannel') || (labels.has('datachannel') && /jitsi/i.test(input.stack ?? ''))) add('Jitsi', 3, 'Jitsi bridge data channel');

  // 5. SDP fingerprints.
  for (const entry of sdpHistory(input.events)) {
    if (!entry.sdp) continue;
    const head = entry.sdp.slice(0, 400);
    if (/^o=mediasoup-client /m.test(head)) add('mediasoup', 4, `${entry.side} SDP origin "o=mediasoup-client"`);
    if (/^s=(VideoRoom|AudioBridge|Streaming|VideoCall|EchoTest|SIP)\b/m.test(head)) add('Janus', 3, `${entry.side} SDP session name "${/^s=(.*)$/m.exec(head)?.[1]}"`);
    if (/^o=- \d+ \d+ IN IP4 0\.0\.0\.0/m.test(head) && entry.side === 'remote' && /a=ice-lite/.test(entry.sdp)) {
      add('SFU (ice-lite server)', 1, 'remote SDP uses ice-lite (typical for SFUs)');
    }
  }

  // 6. Page URL (weak).
  if (input.pageUrl) {
    for (const [re, name] of ICE_HOST_PATTERNS) if (re.test(input.pageUrl)) add(name, 1, `page served from ${new URL(input.pageUrl).host}`);
  }

  let best: SdkGuess | null = null;
  for (const [name, s] of scores) {
    if (name === 'SFU (ice-lite server)' && scores.size > 1) continue;
    if (!best || s.score > best.score) {
      best = {
        name,
        version: s.version,
        score: s.score,
        evidence: [...s.evidence],
        confidence: s.score >= 4 ? 'high' : s.score >= 2 ? 'medium' : 'low'
      };
    }
  }
  return best;
}

/** What a connection is used for, independent of the SDK. */
export function detectRole(events: TraceEvent[], dataChannels: number): { role: PcRole; offerer: boolean | null } {
  let offerer: boolean | null = null;
  let sends = false;
  let receives = false;
  for (const e of events) {
    if (offerer === null && e.kind === 'call' && !e.error) {
      if (e.name === 'createOffer') offerer = true;
      else if (e.name === 'setRemoteDescription' && (e.args as any)?.[0]?.type === 'offer') offerer = false;
    }
    if (e.kind === 'event' && e.name === 'track') receives = true;
  }
  const local = [...sdpHistory(events)].reverse().find((s) => s.side === 'local' && s.applied && s.sdp);
  if (local) {
    for (const m of parseSdp(local.sdp).media) {
      if (m.kind === 'application' || m.port === 0) continue;
      // Receiving is decided by actual "track" events, not by the negotiated direction.
      if ((m.direction === 'sendonly' || m.direction === 'sendrecv') && (m.ssrcs.length > 0 || m.msid)) sends = true;
    }
  }
  if (!sends && events.some((e) => e.kind === 'call' && (e.name === 'addTrack' || e.name === 'addTransceiver') && !e.error)) {
    const t = events.find((e) => e.name === 'addTransceiver');
    sends = !t || (t.args as any)?.[1]?.direction !== 'recvonly';
  }
  const role: PcRole = sends && receives ? 'bidirectional' : sends ? 'publisher' : receives ? 'subscriber' : dataChannels > 0 ? 'data only' : 'unknown';
  return { role, offerer };
}
