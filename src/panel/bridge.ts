import {
  CONTENT_EVENT,
  PAGE_EVENT,
  PANEL_PORT_PREFIX,
  type BackgroundToPanel,
  type CollectorSettings,
  type ContentEnvelope,
  type PageEnvelope,
  type PanelToBackground
} from '@/shared/protocol';

export interface Bridge {
  readonly kind: 'chrome' | 'local' | 'report';
  connect(onMessage: (msg: BackgroundToPanel) => void, onStatus: (connected: boolean) => void): void;
  send(msg: PanelToBackground): void;
  onNavigated(cb: (url: string) => void): void;
  theme(): 'dark' | 'light';
  /** Reloads the inspected page (used by the empty state). */
  reloadPage(): void;
}

/** Real extension: long-lived port to the background service worker, reconnecting if it restarts. */
export class ChromeBridge implements Bridge {
  readonly kind = 'chrome';
  private port: chrome.runtime.Port | null = null;
  private retry = 0;
  /** Inspected tab. Outside DevTools (pop-out window, e2e tests) it comes from `?tabId=`. */
  private readonly tabId: number =
    chrome.devtools?.inspectedWindow?.tabId ?? Number(new URLSearchParams(location.search).get('tabId'));

  connect(onMessage: (msg: BackgroundToPanel) => void, onStatus: (connected: boolean) => void) {
    const open = () => {
      try {
        this.port = chrome.runtime.connect({ name: PANEL_PORT_PREFIX + this.tabId });
      } catch {
        onStatus(false);
        return; // extension context invalidated (reloaded); panel must be reopened
      }
      onStatus(true);
      this.retry = 0;
      this.port.onMessage.addListener((m) => onMessage(m as BackgroundToPanel));
      this.port.onDisconnect.addListener(() => {
        this.port = null;
        onStatus(false);
        setTimeout(open, Math.min(2000, 200 * 2 ** this.retry++));
      });
    };
    open();
  }

  send(msg: PanelToBackground) {
    try {
      this.port?.postMessage(msg);
    } catch {
      /* reconnecting */
    }
  }

  onNavigated(cb: (url: string) => void) {
    if (chrome.devtools?.network) {
      chrome.devtools.network.onNavigated.addListener(cb);
      return;
    }
    // Side panel / standalone window: watch the inspected tab directly.
    chrome.tabs?.onUpdated.addListener((tabId, info, tab) => {
      if (tabId === this.tabId && info.status === 'loading') cb(tab.url ?? '');
    });
  }

  theme(): 'dark' | 'light' {
    if (chrome.devtools?.panels) return chrome.devtools.panels.themeName === 'dark' ? 'dark' : 'light';
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  reloadPage() {
    if (chrome.devtools?.inspectedWindow) chrome.devtools.inspectedWindow.reload({});
    else chrome.tabs.reload(this.tabId);
  }
}

/**
 * Playground: the panel lives in the same window as the collector, so we play
 * the content script's role directly with the same CustomEvents.
 */
export class LocalBridge implements Bridge {
  readonly kind = 'local';
  private settings?: CollectorSettings;

  connect(onMessage: (msg: BackgroundToPanel) => void, onStatus: (connected: boolean) => void) {
    window.addEventListener(PAGE_EVENT, (e) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail !== 'string') return;
      const env = JSON.parse(detail) as PageEnvelope;
      if (env.batch) onMessage({ type: 'batch', frameId: 0, frameUrl: location.href, batch: env.batch });
    });
    onStatus(true);
    this.toPage({ cmd: 'attach', settings: this.settings });
  }

  send(msg: PanelToBackground) {
    if (msg.type === 'settings') {
      this.settings = msg.settings;
      this.toPage({ cmd: 'settings', settings: msg.settings });
    } else if (msg.type === 'reattach') {
      this.toPage({ cmd: 'attach', settings: this.settings });
    } else if (msg.type === 'command') {
      this.toPage({ cmd: 'command', command: msg.command, commandId: msg.id });
    }
  }

  onNavigated() {}

  theme(): 'dark' | 'light' {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  reloadPage() {
    location.reload();
  }

  private toPage(msg: ContentEnvelope) {
    window.dispatchEvent(new CustomEvent(CONTENT_EVENT, { detail: JSON.stringify(msg) }));
  }
}

/** Standalone HTML report: data comes from window.__WRD_DUMP__, nothing is live. */
export class ReportBridge implements Bridge {
  readonly kind = 'report';

  connect(_onMessage: (msg: BackgroundToPanel) => void, onStatus: (connected: boolean) => void) {
    onStatus(false);
    const data = (window as any).__WRD_DUMP__;
    if (!data) return;
    // Imported lazily to keep bridge.ts free of store dependencies.
    void Promise.all([import('./lib/dump'), import('./store/session')]).then(([dump, store]) => {
      const r = dump.importDump(data);
      store.loadModels(r.pcs, r.media, r.trackEvents, {
        name: `Report exported ${new Date(data.exportedAt ?? Date.now()).toLocaleString()}`,
        url: r.url,
        userAgent: r.userAgent,
        env: r.env
      });
      document.title = `WebRTC report · ${r.url ?? ''}`;
    });
  }

  send() {}
  onNavigated() {}

  theme(): 'dark' | 'light' {
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  reloadPage() {}
}
