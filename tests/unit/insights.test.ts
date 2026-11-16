import { describe, expect, it } from 'vitest';
import type { TraceEvent } from '@/shared/protocol';
import { createPcModel } from '@/panel/store/session';
import { computeInsights } from '@/panel/lib/insights';

function pcWith(events: TraceEvent[], urls: string[]) {
  const pc = createPcModel({ id: 'x', index: 1, createdAt: 0, url: '', config: { iceServers: [{ urls }] }, effectiveConfig: undefined });
  pc.events = events;
  pc.states = { connectionState: 'connected', iceConnectionState: 'connected', iceGatheringState: 'complete', signalingState: 'stable' };
  return pc;
}
const err = (seq: number, url: string, errorCode: number, errorText: string): TraceEvent => ({
  seq,
  ts: seq,
  kind: 'event',
  name: 'icecandidateerror',
  value: { url, errorCode, errorText }
});

describe('ICE error grouping', () => {
  const urls = ['turn:t.example:3478?transport=udp', 'turns:t.example:443?transport=tcp', 'stun:t.example:3478'];
  const events = [
    err(1, urls[0], 701, 'TURN allocate request timed out.'),
    err(2, urls[0], 701, 'Address not associated with the desired network interface.'),
    err(3, urls[1], 701, 'Address not associated with the desired network interface.'),
    err(4, urls[2], 701, 'STUN binding request timed out.'),
    err(5, urls[2], 701, 'STUN binding request timed out.')
  ];

  it('collapses per-interface errors into one TURN warning and one STUN info', () => {
    const list = computeInsights(pcWith(events, urls));
    const ice = list.filter((i) => /TURN|STUN|ICE server/.test(i.title));
    expect(ice.map((i) => [i.id, i.level, i.items?.length])).toEqual([
      ['turn-no-relay', 'warning', 2],
      ['stun-errors', 'info', 1]
    ]);
    // The interface noise is hidden when a real reason exists.
    expect(ice[0].items![0]).toMatch(/allocate request timed out/);
    expect(ice[0].items![0]).not.toMatch(/not associated/);
    expect(ice[0].detail).toMatch(/connected without TURN/);
  });

  it('ignores errors of a server that produced candidates on another interface', () => {
    const pc = pcWith(events, urls);
    pc.stats.current.set('L1', { id: 'L1', type: 'local-candidate', candidateType: 'srflx', url: urls[2] });
    const list = computeInsights(pc);
    expect(list.some((i) => i.id === 'stun-errors')).toBe(false);
  });
});
