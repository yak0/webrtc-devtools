import { describe, expect, it } from 'vitest';
import { StatsDiffer, applyStatsDelta } from '@/injected/stats-differ';
import { StatsTimeline } from '@/panel/lib/stats-timeline';

const rtp = (bytes: number, lost: number, recv: number) => ({
  id: 'IT1',
  type: 'inbound-rtp',
  kind: 'video',
  timestamp: 0,
  bytesReceived: bytes,
  packetsLost: lost,
  packetsReceived: recv,
  framesPerSecond: 30,
  codecId: 'C1'
});
const codec = { id: 'C1', type: 'codec', mimeType: 'video/VP8', timestamp: 0 };

describe('StatsDiffer', () => {
  it('sends full objects first and only changed fields afterwards', () => {
    const d = new StatsDiffer();
    const first = d.diff({ IT1: rtp(100, 0, 10), C1: codec }, 1000);
    expect(first.full).toBe(true);
    expect(Object.keys(first.changed)).toEqual(['IT1', 'C1']);

    const second = d.diff({ IT1: { ...rtp(200, 0, 20), timestamp: 5 }, C1: { ...codec, timestamp: 5 } }, 2000);
    expect(second.full).toBe(false);
    expect(second.changed).toEqual({ IT1: { bytesReceived: 200, packetsReceived: 20 } });

    const third = d.diff({ IT1: rtp(200, 0, 20) }, 3000);
    expect(third.removed).toEqual(['C1']);

    const current = new Map();
    applyStatsDelta(current, first);
    applyStatsDelta(current, second);
    applyStatsDelta(current, third);
    expect(current.get('IT1').bytesReceived).toBe(200);
    expect(current.has('C1')).toBe(false);
  });
});

describe('StatsTimeline', () => {
  it('derives bitrate and packet loss and keeps series aligned', () => {
    const d = new StatsDiffer();
    const t = new StatsTimeline();
    t.apply(d.diff({ IT1: rtp(0, 0, 0), C1: codec }, 1000));
    t.apply(d.diff({ IT1: rtp(125_000, 0, 100) }, 2000));
    t.apply(d.diff({ IT1: rtp(250_000, 10, 190) }, 3000));

    expect(t.times).toEqual([1000, 2000, 3000]);
    expect(t.get('IT1', 'bytesReceived')).toEqual([0, 125_000, 250_000]);
    expect(t.get('IT1', '[bytesReceived_in_bits/s]')).toEqual([null, 1_000_000, 1_000_000]);
    expect(t.latest('IT1', '[packetLoss%]')).toBeCloseTo(10);
    expect(t.series.has('C1')).toBe(false); // static type
    expect(t.fields('IT1')[0]).not.toMatch(/^\[/); // raw fields first
  });

  it('trims old points', () => {
    const d = new StatsDiffer();
    const t = new StatsTimeline(10);
    for (let i = 0; i < 30; i++) t.apply(d.diff({ IT1: rtp(i * 1000, 0, i) }, i * 1000));
    expect(t.times.length).toBeLessThanOrEqual(11);
    expect(t.get('IT1', 'bytesReceived').length).toBe(t.times.length);
    expect(t.latest('IT1', 'bytesReceived')).toBe(29_000);
  });

  it('round-trips through JSON', () => {
    const d = new StatsDiffer();
    const t = new StatsTimeline();
    t.apply(d.diff({ IT1: rtp(0, 0, 0) }, 1000));
    t.apply(d.diff({ IT1: rtp(1000, 0, 5) }, 2000));
    const copy = StatsTimeline.from(JSON.parse(JSON.stringify(t)));
    expect(copy.get('IT1', 'bytesReceived')).toEqual([0, 1000]);
  });
});
