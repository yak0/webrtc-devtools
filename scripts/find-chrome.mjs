// Picks a Chromium that can load extensions for the e2e tests and store screenshots.
// Order: $WRD_CHROME, Playwright's own Chromium (if installed), then any Chrome for Testing /
// Chromium build already in Playwright's download cache (newest first).
import { chromium } from 'playwright';
import { existsSync, readdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const BINARIES = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-win64/chrome.exe',
  'chrome-win/chrome.exe'
];

function cacheDir() {
  if (process.env.PLAYWRIGHT_BROWSERS_PATH) return process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (platform() === 'darwin') return join(homedir(), 'Library/Caches/ms-playwright');
  if (platform() === 'win32') return join(process.env.LOCALAPPDATA ?? homedir(), 'ms-playwright');
  return join(homedir(), '.cache/ms-playwright');
}

/** Returns launch options ({ executablePath } or { channel }) for chromium.launchPersistentContext. */
export function chromeLaunchOptions() {
  if (process.env.WRD_CHROME) return { executablePath: process.env.WRD_CHROME };
  try {
    // Full Chromium (the default headless shell cannot load extensions).
    if (existsSync(chromium.executablePath())) return { channel: 'chromium' };
  } catch {
    /* not installed */
  }
  const dir = cacheDir();
  if (existsSync(dir)) {
    const builds = readdirSync(dir)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const build of builds) {
      for (const bin of BINARIES) {
        const path = join(dir, build, bin);
        if (existsSync(path)) return { executablePath: path };
      }
    }
  }
  console.error('No Chromium found. Run `npx playwright install chromium` or set WRD_CHROME to a Chrome for Testing binary.');
  process.exit(1);
}
