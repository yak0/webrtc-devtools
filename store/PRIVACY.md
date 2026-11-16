# WebRTC DevTools: Privacy Policy

Last updated: 16 November 2026

WebRTC DevTools is a browser extension for web developers. It shows the WebRTC activity of the
page you are inspecting inside Chrome DevTools.

## Summary

The extension does not collect, transmit, sell or share any data. It has no server, no
analytics, no advertising and no user accounts. Everything it reads stays in your browser.

## What the extension reads

On pages you visit, the extension observes calls to the browser's WebRTC APIs
(`RTCPeerConnection`, `RTCDataChannel`, `getUserMedia`, `getDisplayMedia`). When you open its
DevTools panel it displays, for that page only:

- connection configuration, with TURN credentials masked
- API calls, events and their call stacks
- session descriptions (SDP) and ICE candidates, which include IP addresses
- connection statistics
- previews of data channel messages
- optional low-resolution video previews, only while you turn them on

This information is kept in memory in your browser and is discarded when the page or the
panel is closed.

## What is stored

The extension stores only its own settings on your device:

- panel preferences (statistics interval, capture options, "preserve log")
- the list of site origins where you enabled "Record stats from page load"
- the number of open connections per tab, for the toolbar badge, until the browser session ends

No page content is stored.

## What leaves your device

Nothing, unless you do it yourself:

- **Export**: when you export a session (JSON or HTML report) a file is saved to your
  computer. It contains the information listed above, including IP addresses and SDP. You
  decide whether and with whom to share that file.
- **STUN/TURN tester**: when you run it, your browser contacts the STUN/TURN servers you
  entered, exactly as a WebRTC call would. Credentials you type are used for that test only
  and are not stored.

The extension makes no other network requests and loads no remote code.

## Camera and microphone

The bundled device test page asks for camera, microphone or screen-sharing permission only
when you start a test. Audio and video are processed locally and are never recorded to disk
or sent anywhere. Test recordings stay in memory and are discarded when you leave the page.

## Permissions

- **Access to all sites**: needed so the tool works on any site a developer is debugging,
  including local and staging environments.
- **Storage**: for the settings described above.

## Changes

If this policy changes, the updated version will be published at this address with a new date.

## Contact

Questions about this policy: yakup.cilesiz@gmail.com, or open an issue at
https://github.com/yak0/webrtc-devtools/issues
