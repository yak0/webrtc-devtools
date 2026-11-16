// Packs dist/ into release/webrtc-devtools-<version>.zip for the Chrome Web Store.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
mkdirSync('release', { recursive: true });
const file = `release/webrtc-devtools-${pkg.version}.zip`;
rmSync(file, { force: true });
execFileSync('zip', ['-r', '-X', `../${file}`, '.', '-x', '*.map', '.DS_Store'], { cwd: 'dist', stdio: 'inherit' });
console.log(`Created ${file}`);
