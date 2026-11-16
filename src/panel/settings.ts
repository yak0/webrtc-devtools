import { reactive, watch } from 'vue';
import { DEFAULT_SETTINGS, NO_CHAOS, type ChaosSettings, type CollectorSettings } from '@/shared/protocol';

const KEY = 'webrtc-devtools.settings';

export interface PanelSettings extends Omit<CollectorSettings, 'chaos'> {
  preserveLog: boolean;
}

function load(): PanelSettings {
  const { chaos: _ignored, ...base } = DEFAULT_SETTINGS;
  const defaults: PanelSettings = { ...base, preserveLog: false } as PanelSettings;
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    return defaults;
  }
}

export const settings = reactive<PanelSettings>(load());

watch(settings, () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
});

/** Fault injection settings. Deliberately not persisted: chaos must never survive a panel reload by surprise. */
export const chaos = reactive<ChaosSettings>({ ...NO_CHAOS, blockCandidateTypes: [], blockProtocols: [] });

export function collectorSettings(): CollectorSettings {
  return {
    statsInterval: settings.statsInterval,
    captureDataChannelMessages: settings.captureDataChannelMessages,
    captureStacks: settings.captureStacks,
    chaos: { ...chaos, blockCandidateTypes: [...chaos.blockCandidateTypes], blockProtocols: [...chaos.blockProtocols] }
  };
}
