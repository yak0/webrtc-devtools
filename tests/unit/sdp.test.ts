import { describe, expect, it } from 'vitest';
import { parseSdp } from '@/panel/lib/sdp';
import { diffLines, diffStats } from '@/panel/lib/diff';
import { parseCandidate } from '@/panel/lib/ice';
import { sdpHistory } from '@/panel/lib/sdp-history';

const SDP = [
  'v=0',
  'o=- 123 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'a=extmap-allow-mixed',
  'a=msid-semantic: WMS',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111 63',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:abcd',
  'a=fingerprint:sha-256 AA:BB',
  'a=setup:actpass',
  'a=mid:0',
  'a=extmap:1 urn:ietf:params:rtp-hdrext:ssrc-audio-level',
  'a=sendrecv',
  'a=rtcp-mux',
  'a=rtpmap:111 opus/48000/2',
  'a=rtcp-fb:111 transport-cc',
  'a=fmtp:111 minptime=10;useinbandfec=1',
  'a=rtpmap:63 red/48000/2',
  'a=ssrc:1111 cname:xyz',
  'a=ssrc:1111 msid:s t',
  'm=video 9 UDP/TLS/RTP/SAVPF 96 97',
  'a=mid:1',
  'a=recvonly',
  'a=rtpmap:96 VP8/90000',
  'a=rtcp-fb:* nack',
  'a=rtpmap:97 rtx/90000',
  'a=fmtp:97 apt=96',
  'a=rid:h send',
  'a=rid:l send',
  'a=simulcast:send h;l',
  ''
].join('\r\n');

describe('parseSdp', () => {
  it('parses sections, codecs, ssrcs and simulcast', () => {
    const p = parseSdp(SDP);
    expect(p.groups).toEqual([{ semantics: 'BUNDLE', mids: ['0', '1'] }]);
    expect(p.extmapAllowMixed).toBe(true);
    expect(p.media).toHaveLength(2);
    const [audio, video] = p.media;
    expect(audio.kind).toBe('audio');
    expect(audio.direction).toBe('sendrecv');
    expect(audio.codecs[0]).toMatchObject({ pt: 111, name: 'opus', clockRate: 48000, channels: 2, fmtp: 'minptime=10;useinbandfec=1', rtcpFb: ['transport-cc'] });
    expect(audio.ssrcs).toEqual([{ ssrc: 1111, attributes: { cname: 'xyz', msid: 's t' } }]);
    expect(audio.extensions[0]).toMatchObject({ id: 1 });
    expect(video.direction).toBe('recvonly');
    expect(video.codecs.map((c) => c.name)).toEqual(['VP8', 'rtx']);
    expect(video.codecs[0].rtcpFb).toEqual(['nack']);
    expect(video.rids.map((r) => r.id)).toEqual(['h', 'l']);
    expect(video.simulcast).toBe('send h;l');
  });
});

describe('diffLines', () => {
  it('finds added and removed lines', () => {
    const d = diffLines(['a', 'b', 'c'], ['a', 'c', 'd']);
    expect(d.map((l) => `${l.op}:${l.text}`)).toEqual(['same:a', 'del:b', 'same:c', 'add:d']);
    expect(diffStats(d)).toEqual({ added: 1, removed: 1 });
  });
});

describe('parseCandidate', () => {
  it('parses srflx candidates with related address', () => {
    const c = parseCandidate('candidate:842163049 1 udp 1677729535 1.2.3.4 46154 typ srflx raddr 10.0.0.1 rport 46154 generation 0 ufrag sXP5 network-cost 999');
    expect(c).toMatchObject({ protocol: 'udp', address: '1.2.3.4', port: 46154, type: 'srflx', relatedAddress: '10.0.0.1', ufrag: 'sXP5' });
  });
  it('rejects garbage', () => {
    expect(parseCandidate('')).toBeNull();
  });
});

describe('sdpHistory', () => {
  it('extracts offers and applied descriptions', () => {
    const list = sdpHistory([
      { seq: 1, ts: 1, kind: 'call', name: 'createOffer', result: { type: 'offer', sdp: SDP } },
      { seq: 2, ts: 2, kind: 'call', name: 'setLocalDescription', args: [], result: { localDescription: { type: 'offer', sdp: SDP } } },
      { seq: 3, ts: 3, kind: 'call', name: 'setRemoteDescription', args: [{ type: 'answer', sdp: 'v=0' }], error: { name: 'InvalidAccessError', message: 'bad' } }
    ]);
    expect(list.map((e) => [e.source, e.side, e.applied])).toEqual([
      ['createOffer', 'local', false],
      ['setLocalDescription', 'local', true],
      ['setRemoteDescription', 'remote', false]
    ]);
  });
});
