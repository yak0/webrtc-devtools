// Turns WebRTC API values into small, structured-clone/JSON-safe objects.
// Must never throw: anything unexpected becomes a string placeholder.

const MAX_DEPTH = 6;
const MAX_ARRAY = 200;
const MAX_KEYS = 100;
const MAX_STRING = 200_000;

type Ctor = (abstract new (...args: any[]) => any) | undefined;

function ctor(name: string): Ctor {
  const v = (globalThis as any)[name];
  return typeof v === 'function' ? v : undefined;
}

const C = {
  MediaStreamTrack: ctor('MediaStreamTrack'),
  MediaStream: ctor('MediaStream'),
  RTCIceCandidate: ctor('RTCIceCandidate'),
  RTCSessionDescription: ctor('RTCSessionDescription'),
  RTCRtpSender: ctor('RTCRtpSender'),
  RTCRtpReceiver: ctor('RTCRtpReceiver'),
  RTCRtpTransceiver: ctor('RTCRtpTransceiver'),
  RTCDataChannel: ctor('RTCDataChannel'),
  RTCCertificate: ctor('RTCCertificate'),
  Blob: ctor('Blob')
};

function is(v: unknown, c: Ctor): boolean {
  try {
    return !!c && v instanceof c;
  } catch {
    return false;
  }
}

export function describeTrack(t: MediaStreamTrack | null | undefined) {
  if (!t) return null;
  return { __type: 'MediaStreamTrack', id: t.id, kind: t.kind, label: t.label };
}

export function serialize(value: unknown, depth = 0): unknown {
  try {
    if (value === null || value === undefined) return value ?? null;
    const type = typeof value;
    if (type === 'string') {
      const s = value as string;
      return s.length > MAX_STRING ? s.slice(0, MAX_STRING) + '…' : s;
    }
    if (type === 'number' || type === 'boolean') return value;
    if (type === 'bigint') return String(value);
    if (type === 'function') return `[Function ${(value as Function).name || 'anonymous'}]`;
    if (type === 'symbol') return String(value);

    const v = value as any;
    if (is(v, C.MediaStreamTrack)) return describeTrack(v);
    if (is(v, C.MediaStream)) {
      return { __type: 'MediaStream', id: v.id, tracks: v.getTracks().map((t: MediaStreamTrack) => describeTrack(t)) };
    }
    if (is(v, C.RTCIceCandidate) || is(v, C.RTCSessionDescription)) return v.toJSON();
    if (is(v, C.RTCRtpSender)) return { __type: 'RTCRtpSender', track: describeTrack(v.track) };
    if (is(v, C.RTCRtpReceiver)) return { __type: 'RTCRtpReceiver', track: describeTrack(v.track) };
    if (is(v, C.RTCRtpTransceiver)) {
      return {
        __type: 'RTCRtpTransceiver',
        mid: v.mid,
        direction: v.direction,
        currentDirection: v.currentDirection,
        kind: v.receiver?.track?.kind
      };
    }
    if (is(v, C.RTCDataChannel)) return { __type: 'RTCDataChannel', label: v.label, id: v.id };
    if (is(v, C.RTCCertificate)) return { __type: 'RTCCertificate', expires: v.expires };
    if (v instanceof ArrayBuffer) return { __type: 'ArrayBuffer', byteLength: v.byteLength };
    if (ArrayBuffer.isView(v)) return { __type: v.constructor?.name ?? 'ArrayBufferView', byteLength: v.byteLength };
    if (is(v, C.Blob)) return { __type: 'Blob', size: v.size, type: v.type };
    if (v instanceof Error || (typeof v.name === 'string' && typeof v.message === 'string' && 'stack' in v)) {
      return { name: v.name, message: v.message };
    }
    if (depth >= MAX_DEPTH) return '[…]';
    if (Array.isArray(v)) {
      const out = v.slice(0, MAX_ARRAY).map((x) => serialize(x, depth + 1));
      if (v.length > MAX_ARRAY) out.push(`… ${v.length - MAX_ARRAY} more`);
      return out;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null && typeof v.toJSON === 'function') {
      return serialize(v.toJSON(), depth + 1);
    }
    const out: Record<string, unknown> = {};
    let n = 0;
    // for..in includes inherited getters of dictionary-like objects (e.g. RTCRtpSendParameters is plain though).
    for (const key in v) {
      if (n++ >= MAX_KEYS) {
        out['…'] = 'truncated';
        break;
      }
      const x = v[key];
      if (typeof x === 'function') continue;
      out[key] = serialize(x, depth + 1);
    }
    return out;
  } catch {
    return '[Unserializable]';
  }
}

export function errorInfo(err: unknown): { name: string; message: string; constraint?: string } {
  try {
    const e = err as any;
    if (e && typeof e === 'object') {
      const info: { name: string; message: string; constraint?: string } = {
        name: String(e.name ?? 'Error'),
        message: String(e.message ?? e)
      };
      if (typeof e.constraint === 'string') info.constraint = e.constraint;
      return info;
    }
    return { name: 'Error', message: String(err) };
  } catch {
    return { name: 'Error', message: '[unknown error]' };
  }
}

/** Serializes an RTCConfiguration while hiding TURN credentials. */
export function maskConfig(config: unknown): unknown {
  const out = serialize(config) as any;
  if (out && typeof out === 'object' && Array.isArray(out.iceServers)) {
    out.iceServers = out.iceServers.map((s: any) =>
      s && typeof s === 'object' && 'credential' in s && s.credential != null ? { ...s, credential: '***' } : s
    );
  }
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const TEXT_PREVIEW = 4000;
const BINARY_PREVIEW = 64;

export function previewData(data: unknown): { size: number; binary: boolean; preview: string; truncated: boolean } {
  try {
    if (typeof data === 'string') {
      return {
        size: data.length,
        binary: false,
        preview: data.length > TEXT_PREVIEW ? data.slice(0, TEXT_PREVIEW) : data,
        truncated: data.length > TEXT_PREVIEW
      };
    }
    let bytes: Uint8Array | null = null;
    let size = 0;
    if (data instanceof ArrayBuffer) {
      size = data.byteLength;
      bytes = new Uint8Array(data, 0, Math.min(size, BINARY_PREVIEW));
    } else if (ArrayBuffer.isView(data)) {
      size = data.byteLength;
      bytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(size, BINARY_PREVIEW));
    } else if (is(data, C.Blob)) {
      size = (data as Blob).size;
      return { size, binary: true, preview: `[Blob ${(data as Blob).type || ''}]`, truncated: false };
    }
    if (bytes) {
      let hex = '';
      for (let i = 0; i < bytes.length; i++) hex += (i ? ' ' : '') + HEX[bytes[i]];
      return { size, binary: true, preview: hex, truncated: size > BINARY_PREVIEW };
    }
    return { size: 0, binary: false, preview: String(data), truncated: false };
  } catch {
    return { size: 0, binary: false, preview: '[unreadable]', truncated: false };
  }
}
