import { install } from './collector';

try {
  install(window as any);
} catch (err) {
  // Never break the page.
  console.debug('[WebRTC DevTools] collector failed to install', err);
}
