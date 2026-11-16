import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/** MV3 manifest. Kept minimal on purpose: no extra permissions besides content scripts. */
export function createManifest() {
  const matches = ['<all_urls>'];
  return {
    manifest_version: 3,
    name: pkg.displayName,
    version: pkg.version,
    description: pkg.description,
    minimum_chrome_version: '111',
    icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
    devtools_page: 'devtools/devtools.html',
    // Toolbar badge shows problems found in the inspected tab while DevTools is open.
    action: { default_title: 'WebRTC DevTools', default_popup: 'popup/popup.html', default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' } },
    // storage: per-origin "record from page load" opt-in + badge state. No install warning.
    permissions: ['storage'],
    background: { service_worker: 'background.js', type: 'module' },
    content_scripts: [
      {
        // Runs in the page's JS world before any page script, so we see every RTCPeerConnection.
        matches,
        js: ['injected.js'],
        run_at: 'document_start',
        world: 'MAIN',
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true
      },
      {
        // Isolated-world relay between the page and the extension.
        matches,
        js: ['content.js'],
        run_at: 'document_start',
        all_frames: true,
        match_about_blank: true,
        match_origin_as_fallback: true
      }
    ]
  };
}
