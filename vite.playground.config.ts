import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Dev harness: runs the panel in a normal tab next to a demo WebRTC app,
// talking to the injected collector through window messages (no extension needed).
export default defineConfig({
  root: fileURLToPath(new URL('./src', import.meta.url)),
  plugins: [vue()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) }
  },
  server: { port: 5199, open: false },
  build: {
    outDir: fileURLToPath(new URL('./dist-playground', import.meta.url)),
    rollupOptions: {
      input: fileURLToPath(new URL('./src/playground/index.html', import.meta.url))
    }
  }
});
