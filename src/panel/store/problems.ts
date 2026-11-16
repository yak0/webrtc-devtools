import type { Bridge } from '../bridge';
import { computeInsights } from '../lib/insights';
import { session } from './session';

/**
 * Periodically counts error/warning insights per connection for the sidebar,
 * and sends the tab's overall health to the background, which colors the toolbar badge
 * (the badge number itself is the count of open connections).
 */
export function startProblemWatcher(bridge: Bridge): () => void {
  const tick = () => {
    const problems: Record<string, { errors: number; warnings: number }> = {};
    let errors = 0;
    let warnings = 0;
    for (const pc of session.pcs) {
      if (pc.stale) continue;
      const list = computeInsights(pc);
      const e = list.filter((i) => i.level === 'error').length;
      const w = list.filter((i) => i.level === 'warning').length;
      if (e || w) problems[pc.id] = { errors: e, warnings: w };
      if (!pc.imported) {
        errors += e;
        warnings += w;
      }
    }
    if (JSON.stringify(problems) !== JSON.stringify(session.problems)) session.problems = problems;
    // Sent every tick on purpose: the background forgets the level on navigation or restart.
    bridge.send({ type: 'badge', level: errors ? 'error' : warnings ? 'warning' : 'ok' });
  };
  tick();
  const timer = setInterval(tick, 2000);
  return () => clearInterval(timer);
}
