// Small SDP parser focused on what is useful when debugging (no dependency).

export interface SdpCodec {
  pt: number;
  name: string;
  clockRate: number;
  channels?: number;
  fmtp?: string;
  rtcpFb: string[];
}

export interface SdpMedia {
  index: number;
  kind: string;
  port: number;
  protocol: string;
  mid?: string;
  direction: string;
  codecs: SdpCodec[];
  extensions: { id: number; uri: string; direction?: string }[];
  ssrcs: { ssrc: number; attributes: Record<string, string> }[];
  ssrcGroups: { semantics: string; ssrcs: number[] }[];
  rids: { id: string; direction: string; params?: string }[];
  simulcast?: string;
  msid?: string;
  iceUfrag?: string;
  setup?: string;
  fingerprint?: string;
  rtcpMux: boolean;
  rtcpRsize: boolean;
  bandwidth: { type: string; value: number }[];
  candidates: string[];
  sctpPort?: number;
  maxMessageSize?: number;
  bundleOnly: boolean;
}

export interface ParsedSdp {
  origin?: string;
  sessionName?: string;
  groups: { semantics: string; mids: string[] }[];
  msidSemantic?: string;
  iceUfrag?: string;
  iceOptions?: string;
  fingerprint?: string;
  extmapAllowMixed: boolean;
  media: SdpMedia[];
}

const DIRECTIONS = new Set(['sendrecv', 'sendonly', 'recvonly', 'inactive']);

export function splitLines(sdp: string): string[] {
  return sdp.split(/\r?\n/).filter((l) => l.length > 0);
}

export function parseSdp(sdp: string): ParsedSdp {
  const out: ParsedSdp = { groups: [], extmapAllowMixed: false, media: [] };
  let m: SdpMedia | null = null;
  const sessionDirection: { v?: string } = {};

  for (const line of splitLines(sdp)) {
    const type = line[0];
    const value = line.slice(2);
    if (type === 'm') {
      const [kind, port, protocol, ...fmts] = value.split(' ');
      m = {
        index: out.media.length,
        kind,
        port: Number(port),
        protocol,
        direction: sessionDirection.v ?? 'sendrecv',
        codecs: fmts
          .map(Number)
          .filter((n) => Number.isFinite(n))
          .map((pt) => ({ pt, name: '', clockRate: 0, rtcpFb: [] })),
        extensions: [],
        ssrcs: [],
        ssrcGroups: [],
        rids: [],
        rtcpMux: false,
        rtcpRsize: false,
        bandwidth: [],
        candidates: [],
        bundleOnly: false
      };
      out.media.push(m);
      continue;
    }
    if (type === 'o' && !m) out.origin = value;
    else if (type === 's' && !m) out.sessionName = value;
    else if (type === 'b' && m) {
      const [bt, bv] = value.split(':');
      m.bandwidth.push({ type: bt, value: Number(bv) });
    } else if (type === 'a') {
      const colon = value.indexOf(':');
      const attr = colon === -1 ? value : value.slice(0, colon);
      const rest = colon === -1 ? '' : value.slice(colon + 1);
      if (!m) {
        if (attr === 'group') {
          const [semantics, ...mids] = rest.split(' ');
          out.groups.push({ semantics, mids });
        } else if (attr === 'msid-semantic') out.msidSemantic = rest.trim();
        else if (attr === 'ice-ufrag') out.iceUfrag = rest;
        else if (attr === 'ice-options') out.iceOptions = rest;
        else if (attr === 'fingerprint') out.fingerprint = rest;
        else if (attr === 'extmap-allow-mixed') out.extmapAllowMixed = true;
        else if (DIRECTIONS.has(attr)) sessionDirection.v = attr;
        continue;
      }
      if (DIRECTIONS.has(attr)) m.direction = attr;
      else if (attr === 'mid') m.mid = rest;
      else if (attr === 'msid') m.msid = rest;
      else if (attr === 'ice-ufrag') m.iceUfrag = rest;
      else if (attr === 'setup') m.setup = rest;
      else if (attr === 'fingerprint') m.fingerprint = rest;
      else if (attr === 'rtcp-mux') m.rtcpMux = true;
      else if (attr === 'rtcp-rsize') m.rtcpRsize = true;
      else if (attr === 'bundle-only') m.bundleOnly = true;
      else if (attr === 'candidate') m.candidates.push(rest);
      else if (attr === 'sctp-port') m.sctpPort = Number(rest);
      else if (attr === 'max-message-size') m.maxMessageSize = Number(rest);
      else if (attr === 'simulcast') m.simulcast = rest;
      else if (attr === 'rtpmap') {
        const [pt, enc] = [rest.slice(0, rest.indexOf(' ')), rest.slice(rest.indexOf(' ') + 1)];
        const [name, clock, channels] = enc.split('/');
        const codec = codecFor(m, Number(pt));
        codec.name = name;
        codec.clockRate = Number(clock);
        if (channels) codec.channels = Number(channels);
      } else if (attr === 'fmtp') {
        const sp = rest.indexOf(' ');
        codecFor(m, Number(rest.slice(0, sp))).fmtp = rest.slice(sp + 1);
      } else if (attr === 'rtcp-fb') {
        const sp = rest.indexOf(' ');
        const pt = rest.slice(0, sp);
        const fb = rest.slice(sp + 1);
        if (pt === '*') m.codecs.forEach((c) => c.rtcpFb.push(fb));
        else codecFor(m, Number(pt)).rtcpFb.push(fb);
      } else if (attr === 'extmap') {
        const [idDir, uri] = rest.split(' ');
        const [id, direction] = idDir.split('/');
        m.extensions.push({ id: Number(id), uri, direction });
      } else if (attr === 'ssrc') {
        const sp = rest.indexOf(' ');
        const ssrc = Number(rest.slice(0, sp));
        const kv = rest.slice(sp + 1);
        const c = kv.indexOf(':');
        const key = c === -1 ? kv : kv.slice(0, c);
        const val = c === -1 ? '' : kv.slice(c + 1);
        let s = m.ssrcs.find((x) => x.ssrc === ssrc);
        if (!s) m.ssrcs.push((s = { ssrc, attributes: {} }));
        s.attributes[key] = val;
      } else if (attr === 'ssrc-group') {
        const [semantics, ...ssrcs] = rest.split(' ');
        m.ssrcGroups.push({ semantics, ssrcs: ssrcs.map(Number) });
      } else if (attr === 'rid') {
        const [id, direction, params] = rest.split(' ');
        m.rids.push({ id, direction, params });
      }
    }
  }
  return out;
}

