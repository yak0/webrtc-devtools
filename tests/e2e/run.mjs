// End-to-end test of the real extension in Chromium:
//   1. loads dist/ as an unpacked extension,
//   2. opens a test page that runs a loopback WebRTC call,
//   3. opens the panel UI (panel.html?tabId=…, same code as the DevTools panel),
//   4. asserts the page behaves normally and the panel shows live data.
// Browser: $WRD_CHROME (path to Chrome for Testing / Chromium) or Playwright's bundled Chromium.
import { chromium } from 'playwright';
import { chromeLaunchOptions } from '../../scripts/find-chrome.mjs';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const dist = join(root, 'dist');
const shots = join(root, 'test-results');
mkdirSync(shots, { recursive: true });
const PAGE = 'https://webrtc-e2e.test/';
let failures = 0;

function check(name, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${!ok && detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wrd-e2e-')), {
  ...chromeLaunchOptions(),
  headless: true,
  viewport: { width: 1280, height: 860 },
  acceptDownloads: true,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    // Headless Chromium cannot resolve mDNS (.local) host candidates; use plain IPs for the loopback call.
    '--disable-features=WebRtcHideLocalIpsWithMdns'
  ]
});

try {
  await context.route(`${PAGE}**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: readFileSync(join(root, 'tests/e2e/test-page.html'), 'utf8') })
  );

  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  check('extension service worker started', !!extensionId);

  const before = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__results?.done || window.__results?.errors.length, null, { timeout: 15_000 });
  const results = await page.evaluate(() => window.__results);
  const tabId = (await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id))).find((id) => !before.includes(id));

  check('test page ran without errors', results.errors.length === 0 && pageErrors.length === 0, [...results.errors, ...pageErrors].join('\n'));
  check('RTCPeerConnection.name is preserved', results.name === 'RTCPeerConnection', results.name);
  check('wrapped methods still look native', results.nativeToString === true);
  check('static generateCertificate still available', results.hasGenerateCertificate === true);
  check('subclassing RTCPeerConnection works', results.subclassWorks === true);
  check('constructor identity preserved', results.constructorIdentity === true);
  check('instanceof works', results.instanceOf === true);
  check('rejected promises reach the app', results.rejectionPropagates === true);
  check('synchronous exceptions reach the app', results.syncThrowPropagates === true);
  check('getUserMedia still works', results.gumTracks === 2, String(results.gumTracks));

  const badgeText = () => worker.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), tabId);
  await page.waitForTimeout(1000);
  check('badge shows open connections without DevTools', (await badgeText()) === '4', await badgeText());

  // ---- toolbar popup (opened directly with ?tabId= since tests cannot click the toolbar) ----
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 300, height: 420 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}`);
  await popup.getByText('RTCPeerConnections on this page').waitFor({ timeout: 5000 }).catch(() => {});
  const popupText = await popup.locator('body').innerText();
  check('popup lists the connections', /4 RTCPeerConnections on this page/.test(popupText) && /PC 3\s+connected/.test(popupText), popupText);
  check('popup explains how to open the WebRTC tab', /Open DevTools/.test(popupText) && /WebRTC/.test(popupText));
  await popup.screenshot({ path: join(shots, 'popup.png') });
  await popup.close();

  // ---- device & network test page (fake camera/mic from Chromium flags) ----
  const tools = await context.newPage();
  const toolErrors = [];
  tools.on('pageerror', (e) => toolErrors.push(String(e)));
  const toolsUrl = (hash) => `chrome-extension://${extensionId}/tools/tools.html#${hash}`;
  const mainText = () => tools.locator('main').innerText();

  await tools.goto(toolsUrl('devices'));
  await tools.getByText('Allow access to see device names').click({ timeout: 3000 }).catch(() => {});
  await tools.waitForTimeout(800);
  check('tools: devices are listed with names', /fake/i.test(await mainText()), (await mainText()).slice(0, 300));

  await tools.goto(toolsUrl('camera'));
  await tools.getByText('Start camera').click();
  await tools.waitForTimeout(3000);
  const cam = await mainText();
  const fpsRendered = Number(/(\d+) fps rendered/.exec(cam)?.[1] ?? 0);
  check('tools: camera preview renders frames', fpsRendered > 0, cam.slice(0, 400));
  check('tools: camera reports its resolution', /\d+×\d+/.test(cam));
  await tools.screenshot({ path: join(shots, 'tools-camera.png') });

  await tools.goto(toolsUrl('microphone'));
  await tools.getByText('Start microphone').click();
  await tools.waitForTimeout(1500);
  const mic = await mainText();
  check('tools: microphone level is measured', /Peak hold -?\d+\.\d dB/.test(mic), mic.slice(0, 400));
  await tools.screenshot({ path: join(shots, 'tools-mic.png') });

  await tools.goto(toolsUrl('speakers'));
  await tools.getByText('Both', { exact: true }).click();
  await tools.waitForTimeout(600);
  check('tools: speaker test plays without error', !/Error:/.test(await mainText()));

  await tools.goto(toolsUrl('loopback'));
  await tools.getByText('Run test').click();
  await tools.waitForTimeout(6000);
  await tools.getByText('Stop', { exact: true }).click();
  await tools.waitForTimeout(1500);
  const loop = await mainText();
  check('tools: call quality test reports encoder and bitrate', /Encoder\s+\S+/.test(loop) && /kbps/.test(loop) && /[✓✕]/.test(loop), loop.slice(0, 600));
  await tools.screenshot({ path: join(shots, 'tools-loopback.png') });
  check('tools: no runtime errors', toolErrors.length === 0, toolErrors.join('\n'));
  await tools.close();

  let panel = await context.newPage();
  const panelErrors = [];
  panel.on('pageerror', (e) => panelErrors.push(String(e.stack || e)));
  panel.on('console', (m) => m.type() === 'error' && panelErrors.push(m.text()));
  await panel.goto(`chrome-extension://${extensionId}/panel/panel.html?tabId=${tabId}`);
  await panel.getByText('PC 4', { exact: false }).first().waitFor({ timeout: 10_000 });
  const sidebar = await panel.locator('aside.sidebar').innerText();
  check('panel lists all 4 peer connections', /PC 1[\s\S]*PC 2[\s\S]*PC 3[\s\S]*PC 4/.test(sidebar), sidebar);

  // PC 2 has the TURN configuration: credentials must never reach the panel.
  await panel.locator('aside.sidebar .item', { hasText: 'PC 2' }).click();
  await panel.getByText('Raw configuration').click();
  const turnView = await panel.locator('main').innerText();
  check('TURN server is shown', turnView.includes('turn:127.0.0.1:9'));
  check('TURN credential is masked', !turnView.includes('topsecret') && turnView.includes('***'));

  // PC 3 is the caller with video + data channel.
  await panel.locator('aside.sidebar .item', { hasText: 'PC 3' }).click();
  await panel.waitForTimeout(3500); // let a few stats reports arrive
  const overview = await panel.locator('main').innerText();
  check('connection reaches connected', /connected/.test(overview));
  await panel.screenshot({ path: join(shots, 'overview.png') });

  await panel.getByText('Timeline', { exact: false }).first().click();
  await panel.locator('main').getByText('setLocalDescription').first().waitFor({ timeout: 5000 }).catch(() => {});
  const timeline = await panel.locator('main').innerText();
  check('timeline shows API calls', /setLocalDescription/.test(timeline) && /createDataChannel/.test(timeline), timeline.slice(0, 600));
  check('failed sync call recorded', /TypeError|createDataChannel/.test(timeline));
  await panel.screenshot({ path: join(shots, 'timeline.png') });

  await panel.getByText('SDP', { exact: true }).first().click();
  await panel.locator('main').getByText('m=video').first().waitFor({ timeout: 5000 }).catch(() => {});
  const sdp = await panel.locator('main').innerText();
  check('SDP tab parses m-sections', /m=video/.test(sdp) && /m=application/.test(sdp));

  await panel.getByText('Media', { exact: true }).first().click();
  await panel.waitForTimeout(1500);
  const media = await panel.locator('main').innerText();
  check('media tab shows outgoing video with bitrate', /video ↑/.test(media) && /(kbps|Mbps)/.test(media), media.slice(0, 300));
  await panel.screenshot({ path: join(shots, 'media.png') });

  await panel.getByText('Data channels', { exact: false }).first().click();
  await panel.waitForTimeout(800);
  const dc = await panel.locator('main').innerText();
  check('data channel messages are captured', /ping/.test(dc) && /chat/.test(dc));
  await panel.screenshot({ path: join(shots, 'datachannels.png') });

  await panel.locator('aside.sidebar .item', { hasText: 'Media devices' }).click();
  const devices = await panel.locator('main').innerText();
  check('getUserMedia call is listed with tracks', /getUserMedia/.test(devices) && /audio:/.test(devices) && /video:/.test(devices), devices.slice(0, 300));

  // Reload the page: a fresh document must re-attach to the open panel.
  await page.reload();
  await page.waitForFunction(() => window.__results?.done, null, { timeout: 15_000 });
  await panel.waitForTimeout(1500);
  const afterReload = await panel.locator('aside.sidebar').innerText();
  check('panel has no runtime errors', panelErrors.length === 0, panelErrors.join('\n').slice(0, 1500));
  // Like DevTools without "Preserve log": the previous document's connections are cleared.
  check('panel shows the new document\'s connections after reload', (afterReload.match(/PC \d/g) ?? []).length === 4, afterReload);
  check('SDK is detected from page globals', /LiveKit/.test(afterReload), afterReload);

  // ---- toolbar badge: connection count of the current document, red because of the bad SDP ----
  await panel.waitForTimeout(2500);
  check('badge count resets on reload (4, not 8)', (await badgeText()) === '4', await badgeText());
  const color = await worker.evaluate((id) => chrome.action.getBadgeBackgroundColor({ tabId: id }), tabId);
  check('badge turns red when the panel finds errors', color[0] === 208 && color[1] === 48, JSON.stringify(color));

  // ---- Controls: store as global variable ----
  await panel.locator('aside.sidebar .item', { hasText: 'PC 3' }).last().click();
  await panel.getByText('Controls', { exact: true }).click();
  await panel.getByText('Store as').click();
  await panel.waitForTimeout(600);
  const exposed = await page.evaluate(() => window.$pc3 instanceof RTCPeerConnection);
  check('"Store as $pc3" exposes the connection in the page', exposed === true);

  // ---- Chaos mode: blocked candidates never reach the app ----
  const gather = () =>
    page.evaluate(async () => {
      const pc = new RTCPeerConnection();
      let seen = 0;
      pc.onicecandidate = (e) => e.candidate && seen++;
      pc.createDataChannel('x');
      await pc.setLocalDescription(await pc.createOffer());
      await new Promise((r) => setTimeout(r, 1500));
      pc.close();
      return seen;
    });
  await panel.locator('aside.sidebar .item', { hasText: 'Tools' }).click();
  await panel.getByText('host', { exact: true }).first().click();
  await panel.waitForTimeout(400);
  check('chaos banner is shown', /Chaos mode active/.test(await panel.locator('aside.sidebar').innerText()));
  const blocked = await gather();
  check('chaos mode hides blocked host candidates from the app', blocked === 0, `app saw ${blocked}`);
  await panel.getByText('Turn everything off').click();
  await panel.waitForTimeout(400);
  const unblocked = await gather();
  check('turning chaos off restores candidates', unblocked > 0, `app saw ${unblocked}`);

  // Chaos must end when the last panel closes (regression: it used to stay active in the page).
  await panel.getByText('host', { exact: true }).first().click();
  await panel.waitForTimeout(400);
  const chaosPanel = panel;
  const reopen = async () => {
    const p = await context.newPage();
    await p.goto(`chrome-extension://${extensionId}/panel/panel.html?tabId=${tabId}`);
    await p.getByText('PC 4', { exact: false }).first().waitFor({ timeout: 10_000 });
    return p;
  };
  const keepAlive = await context.newPage(); // keeps the context busy while the panel is closed
  await chaosPanel.close();
  await page.waitForTimeout(800);
  const afterClose = await gather();
  check('chaos mode ends when the panel closes', afterClose > 0, `app saw ${afterClose}`);
  panel = await reopen();
  await keepAlive.close();

  // Badge survives same-document navigation (single-page apps).
  await page.waitForTimeout(1000); // let the count of the temporary connections above settle
  const beforePush = await badgeText();
  await page.evaluate(() => history.pushState({}, '', '/spa-route'));
  await page.waitForTimeout(1500);
  check('badge survives history.pushState', (await badgeText()) === beforePush && beforePush !== '', `${beforePush} -> ${await badgeText()}`);

  // A hostile page cannot inject HTML into the popup.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent('__webrtc_devtools_page__', {
        detail: JSON.stringify({ activity: true, pcSummary: [{ index: 7, state: '<b id=evil>x</b>' }, { index: '<a id=evil2>y</a>', state: 'connected' }] })
      })
    )
  );
  await page.waitForTimeout(900);
  const evilPopup = await context.newPage();
  await evilPopup.goto(`chrome-extension://${extensionId}/popup/popup.html?tabId=${tabId}`);
  await evilPopup.waitForTimeout(600);
  const injected = await evilPopup.evaluate(() => document.querySelectorAll('#evil, #evil2').length);
  check('popup does not render HTML from the page', injected === 0 && /PC 7\s+unknown/.test(await evilPopup.locator('body').innerText()));
  await evilPopup.close();

  // ---- HTML report: downloads and opens without the extension ----
  const [download] = await Promise.all([
    panel.waitForEvent('download', { timeout: 10_000 }),
    (async () => {
      await panel.locator('button[title="Export"]').click();
      await panel.getByText('HTML report').click();
    })()
  ]);
  const reportFile = join(shots, 'report.html');
  await download.saveAs(reportFile);
  const report = await context.newPage();
  await report.goto(`file://${reportFile}`);
  await report.getByText('PC 3').first().waitFor({ timeout: 10_000 });
  const reportText = await report.locator('body').innerText();
  check('HTML report renders the session offline', /Report/.test(reportText) && /PC 4/.test(reportText));
  check('HTML report keeps SDK detection', /LiveKit/.test(reportText));
  await report.locator('aside.sidebar .item', { hasText: 'PC 3' }).last().click();
  await report.getByText('Media', { exact: true }).first().click();
  await report.waitForTimeout(500);
  check('HTML report keeps stats', /video ↑/.test(await report.locator('main').innerText()));
  await report.screenshot({ path: join(shots, 'report.png') });
  await report.close();

  // ---- Record from page load: stats exist before the panel is opened ----
  await worker.evaluate((origin) => chrome.storage.local.set({ recordOrigins: [origin] }), new URL(PAGE).origin);
  await panel.close();
  await page.reload();
  await page.waitForFunction(() => window.__results?.done, null, { timeout: 15_000 });
  await page.waitForTimeout(4000);
  const panel2 = await context.newPage();
  await panel2.goto(`chrome-extension://${extensionId}/panel/panel.html?tabId=${tabId}`);
  await panel2.getByText('PC 4', { exact: false }).first().waitFor({ timeout: 10_000 });
  await panel2.locator('aside.sidebar .item', { hasText: 'PC 3' }).last().click();
  await panel2.getByText('Overview', { exact: true }).click();
  await panel2.waitForTimeout(400);
  const recorded = await panel2.locator('main').innerText();
  check('stats recorded before DevTools was opened are replayed', !/Waiting for stats/.test(recorded) && /Traffic/.test(recorded));
  await panel2.screenshot({ path: join(shots, 'recorded.png') });

  // ---- side panel width ----
  await panel2.setViewportSize({ width: 380, height: 760 });
  await panel2.waitForTimeout(300);
  const narrowOverflow = await panel2.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check('panel fits a side-panel width without horizontal page scroll', narrowOverflow <= 0, String(narrowOverflow));
  await panel2.screenshot({ path: join(shots, 'sidepanel.png') });
} finally {
  await context.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll e2e checks passed');
console.log(`Screenshots: ${shots}`);
process.exit(failures ? 1 : 0);
