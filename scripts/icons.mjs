// Resizes store/icon-source.png (square, ideally 1024x1024) into the sizes Chrome needs.
// Usage: npm run icons    (macOS: uses the built-in `sips`)
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const src = 'store/icon-source.png';
if (!existsSync(src)) {
  console.error(`Put your generated icon at ${src} (square PNG, 1024x1024 recommended) and run again.`);
  process.exit(1);
}
for (const size of [16, 32, 48, 128]) {
  execFileSync('sips', ['-z', String(size), String(size), src, '--out', `public/icons/${size}.png`], { stdio: 'ignore' });
  console.log(`public/icons/${size}.png`);
}
execFileSync('sips', ['-z', '128', '128', src, '--out', 'store/icon-128.png'], { stdio: 'ignore' });
console.log('store/icon-128.png (upload this as the store icon)\nRebuild with `npm run build`, then `npm run store:assets` to refresh the promo images.');
