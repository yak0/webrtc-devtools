# Chrome Web Store submission kit

Everything to paste into the Chrome Web Store Developer Dashboard, tab by tab.
Items marked **TODO** need a decision or a value only you have.

Files in this folder:

| File | Use |
|---|---|
| `icon-128.png` | Store icon (created by `npm run icons` from `icon-source.png`, see `ICON_PROMPT.md`) |
| `screenshots/1-overview.jpg` … `5-data-channels.jpg` | Screenshots, 1280×800 |
| `promo/small-440x280.jpg` | Small promo tile |
| `promo/marquee-1400x560.jpg` | Marquee promo tile |
| `PRIVACY.md` | Privacy policy text (must be hosted at a public URL) |
| `demo-page.html` | Demo call used to produce the screenshots (`npm run store:assets`) |

Package to upload: `npm run build && npm run zip` → `release/webrtc-devtools-<version>.zip`.

---

## 1. Store listing

**Name** (max 75 characters)

```
WebRTC DevTools
```

**Summary** (max 132 characters; this one is 127)

```
Inspect RTCPeerConnections, ICE, SDP, stats and data channels in a DevTools panel, with automatic diagnosis of WebRTC problems.
```

**Category:** Developer Tools  
**Language:** English

**Description**

```
WebRTC DevTools adds a "WebRTC" tab to Chrome DevTools. It shows what chrome://webrtc-internals shows, but only for the tab you are inspecting, next to your code, and it explains what went wrong.

OPEN IT
Open DevTools (F12, or ⌥⌘I on Mac) and select the "WebRTC" tab. The toolbar icon shows how many peer connections the current page has open.

WHAT YOU GET

• Overview with diagnosis
Plain-language findings for each connection: TURN server unreachable or wrong credentials, ICE failed and why, media relayed through TURN, video limited by CPU or bandwidth, packet loss, freezes, failed API calls, connections that were never closed.

• Timeline of every API call and event
createOffer, setLocalDescription, addIceCandidate, state changes and more, with arguments, results, errors, duration and the call stack of the code that made the call.

• SDP made readable
Parsed media sections, codecs, header extensions, simulcast and SSRCs, a diff against the previous description, and a codec negotiation summary (offered, kept, dropped, in use).

• ICE
Candidate pairs with the selected one highlighted, local and remote candidates, candidate errors, round-trip time.

• Media
One card per RTP stream: bitrate, resolution, frame rate, loss, jitter, QP, quality limitation, simulcast/SVC layers, optional live video previews, audio level meters and an estimated quality score.

• Stats explorer
Every getStats() object with a chart for any field, like webrtc-internals.

• Data channels
Channel list plus a message inspector for text and binary payloads.

• getUserMedia / getDisplayMedia
Every request with its constraints, the tracks it returned or the error, and track events.

• Controls and fault injection for testing
Store a connection as $pc1 in the console, restart ICE, cap the send bitrate, disable tracks. Chaos mode drops ICE candidates by type, delays signaling, forces TURN or drops data channel messages, so you can test how your app behaves on bad networks.

• Export, import and compare
Export a session as JSON or as a single HTML report that opens without the extension. Import exports and chrome://webrtc-internals dumps. Compare two connections side by side.

• Device and network tests
A separate page to test camera, microphone, speakers, screen sharing, local encode/decode performance and STUN/TURN servers.

• SDK detection
Recognizes LiveKit, mediasoup, Twilio, Daily, Agora, Jitsi, Janus and others, and labels each connection as publisher or subscriber.

PRIVACY
Everything stays on your computer. The extension has no server, no analytics and no account. Data leaves your machine only when you export a file yourself. TURN credentials are masked before they reach the panel.

PERFORMANCE
Until you open the WebRTC panel, the extension only keeps a small in-memory log on pages that use WebRTC. Statistics are collected only while the panel is open (or on sites where you turn on "record from page load").

Works in Chrome and other Chromium browsers (Edge, Brave, Arc), version 111 or later.
```

**Screenshots** (upload in this order; captions are optional, for your own reference)

1. `1-overview.jpg`: Overview: diagnosis, traffic and bandwidth estimation
2. `2-media.jpg`: Media: per-stream metrics, live preview, quality score
3. `3-timeline.jpg`: Timeline: every API call with arguments and call stack
4. `4-sdp.jpg`: SDP: parsed sections and codec negotiation
5. `5-data-channels.jpg`: Data channels: message inspector

