// Gathers candidates against the given ICE servers from the panel itself (like the
// "Trickle ICE" sample page) to check whether STUN/TURN servers work.
import { parseCandidate, type ParsedCandidate } from './ice';

export interface TurnTestResult {
  candidates: (ParsedCandidate & { url?: string; ms: number })[];
  errors: { url: string; errorCode: number; errorText: string; ms: number }[];
  durationMs: number;
  timedOut: boolean;
  verdict: { ok: boolean; text: string }[];
}

export async function runTurnTest(
  servers: RTCIceServer[],
  opts: { relayOnly: boolean; timeoutMs: number },
  onProgress?: (r: TurnTestResult) => void
): Promise<TurnTestResult> {
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const result: TurnTestResult = { candidates: [], errors: [], durationMs: 0, timedOut: false, verdict: [] };
  const pc = new RTCPeerConnection({ iceServers: servers, iceTransportPolicy: opts.relayOnly ? 'relay' : 'all', iceCandidatePoolSize: 0 });
  try {
    pc.createDataChannel('turn-test');
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        result.timedOut = true;
        resolve();
      }, opts.timeoutMs);
      pc.onicecandidate = (e) => {
        if (!e.candidate) {
          clearTimeout(timer);
          resolve();
          return;
        }
        const c = e.candidate.candidate ? parseCandidate(e.candidate.candidate) : null;
        if (c) {
          result.candidates.push({ ...c, url: (e.candidate as any).url ?? undefined, ms: ms() });
          onProgress?.({ ...result, durationMs: ms() });
        }
      };
      pc.onicecandidateerror = (e) => {
        const ev = e as RTCPeerConnectionIceErrorEvent;
        result.errors.push({ url: ev.url, errorCode: ev.errorCode, errorText: ev.errorText, ms: ms() });
        onProgress?.({ ...result, durationMs: ms() });
      };
      pc.createOffer().then((o) => pc.setLocalDescription(o));
    });
  } finally {
    pc.close();
  }
  result.durationMs = ms();
  result.verdict = verdict(servers, result);
  return result;
}

export function verdict(servers: RTCIceServer[], r: Pick<TurnTestResult, 'candidates' | 'errors'>): { ok: boolean; text: string }[] {
  const urls = servers.flatMap((s) => (Array.isArray(s.urls) ? s.urls : [s.urls]));
  const out: { ok: boolean; text: string }[] = [];
  const turn = urls.filter((u) => /^turns?:/i.test(u));
  const stun = urls.filter((u) => /^stun:/i.test(u));
  const relays = r.candidates.filter((c) => c.type === 'relay');
  const srflx = r.candidates.filter((c) => c.type === 'srflx');
  if (turn.length) {
    if (relays.length) {
      const protos = [...new Set(relays.map((c) => c.protocol))].join('/');
      out.push({ ok: true, text: `TURN works: ${relays.length} relay candidate(s) (${protos}), first after ${Math.min(...relays.map((c) => c.ms))} ms` });
    } else {
      const auth = r.errors.find((e) => e.errorCode === 401 || e.errorCode === 441);
      out.push({
        ok: false,
        text: auth ? 'TURN rejected the credentials (401). Check username/credential and their expiry.' : 'No relay candidate: TURN server unreachable, wrong URL/port, or blocked by the network.'
      });
    }
  }
  if (stun.length) {
    out.push(
      srflx.length
        ? { ok: true, text: `STUN works: public address ${srflx[0].address}` }
        : { ok: false, text: 'No server-reflexive candidate: STUN unreachable (or UDP blocked).' }
    );
  }
  if (!urls.length) out.push({ ok: false, text: 'Enter at least one stun: or turn: URL.' });
  return out;
}

/** Parses "one URL per line" input into RTCIceServer entries sharing the same credentials. */
export function serversFromInput(text: string, username: string, credential: string): RTCIceServer[] {
  const urls = text
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter((u) => /^(stun|turns?):/i.test(u));
  const stun = urls.filter((u) => /^stun:/i.test(u));
  const turn = urls.filter((u) => /^turns?:/i.test(u));
  const servers: RTCIceServer[] = [];
  if (stun.length) servers.push({ urls: stun });
  if (turn.length) servers.push({ urls: turn, username, credential });
  return servers;
}
