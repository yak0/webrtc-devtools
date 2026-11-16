// Builds the extension into dist/.
//   node scripts/build.mjs           -> production build
//   node scripts/build.mjs --watch   -> rebuild on change (load dist/ as unpacked extension)
import { build as viteBuild } from 'vite';
import * as esbuild from 'esbuild';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createManifest } from './manifest.mjs';

const watch = process.argv.includes('--watch');
const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = `${root}dist`;

const scripts = [
  { entry: 'src/injected/index.ts', out: 'injected.js', format: 'iife' },
  { entry: 'src/content/index.ts', out: 'content.js', format: 'iife' },
  { entry: 'src/background/index.ts', out: 'background.js', format: 'esm' }
];

function writeManifest() {
  mkdirSync(outdir, { recursive: true });
  writeFileSync(`${outdir}/manifest.json`, JSON.stringify(createManifest(), null, 2));
}

async function buildScripts() {
  const contexts = await Promise.all(
    scripts.map((s) =>
      esbuild.context({
        entryPoints: [`${root}${s.entry}`],
        outfile: `${outdir}/${s.out}`,
        bundle: true,
        format: s.format,
        target: 'chrome111',
        minify: !watch,
        sourcemap: watch ? 'inline' : false,
        legalComments: 'none',
        logLevel: 'info',
        define: { __DEV__: JSON.stringify(watch) }
      })
    )
  );
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}

await viteBuild({
  configFile: `${root}vite.config.ts`,
  mode: watch ? 'development' : 'production',
  define: { __DEV__: JSON.stringify(watch) },
  build: watch ? { watch: {}, emptyOutDir: false, minify: false, sourcemap: 'inline' } : {}
});
// Standalone report viewer: one JS + one CSS file the panel inlines into exported HTML reports.
await viteBuild({
  configFile: `${root}vite.config.ts`,
  mode: watch ? 'development' : 'production',
  define: { __DEV__: JSON.stringify(watch) },
  publicDir: false,
  build: {
    outDir: `${outdir}/report`,
    emptyOutDir: false,
    ...(watch ? { watch: {}, minify: false } : {}),
    rollupOptions: {
      input: `${root}src/report/report.html`,
      output: { entryFileNames: 'report.js', assetFileNames: 'report[extname]', inlineDynamicImports: true }
    }
  }
});
writeManifest();
await buildScripts();
writeManifest();
if (!watch) console.log('\nBuilt extension into dist/ — load it via chrome://extensions → Load unpacked.');
