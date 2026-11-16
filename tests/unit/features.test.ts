import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@/shared/protocol';
import { detectRole, detectSdk, turnProvider } from '@/panel/lib/sdk';
import { audioMos, videoScore } from '@/panel/lib/quality';
import { explainNegotiation } from '@/panel/lib/negotiation';
import { serversFromInput, verdict } from '@/panel/lib/turn-test';
import { StatsTimeline } from '@/panel/lib/stats-timeline';
import { probeSdkGlobals } from '@/injected/sdk-globals';

const sdp = (codecs: [number, string][], dir = 'sendrecv', extra = '') =>
  ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', `m=video 9 UDP/TLS/RTP/SAVPF ${codecs.map((c) => c[0]).join(' ')}`, 'a=mid:0', `a=${dir}`, 'a=msid:s t', 'a=ssrc:1 cname:x', ...codecs.map(([pt, n]) => `a=rtpmap:${pt} ${n}/90000`), extra, ''].join('\r\n');

describe('SDK detection', () => {
  it('uses the creation stack', () => {
    const g = detectSdk({ stack: 'at new Room (http://localhost:5173/node_modules/.vite/deps/livekit-client.js:123:4)', events: [], dataChannelLabels: [] });
    expect(g).toMatchObject({ name: 'LiveKit', confidence: 'high' });
  });
  it('combines ICE servers and data channel labels', () => {
    const g = detectSdk({
      config: { iceServers: [{ urls: ['turn:foo.turn.livekit.cloud:443'] }] },
      events: [],
      dataChannelLabels: ['_reliable', '_lossy']
    });
    expect(g?.name).toBe('LiveKit');
    expect(g?.evidence.length).toBe(2);
  });
  it('recognizes mediasoup by the SDP origin', () => {
    const remote = sdp([[96, 'VP8']]).replace('o=- 1 2', 'o=mediasoup-client 10000 1');
    const events: TraceEvent[] = [{ seq: 1, ts: 1, kind: 'call', name: 'setRemoteDescription', args: [{ type: 'offer', sdp: remote }], result: { remoteDescription: { type: 'offer', sdp: remote } } }];
    expect(detectSdk({ events, dataChannelLabels: [] })?.name).toBe('mediasoup');
  });
  it('returns null without evidence', () => {
    expect(detectSdk({ events: [], dataChannelLabels: [] })).toBeNull();
  });
  it('probes page globals', () => {
    const found = probeSdkGlobals({ LivekitClient: { version: '2.5.0' }, Peer: { foo: 1 }, OT: {} });
    expect(found).toEqual([{ name: 'LiveKit', global: 'LivekitClient', version: '2.5.0' }]);
  });
  it('names TURN providers', () => {
    expect(turnProvider('turn:global.turn.twilio.com:3478?transport=udp')).toBe('Twilio Network Traversal');
  });
});

describe('role detection', () => {
  it('publisher: sends media, receives none', () => {
    const local = sdp([[96, 'VP8']], 'sendonly');
    const events: TraceEvent[] = [
      { seq: 1, ts: 1, kind: 'call', name: 'createOffer', result: { type: 'offer', sdp: local } },
      { seq: 2, ts: 2, kind: 'call', name: 'setLocalDescription', result: { localDescription: { type: 'offer', sdp: local } } }
    ];
    expect(detectRole(events, 0)).toEqual({ role: 'publisher', offerer: true });
  });
  it('subscriber: remote offer + track events', () => {
    const events: TraceEvent[] = [
      { seq: 1, ts: 1, kind: 'call', name: 'setRemoteDescription', args: [{ type: 'offer', sdp: 'v=0' }] },
      { seq: 2, ts: 2, kind: 'event', name: 'track', value: {} }
    ];
    expect(detectRole(events, 0)).toEqual({ role: 'subscriber', offerer: false });
  });
});

describe('quality scores', () => {
  it('audio MOS drops with loss and delay', () => {
    const good = audioMos({ rttMs: 40, jitterBufferMs: 40, lossPct: 0 });
    const bad = audioMos({ rttMs: 600, jitterBufferMs: 200, lossPct: 10 });
    expect(good.score).toBeGreaterThan(4.2);
    expect(bad.score).toBeLessThan(3);
    expect(bad.reasons.length).toBeGreaterThan(0);
  });
  it('video score penalizes low fps and freezes', () => {
    expect(videoScore({ fps: 30, height: 720 }).label).toBe('excellent');
    expect(videoScore({ fps: 6, height: 180, freezesPerMin: 3, lossPct: 8 }).label).toBe('bad');
  });
});

describe('codec negotiation', () => {
  it('reports what the answer dropped and what is used', () => {
    const offer = sdp([[96, 'VP8'], [98, 'VP9'], [100, 'H264'], [97, 'rtx']]);
    const answer = sdp([[98, 'VP9'], [96, 'VP8']]);
    const events: TraceEvent[] = [
      { seq: 1, ts: 1, kind: 'call', name: 'setLocalDescription', result: { localDescription: { type: 'offer', sdp: offer } } },
      { seq: 2, ts: 2, kind: 'call', name: 'setRemoteDescription', result: { remoteDescription: { type: 'answer', sdp: answer } } }
    ];
    const stats = new StatsTimeline();
    stats.current.set('OT', { id: 'OT', type: 'outbound-rtp', mid: '0', codecId: 'C98' });
    stats.current.set('C98', { id: 'C98', type: 'codec', mimeType: 'video/VP9' });
    const [n] = explainNegotiation(events, stats);
    expect(n.offered).toEqual(['VP8', 'VP9', 'H264']);
    expect(n.answered).toEqual(['VP9', 'VP8']);
    expect(n.removed).toEqual(['H264']);
    expect(n.sending).toBe('VP9');
  });
});

describe('TURN tester helpers', () => {
  it('groups URLs and attaches credentials only to TURN', () => {
    expect(serversFromInput('stun:a:3478\nturn:b:3478, turns:c:443\nnope', 'u', 'p')).toEqual([
      { urls: ['stun:a:3478'] },
      { urls: ['turn:b:3478', 'turns:c:443'], username: 'u', credential: 'p' }
    ]);
  });
  it('explains auth failures', () => {
    const v = verdict([{ urls: ['turn:b:3478'], username: 'u', credential: 'p' }], {
      candidates: [],
      errors: [{ url: 'turn:b:3478', errorCode: 401, errorText: 'Unauthorized', ms: 10 }]
    });
    expect(v[0]).toMatchObject({ ok: false });
    expect(v[0].text).toMatch(/credentials/);
  });
});
