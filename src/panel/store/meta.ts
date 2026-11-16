import { detectRole, detectSdk, type PcRole, type SdkGuess } from '../lib/sdk';
import { session, type PcModel } from './session';

export interface PcMeta {
  sdk: SdkGuess | null;
  role: PcRole;
  offerer: boolean | null;
}

const cache = new WeakMap<PcModel, { key: string; meta: PcMeta }>();

/** SDK + role of a connection, recomputed only when its trace/data channels/env change. */
export function metaOf(pc: PcModel): PcMeta {
  const env = session.envByFrame[pc.frameId];
  const key = `${pc.rev}:${pc.dcRev}:${env ? JSON.stringify(env) : ''}`;
  const hit = cache.get(pc);
  if (hit && hit.key === key) return hit.meta;
  const { role, offerer } = detectRole(pc.events, pc.dataChannels.size);
  const meta: PcMeta = {
    sdk: detectSdk({
      stack: pc.info.stack,
      config: pc.info.effectiveConfig ?? pc.info.config,
      events: pc.events,
      dataChannelLabels: [...pc.dataChannels.values()].map((d) => d.label),
      pageUrl: pc.frameUrl || pc.info.url,
      env
    }),
    role,
    offerer
  };
  cache.set(pc, { key, meta });
  return meta;
}