function codecFor(m: SdpMedia, pt: number): SdpCodec {
  let c = m.codecs.find((x) => x.pt === pt);
  if (!c) m.codecs.push((c = { pt, name: '', clockRate: 0, rtcpFb: [] }));
  return c;
}

export function shortExtension(uri: string): string {
  const known: Record<string, string> = {
    'urn:ietf:params:rtp-hdrext:ssrc-audio-level': 'audio-level',
    'urn:ietf:params:rtp-hdrext:toffset': 'toffset',
    'http://www.webrtc.org/experiments/rtp-hdrext/abs-send-time': 'abs-send-time',
    'http://www.ietf.org/id/draft-holmer-rmcat-transport-wide-cc-extensions-01': 'transport-cc',
    'urn:ietf:params:rtp-hdrext:sdes:mid': 'mid',
    'urn:ietf:params:rtp-hdrext:sdes:rtp-stream-id': 'rid',
    'urn:ietf:params:rtp-hdrext:sdes:repaired-rtp-stream-id': 'repaired-rid',
    'urn:3gpp:video-orientation': 'video-orientation',
    'http://www.webrtc.org/experiments/rtp-hdrext/playout-delay': 'playout-delay',
    'http://www.webrtc.org/experiments/rtp-hdrext/video-content-type': 'video-content-type',
    'http://www.webrtc.org/experiments/rtp-hdrext/video-timing': 'video-timing',
    'http://www.webrtc.org/experiments/rtp-hdrext/color-space': 'color-space',
    'https://aomediacodec.github.io/av1-rtp-spec/#dependency-descriptor-rtp-header-extension': 'dependency-descriptor',
    'http://www.webrtc.org/experiments/rtp-hdrext/abs-capture-time': 'abs-capture-time',
    'http://www.webrtc.org/experiments/rtp-hdrext/video-layers-allocation00': 'video-layers-allocation'
  };
  return known[uri] ?? uri;
}

/** Codecs that carry no media (used to hide noise). */
export function isAuxCodec(name: string): boolean {
  return /^(rtx|red|ulpfec|flexfec-03|telephone-event|CN)$/i.test(name);
}
