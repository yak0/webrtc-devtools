// Helpers for the device test page. Everything runs locally in the extension page.

export function stopStream(s: MediaStream | null | undefined) {
  s?.getTracks().forEach((t) => t.stop());
}

/** Device labels are empty until the page has been granted a permission once. */
export async function unlockLabels(kind: 'audio' | 'video' | 'both' = 'both'): Promise<void> {
  const s = await navigator.mediaDevices.getUserMedia({ audio: kind !== 'video', video: kind !== 'audio' });
  stopStream(s);
}

export async function listDevices(): Promise<MediaDeviceInfo[]> {
  return navigator.mediaDevices.enumerateDevices();
}

export function errorText(e: unknown): string {
  const err = e as { name?: string; message?: string; constraint?: string };
  const hints: Record<string, string> = {
    NotAllowedError: 'Permission denied. Allow camera/microphone for this extension page (lock icon in the address bar).',
    NotFoundError: 'No matching device found.',
    NotReadableError: 'The device is busy (used by another app or tab) or blocked by the OS. On macOS check System Settings → Privacy & Security.',
    OverconstrainedError: `The device cannot satisfy the constraint${err.constraint ? ` "${err.constraint}"` : ''}.`,
    AbortError: 'The device could not be started.',
    SecurityError: 'Media access is blocked by policy.'
  };
  return `${err.name ?? 'Error'}: ${hints[err.name ?? ''] ?? err.message ?? String(e)}`;
}

/** Counts rendered frames with requestVideoFrameCallback; reports frames per second. */
export function watchFps(video: HTMLVideoElement, cb: (fps: number) => void): () => void {
  let frames = 0;
  let stopped = false;
  const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
  const tick = () => {
    if (stopped) return;
    frames++;
    v.requestVideoFrameCallback?.(tick);
  };
  v.requestVideoFrameCallback?.(tick);
  const timer = setInterval(() => {
    cb(frames);
    frames = 0;
  }, 1000);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

/** Samples a tiny copy of the current frame: average brightness and a fingerprint to detect frozen video. */
export function createFrameProbe() {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 18;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let last = '';
  let sameFor = 0;
  return (video: HTMLVideoElement) => {
    if (!video.videoWidth) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let sum = 0;
    let fp = '';
    for (let i = 0; i < data.length; i += 4) {
      const y = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      sum += y;
      if (i % 64 === 0) fp += (y >> 4).toString(16);
    }
    const luma = sum / (data.length / 4);
    sameFor = fp === last ? sameFor + 1 : 0;
    last = fp;
    return { luma, black: luma < 8, frozen: sameFor >= 3 };
  };
}

export interface LevelSample {
  rmsDb: number;
  peakDb: number;
  clipping: boolean;
  samples: Float32Array;
}

/** Live input level of an audio stream (dBFS). */
export function createLevelMeter(stream: MediaStream, cb: (s: LevelSample) => void): () => void {
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const loop = () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    let peak = 0;
    for (const v of buf) {
      sum += v * v;
      peak = Math.max(peak, Math.abs(v));
    }
    const rms = Math.sqrt(sum / buf.length);
    const db = (x: number) => (x > 0 ? Math.max(-100, 20 * Math.log10(x)) : -100);
    cb({ rmsDb: db(rms), peakDb: db(peak), clipping: peak >= 0.99, samples: buf });
    raf = requestAnimationFrame(loop);
  };
  loop();
  return () => {
    cancelAnimationFrame(raf);
    src.disconnect();
    void ctx.close();
  };
}

export function recordClip(stream: MediaStream, ms: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const chunks: Blob[] = [];
    const rec = new MediaRecorder(stream);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType }));
    rec.onerror = (e) => reject((e as any).error ?? e);
    rec.start();
    setTimeout(() => rec.state !== 'inactive' && rec.stop(), ms);
  });
}

// ---- loopback call -------------------------------------------------------------------

export interface LoopbackSample {
  t: number;
  sendKbps: number;
  recvFps: number | null;
  sendFps: number | null;
  width: number | null;
  height: number | null;
  /** Average QP of the frames encoded in this second (lower = better quality). */
  qp: number | null;
  limitation: string;
  encodeMsPerFrame: number | null;
}

export interface LoopbackResult {
  codec: string;
  encoder: string;
  hardwareEncoder: boolean | null;
  decoder: string;
  hardwareDecoder: boolean | null;
  samples: LoopbackSample[];
  limitationShare: Record<string, number>;
  freezes: number;
  verdict: { ok: boolean; text: string }[];
}

export function videoCodecs(): string[] {
  const caps = RTCRtpSender.getCapabilities?.('video');
  const names = (caps?.codecs ?? []).map((c) => c.mimeType.split('/')[1]).filter((n) => !/rtx|red|ulpfec|flexfec/i.test(n));
  return [...new Set(names)];
}

/**
 * Sends `track` from one RTCPeerConnection to another inside this page. The network is
 * not involved, so this measures the encoder/decoder and CPU: resolution, fps, hardware
 * acceleration and what limits quality.
 */
