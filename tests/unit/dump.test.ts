import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportSession, importDump } from '@/panel/lib/dump';
import { candidates } from '@/panel/lib/ice';
import { sdpHistory } from '@/panel/lib/sdp-history';
import { computeInsights } from '@/panel/lib/insights';

const internals = JSON.parse(readFileSync(new URL('../fixtures/webrtc-internals-dump.json', import.meta.url), 'utf8'));

describe('chrome://webrtc-internals import', () => {
  const result = importDump(internals);

  it('creates one model per peer connection', () => {
    expect(result.kind).toBe('webrtc-internals');
    expect(result.pcs).toHaveLength(2);
    const [a] = result.pcs;
    expect((a.info.config as any).iceServers[0].urls).toEqual(['stun:127.0.0.1:3478']);
    expect(a.states.connectionState).toBe('connected');
    expect(a.states.signalingState).toBe('stable');
  });

  it('turns OnSuccess entries into call results', () => {
    const a = result.pcs[0];
    const offer = a.events.find((e) => e.name === 'createOffer')!;
    expect(offer.kind).toBe('call');
    expect((offer.result as any).type).toBe('offer');
    expect(offer.pending).toBe(false);
    const history = sdpHistory(a.events);
    expect(history.filter((h) => h.applied).map((h) => h.side)).toEqual(['local', 'remote']);
  });

  it('rebuilds stats series and candidates', () => {
    const a = result.pcs[0];
    expect(a.stats.times.length).toBeGreaterThan(1);
    const out = a.stats.byType('outbound-rtp');
    expect(out.length).toBeGreaterThan(0);
    const video = out.find((o) => o.kind === 'video')!;
    expect(a.stats.get(String(video.id), 'bytesSent').some((v) => typeof v === 'number')).toBe(true);
    expect(candidates(a.stats, a.events).some((c) => c.side === 'local')).toBe(true);
    expect(() => computeInsights(a)).not.toThrow();
  });

  it('reads getUserMedia requests', () => {
    expect(result.media).toHaveLength(1);
    expect(result.media[0].result?.tracks?.map((t) => t.kind)).toEqual(['audio', 'video']);
  });

  it('round-trips through our own export format', () => {
    const exported = JSON.parse(JSON.stringify(exportSession(result.pcs, result.media, [], 'https://x', 'ua')));
    const again = importDump(exported);
    expect(again.kind).toBe('devtools');
    expect(again.pcs[0].events.length).toBe(result.pcs[0].events.length);
    expect(again.pcs[0].stats.times).toEqual(result.pcs[0].stats.times);
  });

  it('rejects unknown files', () => {
    expect(() => importDump({ foo: 1 })).toThrow(/Unrecognized/);
  });
});
