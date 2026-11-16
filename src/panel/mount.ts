import { createApp } from 'vue';
import 'uplot/dist/uPlot.min.css';
import './styles.css';
import App from './App.vue';
import type { Bridge } from './bridge';
import { applyBackgroundMessage, onNavigated, session, setCommandSender } from './store/session';
import { chaos, collectorSettings, settings } from './settings';
import { watch } from 'vue';

export function mountPanel(el: string | Element, bridge: Bridge) {
  setCommandSender((m) => bridge.send(m));
  bridge.connect(applyBackgroundMessage, (connected) => {
    session.connected = connected;
    if (connected) bridge.send({ type: 'settings', settings: collectorSettings() });
  });
  bridge.onNavigated((url) => {
    onNavigated(settings.preserveLog, url);
    // New document: its collector needs to be told a panel is listening.
    setTimeout(() => bridge.send({ type: 'reattach' }), 300);
  });
  watch(
    () => [settings.statsInterval, settings.captureDataChannelMessages, settings.captureStacks, JSON.stringify(chaos)],
    () => bridge.send({ type: 'settings', settings: collectorSettings() })
  );
  createApp(App, { bridge }).mount(el);
}