**Small promo tile:** `promo/small-440x280.jpg`  
**Marquee promo tile:** `promo/marquee-1400x560.jpg`

**Additional fields**

- Official URL: none (optional)
- Homepage URL: `https://github.com/yak0/webrtc-devtools`
- Support URL: `https://github.com/yak0/webrtc-devtools/issues`
- Mature content: No

---

## 2. Privacy practices tab

**Single purpose** (max 1000 characters)

```
WebRTC DevTools is a debugging tool for web developers. It adds a panel to Chrome DevTools that shows the WebRTC activity (RTCPeerConnection objects, their API calls, ICE candidates, session descriptions, statistics, data channel messages and getUserMedia requests) of the page being inspected, so developers can find and fix problems in real-time audio/video applications.
```

**Permission justifications**

`storage`

```
Stores two things locally: (1) the list of site origins where the user turned on "Record stats from page load" in the panel settings, read by the content script so recording can start before DevTools is opened; (2) in session storage, the number of open peer connections per tab so the toolbar badge survives a service worker restart. No page content is stored and nothing is synced or transmitted.
```

Host permission (content scripts on `<all_urls>`)

```
The extension is a developer tool that must work on whatever site the developer is building or debugging, including localhost, staging domains and embedded iframes, so the sites cannot be listed in advance. A content script runs at document_start in the page's main world to wrap the WebRTC APIs (RTCPeerConnection, RTCDataChannel, MediaDevices.getUserMedia) before the page's own scripts use them; injecting later would miss connections created during page load. On pages that never use WebRTC the script does nothing beyond installing these wrappers. Collected data is shown only in the user's own DevTools panel and is never sent anywhere.
```

**Are you using remote code?**

```
No. All JavaScript is bundled in the extension package. The extension does not load or evaluate code from any server, uses no eval() or new Function(), and has no external script, style or font references.
```

**Data usage**

Check **none** of the data type boxes (personally identifiable information, health, financial, authentication, personal communications, location, web history, user activity, website content). The extension reads WebRTC activity of the inspected page, but only on the user's device and only to display it to that user; nothing is collected by the developer or transmitted.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://github.com/yak0/webrtc-devtools/blob/main/store/PRIVACY.md`

---

## 3. Distribution tab

- Visibility: Public
- Regions: All regions
- Pricing: Free, no in-app purchases

---

## 4. Test instructions (for the reviewer)

```
No account or login is needed.

1. Open any page that uses WebRTC, for example https://webrtc.github.io/samples/src/content/peerconnection/pc1/ and click "Start", then "Call".
2. The extension's toolbar icon shows a badge with the number of open peer connections (2). Clicking the icon opens a popup that lists them and explains how to open the panel.
3. Open Chrome DevTools (F12) and select the "WebRTC" tab (it may be behind the ">>" overflow menu).
4. Select "PC 1" in the left list. The tabs Overview, Timeline, SDP, ICE, Media, Stats, Data channels and Controls show the connection's data.
5. "Tools" in the left list contains fault injection for testing ("Chaos mode") and a STUN/TURN tester. Both act only on the inspected page / servers typed by the user.
6. In the popup, the links under "Test your setup" open a bundled page with camera, microphone and speaker tests. It asks for camera/microphone permission only when a test is started.

The extension makes no network requests of its own. The STUN/TURN tester contacts only the servers the user enters.
```

---

## 5. Release notes for version 0.1.0

```
First public release: DevTools panel with diagnosis, timeline, SDP, ICE, media, stats, data channels, controls, chaos mode, export/import (including webrtc-internals dumps), HTML reports, comparison view and device tests.
```

---

## 6. Before you submit

- [ ] Generate the icon (`ICON_PROMPT.md`), save as `store/icon-source.png`, run `npm run icons`
- [ ] `npm run store:assets` again so the promo tiles use the new icon
- [x] Privacy policy, Homepage and Support URLs (see sections 1 and 2)
- [ ] Bump `version` in `package.json` if this is not the first upload
- [ ] `npm run build && npm test && npm run test:e2e && npm run zip`
- [ ] Load `dist/` unpacked in your everyday Chrome and try it on one of your real apps
- [ ] Register a Chrome Web Store developer account (one-time fee) if you do not have one

Review notes: the broad host access (`<all_urls>`) and main-world script injection usually trigger an in-depth review, so expect the first review to take longer than usual. The justifications above are written for that.
