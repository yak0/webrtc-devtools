// Generates Chrome Web Store images into store/:
//   screenshots/*.jpg  1280x800 (real panel, driven by store/demo-page.html)
//   promo/small-440x280.jpg, promo/marquee-1400x560.jpg
// Usage: npm run store:assets   (WRD_CHROME=<Chrome for Testing binary> if Playwright's Chromium is not installed)
import { chromium } from 'playwright';
import { chromeLaunchOptions } from './find-chrome.mjs';
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const out = join(root, 'store');
mkdirSync(join(out, 'screenshots'), { recursive: true });
mkdirSync(join(out, 'promo'), { recursive: true });
const PAGE = 'https://demo-call.example/';
const scheme = process.env.WRD_SCHEME === 'light' ? 'light' : 'dark';

const context = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'wrd-store-')), {
  ...chromeLaunchOptions(),
  headless: true,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: scheme,
  args: [
    `--disable-extensions-except=${dist}`,
    `--load-extension=${dist}`,
    '--autoplay-policy=no-user-gesture-required',
    '--disable-features=WebRtcHideLocalIpsWithMdns'
  ]
});

/** Store images must not show this machine's addresses: swap IPs for documentation ranges right before a shot. */
const scrub = (page) =>
  page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n = 0;
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const next = node.nodeValue.replace(/\b(?!0\.)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g, () => `192.0.2.${10 + (n++ % 5)}`);
      if (next !== node.nodeValue) node.nodeValue = next;
    }
  });

try {
  await context.route(`${PAGE}**`, (r) => r.fulfill({ contentType: 'text/html', body: readFileSync(join(out, 'demo-page.html'), 'utf8') }));
  let [worker] = context.serviceWorkers();
  worker ??= await context.waitForEvent('serviceworker', { timeout: 10_000 });
  const extensionId = new URL(worker.url()).host;
  const before = await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id));
  const page = await context.newPage();
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__ready, null, { timeout: 15_000 });
  const tabId = (await worker.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.id))).find((id) => !before.includes(id));

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/panel/panel.html?tabId=${tabId}`);
  await panel.getByText('PC 2', { exact: false }).first().waitFor({ timeout: 10_000 });
  await panel.locator('aside.sidebar .item', { hasText: 'PC 1' }).click();
  console.log('collecting stats for the charts…');
  await panel.waitForTimeout(28_000);

  const shot = async (name) => {
    await scrub(panel);
    await panel.screenshot({ path: join(out, 'screenshots', `${name}.jpg`), type: 'jpeg', quality: 92 });
    console.log('  screenshots/' + name + '.jpg');
  };
  const tab = (label) => panel.locator('.conn-tabs').getByText(label, { exact: false }).first().click();

  await tab('Overview');
  await panel.waitForTimeout(600);
  await shot('1-overview');

  await tab('Media');
  await panel.getByText('Live video previews').locator('..').locator('.n-switch').click();
  await panel.waitForTimeout(3500);
  await shot('2-media');

  await tab('Timeline');
  await panel.locator('main').getByText('setLocalDescription').first().click();
  await panel.waitForTimeout(500);
  await shot('3-timeline');

  await tab('SDP');
  await panel.locator('main').getByText('m=video').first().waitFor({ timeout: 5000 });
  await shot('4-sdp');

  await tab('Data channels');
  await panel.waitForTimeout(800);
  await panel.locator('main .n-data-table-tr', { hasText: 'alice' }).first().click().catch(() => {});
  await panel.waitForTimeout(300);
  await shot('5-data-channels');

  // ---- promo tiles ----
  const b64 = (file) => readFileSync(file).toString('base64');
  const icon = `data:image/png;base64,${b64(join(root, 'public/icons/128.png'))}`;
  const hero = `data:image/jpeg;base64,${b64(join(out, 'screenshots', '1-overview.jpg'))}`;
  const css = `
    *{box-sizing:border-box} body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#fff;
      background:radial-gradient(120% 140% at 0% 0%,#1d4ed8 0%,#0f172a 55%,#052e2b 100%);overflow:hidden}
    .t{font-weight:700;letter-spacing:-.02em} .s{opacity:.85}
    .chip{display:inline-block;border:1px solid rgba(255,255,255,.3);border-radius:999px;padding:4px 12px;margin:0 6px 6px 0;font-size:15px}
    img.shot{border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.15)}`;
  const promo = await context.newPage();

  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(`<style>${css}</style>
    <div style="height:280px;padding:28px 30px;display:flex;flex-direction:column;justify-content:center">
      <img src="${icon}" width="64" height="64" style="margin-bottom:14px">
      <div class="t" style="font-size:34px;line-height:1.05">WebRTC DevTools</div>
      <div class="s" style="font-size:16px;margin-top:8px;line-height:1.35">Debug peer connections, ICE, SDP and stats inside Chrome DevTools</div>
    </div>`);
  await promo.screenshot({ path: join(out, 'promo', 'small-440x280.jpg'), type: 'jpeg', quality: 92 });
  console.log('  promo/small-440x280.jpg');

  await promo.setViewportSize({ width: 1400, height: 560 });
  await promo.setContent(`<style>${css}</style>
    <div style="height:560px;display:flex;align-items:center">
      <div style="width:560px;padding:0 20px 0 70px;flex:none">
        <img src="${icon}" width="84" height="84" style="margin-bottom:20px">
        <div class="t" style="font-size:56px;line-height:1.02">WebRTC DevTools</div>
        <div class="s" style="font-size:22px;margin:14px 0 22px;line-height:1.35">Everything webrtc-internals shows, per tab, plus the diagnosis.</div>
        <span class="chip">ICE &amp; TURN insights</span><span class="chip">SDP diff</span><span class="chip">Live stats</span><span class="chip">Data channels</span><span class="chip">Call stacks</span>
      </div>
      <img class="shot" src="${hero}" width="1040" style="margin-left:20px;transform:translateY(60px)">
    </div>`);
  await promo.screenshot({ path: join(out, 'promo', 'marquee-1400x560.jpg'), type: 'jpeg', quality: 92 });
  console.log('  promo/marquee-1400x560.jpg');
} finally {
  await context.close();
}
console.log(`Done. Files are in ${out}`);
