# WebRTC DevTools

A Chrome DevTools panel for debugging WebRTC apps: everything `chrome://webrtc-internals` shows, scoped to the inspected tab, plus things it can't show.

- **Overview**: insights (ICE/TURN failures, relayed media, CPU/bandwidth limits, packet loss, unclosed connections…), traffic chart, state timelines, transport, configuration (TURN credentials masked)
- **Timeline**: every API call and event with arguments, results, errors, duration and the **call stack** of the app code that made the call
- **SDP**: parsed m-sections (codecs, extensions, simulcast, ssrcs) + raw + diff against the previous description
- **ICE**: candidate pairs, local/remote candidates (incl. trickled ones), candidate errors, RTT chart
- **Media**: per RTP stream cards (bitrate, fps, resolution, loss, jitter, QP, quality limitation…) with charts
- **Stats**: explorer for every `getStats()` object, chart any field
- **Data channels**: channels and a message inspector (text + binary previews)
- **Media devices**: `getUserMedia` / `getDisplayMedia` calls, results, errors, track events
- **Controls**: store a connection as `$pcN` in the console, restart ICE, close, cap send bitrate, disable outgoing tracks
- **Chaos mode** (Tools): drop ICE candidates by type/protocol, delay remote candidates, force TURN, drop data channel messages; drops show up in the Timeline
- **STUN/TURN tester** (Tools): gather candidates against any ICE servers and get a verdict (works / bad credentials / unreachable)
- **SDK detection**: LiveKit, mediasoup, Twilio, Daily, Agora, Jitsi, Janus, Vonage, Chime, 100ms, Zoom… scored from creation stack, page globals, ICE server hosts, data channel labels and SDP fingerprints (evidence shown on hover); plus each connection's role (publisher / subscriber / bidirectional, offerer / answerer)
- **Media extras**: simulcast/SVC layer table, live video previews (1 fps), audio level meters, estimated quality (audio MOS via E-model, video score)
- **Bandwidth estimation** chart (available vs target vs sent vs retransmitted), **codec negotiation** explainer, synchronized chart cursors
- **Toolbar badge**: number of open RTCPeerConnections in the tab (works without DevTools), colored red/orange when the panel finds problems
- **Toolbar popup**: lists the tab's connections and explains how to open the WebRTC panel (extensions cannot open DevTools themselves)
- **Device & network test page** (from the popup or Tools): devices, camera (real resolution/fps, black/frozen detection, resolution scan), microphone (level, clipping, processing, record & playback), speakers (output device, left/right), screen share, local call quality test (hardware encoder, CPU limits) and the STUN/TURN tester
- **Record from page load** (opt-in per origin): stats are collected before DevTools is opened and replayed when the panel attaches
- **Export / import**: JSON export, **standalone HTML report** (the whole panel in one file, opens without the extension), import of exports **and `chrome://webrtc-internals` dumps** (gzip too), "Add to session" + **Compare** view to put two connections side by side

## How it works

```
page (MAIN world)          content script         service worker          DevTools panel
src/injected  ──CustomEvent──▶ src/content ──port──▶ src/background ──port──▶ src/panel
```

- `injected.js` runs at `document_start` in the page world and wraps `RTCPeerConnection`, its methods, `RTCRtpSender/Transceiver`, `RTCDataChannel.send` and `MediaDevices` with Proxies. Return values, exceptions and rejections pass through untouched (covered by e2e tests).
- Until a panel is open it only keeps a bounded trace in memory. `getStats()` polling and data channel capture run only while a panel is attached. Stats are sent as deltas.
- The content script wakes the service worker only on pages that actually use WebRTC.

## Development

```bash
npm install
npm run dev          # rebuilds dist/ on change → chrome://extensions → Load unpacked → dist/
npm run playground   # panel + demo WebRTC app in a normal tab, no extension needed (http://localhost:5199/playground/index.html)
npm test             # unit tests (vitest)
npm run test:e2e     # loads dist/ into Chromium and checks page + panel (uses a Chromium from Playwright's cache; `npx playwright install chromium` if there is none, or set WRD_CHROME)
npm run build        # type-check + production build
npm run zip          # release/webrtc-devtools-<version>.zip for the Chrome Web Store
```

The panel can also be opened outside DevTools: `chrome-extension://<id>/panel/panel.html?tabId=<tab id>`.
