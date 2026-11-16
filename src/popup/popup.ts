// Toolbar popup: what the extension sees on this tab + how to open the DevTools panel.
// (Extensions cannot open DevTools themselves, so we explain the shortcut instead.)
import type { PopupInfo, PopupInfoRequest } from '../shared/protocol';

const $ = (id: string) => document.getElementById(id)!;

const isMac = /Mac|iPhone|iPad/i.test((navigator as any).userAgentData?.platform ?? navigator.platform);
const kbd = (keys: string[]) => keys.map((k) => `<kbd>${k}</kbd>`).join(isMac ? '' : '+');

function tone(state: string): string {
  if (state === 'connected') return 'success';
  if (state === 'connecting' || state === 'new') return 'info';
  if (state === 'failed') return 'error';
  if (state === 'disconnected') return 'warning';
  return '';
}

function renderSteps(panelOpen: boolean) {
  const open = isMac ? kbd(['⌥', '⌘', 'I']) : `${kbd(['F12'])} or ${kbd(['Ctrl', 'Shift', 'I'])}`;
  const steps = panelOpen
    ? ['DevTools is already open for this tab: switch to the <span class="tab">WebRTC</span> tab.']
    : [
        `Open DevTools: ${open}<br><span class="muted">or right-click the page → Inspect</span>`,
        'Select the <span class="tab">WebRTC</span> tab.<br><span class="muted">Not visible? It is behind the <b>»</b> menu next to the other tabs.</span>'
      ];
  $('steps').innerHTML = steps.map((s) => `<li>${s}</li>`).join('');
  $('tip').innerHTML = 'Tip: DevTools reopens on the last tab you used, so leave it on WebRTC and next time one shortcut is enough.';
}

async function main() {
  // ?tabId= is used by tests; normally the popup describes the active tab.
  const fromQuery = Number(new URLSearchParams(location.search).get('tabId'));
  const tabId = fromQuery || (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId === undefined) return;
  const info = (await chrome.runtime.sendMessage({ type: 'wrd:popup-info', tabId } satisfies PopupInfoRequest)) as PopupInfo | undefined;
  const pcs = (info?.frames ?? []).flatMap((f) => f.pcs.map((pc) => ({ ...pc, frameId: f.frameId })));
  const multiFrame = new Set(pcs.map((p) => p.frameId)).size > 1;

  // Connection data originates in the web page: build the DOM with textContent only.
  const el = (tag: string, cls: string, text = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const status = $('status');
  status.replaceChildren();
  if (!pcs.length) {
    status.append(
      el('div', 'summary', 'No RTCPeerConnection on this page'),
      el(
        'div',
        'muted',
        'Connections are detected as soon as the page creates them. If it created them before the extension was installed, reload the page.'
      )
    );
  } else {
    const n = pcs.length;
    status.append(el('div', 'summary', `${n} RTCPeerConnection${n > 1 ? 's' : ''} on this page`));
    const list = el('ul', 'pcs');
    for (const p of pcs.sort((a, b) => a.frameId - b.frameId || a.index - b.index)) {
      const li = el('li', '');
      li.append(
        el('span', `dot ${tone(p.state)}`),
        document.createTextNode(`PC ${Number(p.index)} `),
        el('span', 'muted', `${p.state}${multiFrame && p.frameId ? ' · iframe' : ''}`)
      );
      list.append(li);
    }
    status.append(list);
    if (info?.level === 'error') status.append(el('div', 'health error', 'Problems found: see the Overview of each connection.'));
    else if (info?.level === 'warning') status.append(el('div', 'health warning', 'Warnings found: see the Overview of each connection.'));
  }
  renderSteps(!!info?.panelOpen);
}

// Device / network tests open in a new tab (extension page).
document.querySelectorAll<HTMLAnchorElement>('a[data-tool]').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: chrome.runtime.getURL(`tools/tools.html#${a.dataset.tool}`) });
    window.close();
  });
});

renderSteps(false);
void main();
