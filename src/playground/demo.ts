// A self-contained WebRTC app (two peers in one page) used to exercise the panel.

const $ = (id: string) => document.getElementById(id) as HTMLElement;

function canvasStream(label: string, hue: number): MediaStream {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const ctx = canvas.getContext('2d')!;
  let frame = 0;
  setInterval(() => {
    frame++;
    ctx.fillStyle = `hsl(${(hue + frame) % 360} 60% 35%)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '48px system-ui';
    ctx.fillText(`${label} ${frame}`, 40, 200);
    ctx.fillRect((frame * 7) % canvas.width, 260, 60, 60);
  }, 33);
  const stream = canvas.captureStream(30);
  try {
    const audio = new AudioContext();
    const osc = audio.createOscillator();
    osc.frequency.value = 440;
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    const dest = audio.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    stream.addTrack(dest.stream.getAudioTracks()[0]);
  } catch {
    /* no audio */
  }
  return stream;
}

interface Call {
  a: RTCPeerConnection;
  b: RTCPeerConnection;
  timer: ReturnType<typeof setInterval>;
}

let call: Call | null = null;

async function negotiate(a: RTCPeerConnection, b: RTCPeerConnection) {
  const offer = await a.createOffer();
  await a.setLocalDescription(offer);
  await b.setRemoteDescription(a.localDescription!);
  const answer = await b.createAnswer();
  await b.setLocalDescription(answer);
  await a.setRemoteDescription(b.localDescription!);
}

async function startCall(config: RTCConfiguration = {}) {
  hangup();
  const a = new RTCPeerConnection(config);
  const b = new RTCPeerConnection(config);
  a.onicecandidate = (e) => b.addIceCandidate(e.candidate).catch(() => {});
  b.onicecandidate = (e) => a.addIceCandidate(e.candidate).catch(() => {});
  b.ontrack = (e) => {
    ($('remote') as HTMLVideoElement).srcObject = e.streams[0];
  };
  const stream = canvasStream('peer A', 200);
  ($('local') as HTMLVideoElement).srcObject = stream;
  for (const t of stream.getTracks()) {
    // Video with temporal SVC so the Media tab shows its layer table.
    if (t.kind === 'video') a.addTransceiver(t, { streams: [stream], sendEncodings: [{ scalabilityMode: 'L1T3', maxBitrate: 1_500_000 } as RTCRtpEncodingParameters] });
    else a.addTrack(t, stream);
  }

  const chat = a.createDataChannel('chat');
  const binary = a.createDataChannel('telemetry', { ordered: false, maxRetransmits: 0 });
  b.ondatachannel = (e) => {
    e.channel.onmessage = (m) => {
      if (e.channel.label === 'chat') e.channel.send(JSON.stringify({ type: 'ack', of: JSON.parse(m.data).n }));
    };
  };
  let n = 0;
  const timer = setInterval(() => {
    if (chat.readyState === 'open') chat.send(JSON.stringify({ type: 'chat', n: ++n, text: `hello #${n}`, at: Date.now() }));
    if (binary.readyState === 'open') binary.send(new Uint8Array([1, 2, 3, n & 0xff, 0xde, 0xad, 0xbe, 0xef]));
  }, 700);

  await negotiate(a, b);
  call = { a, b, timer };
}

function hangup() {
  if (!call) return;
  clearInterval(call.timer);
  call.a.close();
  call.b.close();
  call = null;
}

export function setupDemo() {
  $('call').onclick = () => startCall({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  $('badturn').onclick = () =>
    startCall({
      iceServers: [{ urls: ['turn:127.0.0.1:3479?transport=udp', 'turn:turn.invalid:3478'], username: 'demo', credential: 'secret' }]
    });
  $('restart').onclick = async () => {
    if (!call) return;
    call.a.restartIce();
    await negotiate(call.a, call.b);
  };
  $('renegotiate').onclick = async () => {
    if (!call) return;
    const s = canvasStream('screen', 30);
    call.a.addTrack(s.getVideoTracks()[0], s);
    await negotiate(call.a, call.b);
  };
  $('badsdp').onclick = async () => {
    const pc = call?.a ?? new RTCPeerConnection();
    await pc.setRemoteDescription({ type: 'answer', sdp: 'v=0\r\nthis is not sdp\r\n' }).catch(() => {});
  };
  $('leak').onclick = () => {
    // Created and dropped without close(): shows up as "garbage collected" after a GC.
    const pc = new RTCPeerConnection();
    pc.createDataChannel('leak');
    pc.createOffer().then((o) => pc.setLocalDescription(o));
  };
  $('gum').onclick = () => {
    navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 1280, height: 720 } }).then(
      (s) => setTimeout(() => s.getTracks().forEach((t) => t.stop()), 3000),
      () => {}
    );
  };
  $('hangup').onclick = hangup;
  $('livekit').onclick = async () => {
    // Mimics the shape of a LiveKit publisher connection (data channel labels) to demo SDK detection.
    const pub = new RTCPeerConnection();
    pub.createDataChannel('_reliable');
    pub.createDataChannel('_lossy', { ordered: false, maxRetransmits: 0 });
    await pub.setLocalDescription(await pub.createOffer());
  };
}
