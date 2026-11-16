import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Builds the extension HTML pages (DevTools page + panel).
// Background / content / injected scripts are bundled by esbuild in scripts/build.mjs,
// because content scripts must be classic (non-module) single-file scripts.
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  base: './',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome111',
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      input: {
        panel: fileURLToPath(new URL('./src/panel/panel.html', import.meta.url)),
        devtools: fileURLToPath(new URL('./src/devtools/devtools.html', import.meta.url)),
        popup: fileURLToPath(new URL('./src/popup/popup.html', import.meta.url)),
        tools: fileURLToPath(new URL('./src/tools/tools.html', import.meta.url))
      }
    }
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node'
  }
} as any);
