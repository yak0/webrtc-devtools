// Globals that well-known WebRTC SDKs put on window when loaded from a <script> tag / CDN.
// Bundled (npm) apps usually expose nothing, so the panel also looks at stacks, ICE servers, SDP, etc.

const PROBES: { name: string; global: string; version: (g: any) => unknown }[] = [
  { name: 'LiveKit', global: 'LivekitClient', version: (g) => g.version },
  { name: 'mediasoup', global: 'mediasoupClient', version: (g) => g.version },
  { name: 'Twilio Video', global: 'Twilio', version: (g) => g.Video?.version ?? (g.Video ? '' : undefined) },
  { name: 'Daily', global: 'DailyIframe', version: (g) => (typeof g.version === 'function' ? g.version() : g.version) },
  { name: 'Daily', global: 'Daily', version: (g) => (typeof g.version === 'function' ? g.version() : g.version) },
  { name: 'Agora', global: 'AgoraRTC', version: (g) => g.VERSION },
  { name: 'Jitsi', global: 'JitsiMeetJS', version: (g) => g.version },
  { name: 'Jitsi', global: 'JitsiMeetExternalAPI', version: () => '' },
  { name: 'Janus', global: 'Janus', version: () => '' },
  { name: 'Vonage (OpenTok)', global: 'OT', version: (g) => g.version ?? g.properties?.version },
  { name: 'Amazon Chime', global: 'ChimeSDK', version: (g) => g.Versioning?.sdkVersion },
  { name: 'PeerJS', global: 'Peer', version: () => '' },
  { name: 'simple-peer', global: 'SimplePeer', version: () => '' },
  { name: 'Ant Media', global: 'WebRTCAdaptor', version: () => '' },
  { name: 'Kurento', global: 'kurentoUtils', version: () => '' },
  { name: 'Dolby.io / Millicast', global: 'millicast', version: (g) => g.version },
  { name: '100ms', global: 'HMSReactiveStore', version: () => '' },
  { name: 'Zoom Video SDK', global: 'ZoomVideo', version: (g) => g.VERSION }
];

export function probeSdkGlobals(w: any): { name: string; version?: string; global: string }[] {
  const out: { name: string; version?: string; global: string }[] = [];
  for (const p of PROBES) {
    try {
      const g = w[p.global];
      if (g === undefined || g === null || (typeof g !== 'object' && typeof g !== 'function')) continue;
      // "Peer" / "OT" are generic names: require something SDK-shaped.
      if (p.global === 'Peer' && typeof g.prototype?.connect !== 'function') continue;
      if (p.global === 'OT' && typeof g.initSession !== 'function') continue;
      if (p.global === 'Twilio' && !g.Video) continue;
      const v = p.version(g);
      out.push({ name: p.name, global: p.global, version: v === undefined || v === null || v === '' ? undefined : String(v) });
    } catch {
      /* getters may throw */
    }
  }
  return out;
}
