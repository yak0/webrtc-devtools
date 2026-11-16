import type { StatsDelta } from '../shared/protocol';

type StatsObject = Record<string, unknown>;

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/**
 * Sends only what changed between two consecutive getStats() reports.
 * Static objects (codecs, certificates, candidates) are sent once; for RTP
 * streams usually only counters change. `timestamp` is not part of the diff,
 * the panel uses the report-level `ts`.
 */
export class StatsDiffer {
  private prev = new Map<string, StatsObject>();

  reset(): void {
    this.prev.clear();
  }

  diff(report: Record<string, StatsObject>, ts: number): StatsDelta {
    const full = this.prev.size === 0;
    const changed: Record<string, StatsObject> = {};
    const seen = new Set<string>();

    for (const id of Object.keys(report)) {
      seen.add(id);
      const obj = report[id];
      const prev = this.prev.get(id);
      if (!prev) {
        changed[id] = { ...obj };
      } else {
        let delta: StatsObject | null = null;
        for (const key of Object.keys(obj)) {
          if (key === 'timestamp') continue;
          if (!same(obj[key], prev[key])) (delta ??= {})[key] = obj[key];
        }
        if (delta) changed[id] = delta;
      }
      this.prev.set(id, obj);
    }

    const removed: string[] = [];
    for (const id of this.prev.keys()) {
      if (!seen.has(id)) {
        removed.push(id);
        this.prev.delete(id);
      }
    }
    return { ts, full, changed, removed };
  }
}

/** Applies a delta produced by StatsDiffer onto a map of current stats objects. */
export function applyStatsDelta(current: Map<string, StatsObject>, delta: StatsDelta): void {
  if (delta.full) current.clear();
  for (const id of delta.removed) current.delete(id);
  for (const [id, patch] of Object.entries(delta.changed)) {
    const prev = current.get(id);
    current.set(id, prev ? { ...prev, ...patch } : { ...patch });
  }
}