export async function runLoopback(
  track: MediaStreamTrack,
  opts: { codec?: string; maxBitrate?: number; durationMs: number; signal?: AbortSignal },
  onSample: (s: LoopbackSample, partial: LoopbackResult) => void
): Promise<LoopbackResult> {
  const a = new RTCPeerConnection();
  const b = new RTCPeerConnection();
  a.onicecandidate = (e) => e.candidate && b.addIceCandidate(e.candidate);
  b.onicecandidate = (e) => e.candidate && a.addIceCandidate(e.candidate);
  const tx = a.addTransceiver(track, { direction: 'sendonly', sendEncodings: [{ maxBitrate: opts.maxBitrate }] });
  if (opts.codec) {
    const all = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const preferred = all.filter((c) => c.mimeType.toLowerCase() === `video/${opts.codec!.toLowerCase()}`);
    const rest = all.filter((c) => !preferred.includes(c));
    if (preferred.length) tx.setCodecPreferences([...preferred, ...rest]);
  }
  const result: LoopbackResult = {
    codec: '',
    encoder: '',
    hardwareEncoder: null,
    decoder: '',
    hardwareDecoder: null,
    samples: [],
    limitationShare: {},
    freezes: 0,
    verdict: []
  };
  try {
    await a.setLocalDescription(await a.createOffer());
    await b.setRemoteDescription(a.localDescription!);
    await b.setLocalDescription(await b.createAnswer());
    await a.setRemoteDescription(b.localDescription!);

    let prev: { bytes: number; ts: number; enc: number; frames: number; qp: number } | null = null;
    const t0 = performance.now();
    while (performance.now() - t0 < opts.durationMs && !opts.signal?.aborted) {
      await new Promise((r) => setTimeout(r, 1000));
      const [sa, sb] = await Promise.all([a.getStats(), b.getStats()]);
      let out: any;
      let inb: any;
      sa.forEach((s: any) => s.type === 'outbound-rtp' && s.kind === 'video' && (out = s));
      sb.forEach((s: any) => s.type === 'inbound-rtp' && s.kind === 'video' && (inb = s));
      if (!out) continue;
      const codec = sa.get(out.codecId) as any;
      result.codec = codec?.mimeType?.split('/')[1] ?? result.codec;
      result.encoder = out.encoderImplementation ?? result.encoder;
      result.hardwareEncoder = out.powerEfficientEncoder ?? result.hardwareEncoder;
      result.decoder = inb?.decoderImplementation ?? result.decoder;
      result.hardwareDecoder = inb?.powerEfficientDecoder ?? result.hardwareDecoder;
      result.freezes = inb?.freezeCount ?? result.freezes;
      if (out.qualityLimitationDurations) {
        const d = out.qualityLimitationDurations as Record<string, number>;
        const total = Object.values(d).reduce((x, y) => x + y, 0) || 1;
        result.limitationShare = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v / total]));
      }
      const now = { bytes: out.bytesSent, ts: out.timestamp, enc: out.totalEncodeTime ?? 0, frames: out.framesEncoded ?? 0, qp: out.qpSum ?? 0 };
      if (prev) {
        const dt = (now.ts - prev.ts) / 1000;
        const df = now.frames - prev.frames;
        const sample: LoopbackSample = {
          t: Math.round((performance.now() - t0) / 1000),
          sendKbps: dt > 0 ? ((now.bytes - prev.bytes) * 8) / dt / 1000 : 0,
          sendFps: out.framesPerSecond ?? null,
          recvFps: inb?.framesPerSecond ?? null,
          width: out.frameWidth ?? null,
          height: out.frameHeight ?? null,
          qp: df > 0 && out.qpSum !== undefined ? (now.qp - prev.qp) / df : null,
          limitation: out.qualityLimitationReason ?? 'none',
          encodeMsPerFrame: df > 0 ? ((now.enc - prev.enc) / df) * 1000 : null
        };
        result.samples.push(sample);
        onSample(sample, result);
      }
      prev = now;
    }
  } finally {
    a.close();
    b.close();
  }
  result.verdict = loopbackVerdict(result, track);
  return result;
}

export function loopbackVerdict(r: LoopbackResult, track?: MediaStreamTrack): { ok: boolean; text: string }[] {
  const out: { ok: boolean; text: string }[] = [];
  const s = r.samples.slice(Math.min(2, Math.max(0, r.samples.length - 1))); // skip ramp-up
  const avg = (f: (x: LoopbackSample) => number | null) => {
    const v = s.map(f).filter((x): x is number => typeof x === 'number');
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const fps = avg((x) => x.sendFps);
  const height = avg((x) => x.height);
  const srcHeight = track?.getSettings().height ?? null;
  const srcFps = track?.getSettings().frameRate ?? null;
  if (r.hardwareEncoder !== null) {
    out.push({ ok: !!r.hardwareEncoder, text: r.hardwareEncoder ? `Hardware ${r.codec} encoder (${r.encoder})` : `Software ${r.codec} encoder (${r.encoder || 'unknown'}): uses more CPU` });
  }
  const cpu = r.limitationShare.cpu ?? 0;
  if (cpu > 0.1) out.push({ ok: false, text: `CPU limited the encoder ${Math.round(cpu * 100)}% of the time` });
  else if (s.length) out.push({ ok: true, text: 'No CPU limitation while encoding' });
  if (fps !== null && srcFps) {
    out.push({ ok: fps >= srcFps * 0.8, text: `Encoded ${fps.toFixed(0)} of ${Math.round(srcFps)} fps` });
  }
  if (height !== null && srcHeight) {
    const full = height >= srcHeight * 0.95;
    const bwe = (r.limitationShare.bandwidth ?? 0) > 0.5;
    out.push(
      full
        ? { ok: true, text: `Sent the full ${srcHeight}p captured` }
        : bwe
          ? {
              ok: true,
              text: `Sent ${Math.round(height)}p of ${srcHeight}p: the bandwidth estimate starts low and ramps up, not a problem of this computer. Run 30 s or more for the full resolution.`
            }
          : { ok: false, text: `Sent only ${Math.round(height)}p of ${srcHeight}p captured` }
    );
  }
  if (r.freezes > 0) out.push({ ok: false, text: `${r.freezes} freeze(s) on the receiving side` });
  return out;
}
