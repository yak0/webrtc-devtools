import type { TraceEvent } from '@/shared/protocol';
import type { PcModel } from '../store/session';
import { candidates, iceServerUrls, selectedPair } from './ice';
import type { StatsTimeline } from './stats-timeline';

export type InsightLevel = 'error' | 'warning' | 'info' | 'success';

export interface Insight {
  id: string;
  level: InsightLevel;
  title: string;
  detail?: string;
  /** Extra lines (e.g. one per failing server), shown when the insight is expanded. */
  items?: string[];
}

const TURN_ERROR_HINTS: Record<number, string> = {
  401: 'Unauthorized: wrong or expired TURN credentials.',
  403: 'Forbidden: the TURN server rejected this peer.',
  437: 'Allocation mismatch.',
  438: 'Stale nonce.',
  441: 'Wrong credentials.',
  442: 'Unsupported transport protocol.',
  486: 'Allocation quota reached.',
  508: 'Insufficient capacity on the TURN server.',
  701: 'Server unreachable: DNS failure, blocked port or wrong URL.'
};

function recentAvg(stats: StatsTimeline, id: string, field: string, n = 5): number | null {
  const arr = stats.series.get(id)?.get(field);
  if (!arr || arr.length !== stats.times.length) return null;
  const vals = arr.slice(-n).filter((v): v is number => typeof v === 'number');
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function lastEvent(events: TraceEvent[], name: string): TraceEvent | undefined {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].name === name) return events[i];
  return undefined;
}

export function computeInsights(pc: PcModel, now = Date.now()): Insight[] {
  const out: Insight[] = [];
  const config = (pc.info.effectiveConfig ?? pc.info.config) as any;
  const servers = iceServerUrls(config).flatMap((s) => s.urls);
  const turnServers = servers.filter((u) => /^turns?:/i.test(u));
  const cands = candidates(pc.stats, pc.events);
  const local = cands.filter((c) => c.side === 'local');
  const remote = cands.filter((c) => c.side === 'remote');
  const relayGathered = local.some((c) => c.type === 'relay');
  const states = pc.states;

  // --- failures in API calls ----------------------------------------------------------
  const failed = new Map<string, TraceEvent>();
  for (const ev of pc.events) if (ev.kind === 'call' && ev.error) failed.set(`${ev.name}:${ev.error.message}`, ev);
  for (const ev of failed.values()) {
    out.push({
      id: `call-error-${ev.name}-${ev.seq}`,
      level: 'error',
      title: `${ev.name}() failed: ${ev.error!.name}`,
      detail: ev.error!.message
    });
  }

  // --- ICE / TURN ---------------------------------------------------------------------
  // Chrome reports one icecandidateerror per (server URL × local network interface), so a
  // single unreachable TURN server easily produces 5+ errors. Collapse them per URL and drop
  // URLs that produced a candidate through another interface.
  const workedUrls = new Set<string>();
  for (const c of pc.stats.byType('local-candidate')) if (typeof c.url === 'string' && c.url) workedUrls.add(c.url);
  const byUrl = new Map<string, { url: string; codes: Set<number>; texts: Set<string> }>();
  for (const ev of pc.events) {
    if (ev.name !== 'icecandidateerror' || !ev.value) continue;
    const v = ev.value as any;
    const url = String(v.url || 'unknown server');
    if (workedUrls.has(url)) continue;
    const g = byUrl.get(url) ?? { url, codes: new Set<number>(), texts: new Set<string>() };
    g.codes.add(Number(v.errorCode));
    if (v.errorText) g.texts.add(String(v.errorText));
    byUrl.set(url, g);
  }
  const describe = (g: { url: string; codes: Set<number>; texts: Set<string> }) => {
    const codes = [...g.codes];
    const hint = codes.map((c) => TURN_ERROR_HINTS[c]).find(Boolean);
    // "Address not associated…" only means one local interface could not be used; prefer the real reason.
    const texts = [...g.texts].filter((t) => !/not associated with the desired network interface/i.test(t));
    return `${g.url} — ${codes.join('/')}${texts.length ? ` ${texts.join('; ')}` : ''}${hint ? ` (${hint})` : ''}`;
  };
  const turnErrors = [...byUrl.values()].filter((g) => /^turns?:/i.test(g.url));
  const otherErrors = [...byUrl.values()].filter((g) => !/^turns?:/i.test(g.url));
  const connected = states.connectionState === 'connected' || states.iceConnectionState === 'connected' || states.iceConnectionState === 'completed';

  if (states.iceConnectionState === 'failed' || states.connectionState === 'failed') {
    if (turnServers.length === 0) {
      out.push({
        id: 'ice-failed-no-turn',
        level: 'error',
        title: 'ICE failed and no TURN server is configured',
        detail:
          'Peers behind symmetric NATs or strict firewalls cannot connect directly. Add a TURN server (ideally also turns:443) to iceServers.'
      });
    } else if (!relayGathered) {
      out.push({
        id: 'ice-failed-no-relay',
        level: 'error',
        title: 'ICE failed: TURN is configured but no relay candidate was gathered',
        detail: 'The TURN server was not reachable or rejected the credentials.',
        items: turnErrors.map(describe)
      });
    } else if (remote.length === 0) {
      out.push({
        id: 'ice-failed-no-remote',
        level: 'error',
        title: 'ICE failed: no remote candidates were received',
        detail: 'Remote candidates never reached addIceCandidate() and the remote SDP had none. Check your signaling.'
      });
    } else {
      out.push({
        id: 'ice-failed',
        level: 'error',
        title: 'ICE failed although candidates were exchanged on both sides',
        detail: 'Connectivity checks between all candidate pairs failed. Check the candidate pairs in the ICE tab.'
      });
    }
  } else if (turnServers.length > 0 && states.iceGatheringState === 'complete' && !relayGathered) {
    out.push({
      id: 'turn-no-relay',
      level: 'warning',
      title: `TURN unreachable: no relay candidate from ${turnServers.length} TURN URL${turnServers.length > 1 ? 's' : ''}`,
      detail: connected
        ? 'This call connected without TURN, but users on restrictive networks would fail. Check the TURN URL, port and credentials.'
        : 'Users on restrictive networks will not be able to connect. Check the TURN URL, port and credentials.',
      items: turnErrors.map(describe)
    });
  } else if (turnErrors.length) {
    // Some TURN URLs failed but relay candidates exist through others: informational.
    out.push({
      id: 'turn-partial',
      level: 'info',
      title: `${turnErrors.length} of ${turnServers.length} TURN URLs failed (others work)`,
      items: turnErrors.map(describe)
    });
  }
  if (otherErrors.length) {
    out.push({
      id: 'stun-errors',
      level: 'info',
      title: `${otherErrors.length} STUN server${otherErrors.length > 1 ? 's' : ''} unreachable`,
      items: otherErrors.map(describe)
    });
  }

  if (states.iceGatheringState === 'complete' && local.length === 0) {
    out.push({ id: 'no-local-candidates', level: 'warning', title: 'ICE gathering finished without any local candidate' });
  }

  if (
    (states.iceConnectionState === 'checking' || states.iceConnectionState === 'new') &&
    remote.length === 0 &&
    pc.events.some((e) => e.name === 'setRemoteDescription' && !e.error && !e.pending)
  ) {
    const srd = lastEvent(pc.events, 'setRemoteDescription');
    if (srd && now - srd.ts > 3000) {
      out.push({
        id: 'no-remote-candidates',
        level: 'warning',
        title: 'No remote ICE candidates yet',
        detail: 'The remote description was applied but no candidate arrived via addIceCandidate(). Is trickle ICE wired up?'
      });
    }
  }

  if (pc.states.signalingState === 'have-local-offer') {
    const sld = lastEvent(pc.events, 'setLocalDescription');
    if (sld && now - sld.ts > 10_000) {
      out.push({
        id: 'waiting-answer',
        level: 'warning',
        title: `Waiting for an answer for ${Math.round((now - sld.ts) / 1000)}s`,
        detail: 'The local offer was applied but setRemoteDescription(answer) was never called.'
      });
    }
  }

  // --- transport / DTLS ------------------------------------------------------------------
  for (const t of pc.stats.byType('transport')) {
    if (t.dtlsState === 'failed') {
      out.push({ id: 'dtls-failed', level: 'error', title: 'DTLS handshake failed', detail: 'Check certificate fingerprints in the SDP (a=fingerprint) and a=setup roles.' });
    }
  }

  const pair = selectedPair(pc.stats);
  if (pair) {
    const lt = pair.local?.candidateType;
    const rt = pair.remote?.candidateType;
    const relayProto = pair.local?.relayProtocol as string | undefined;
    if (lt === 'relay' || rt === 'relay') {
      const viaTcp = relayProto === 'tcp' || relayProto === 'tls';
      out.push({
        id: 'relayed',
        level: viaTcp ? 'warning' : 'info',
        title: `Media is relayed through TURN${relayProto ? ` (${relayProto})` : ''}`,
        detail: viaTcp
          ? 'TURN over TCP/TLS adds latency and head-of-line blocking; UDP is probably blocked on this network.'
          : 'A direct path was not selected. This is fine but adds a hop and TURN server cost.'
      });
    } else if (states.connectionState === 'connected') {
      out.push({
        id: 'direct',
        level: 'success',
        title: `Connected directly (${lt ?? '?'} ↔ ${rt ?? '?'}, ${pair.local?.protocol ?? ''})`
      });
    }
    if (pair.rtt !== null && pair.rtt > 0.3) {
      out.push({ id: 'high-rtt', level: 'warning', title: `High round-trip time: ${Math.round(pair.rtt * 1000)} ms` });
    }
  }

  // --- media quality --------------------------------------------------------------------
  for (const o of pc.stats.byType('outbound-rtp')) {
    const id = String(o.id);
    const reason = o.qualityLimitationReason as string | undefined;
    if (o.kind === 'video' && reason && reason !== 'none') {
      out.push({
        id: `limited-${id}`,
        level: 'warning',
        title: `Outgoing video${o.rid ? ` (rid ${o.rid})` : ''} is limited by ${reason}`,
        detail:
          reason === 'cpu'
            ? 'The encoder lowers resolution/framerate because the CPU is overloaded.'
            : reason === 'bandwidth'
              ? 'The estimated bandwidth is too low for the configured quality.'
              : undefined
      });
    }
  }
  for (const i of pc.stats.byType('inbound-rtp')) {
    const id = String(i.id);
    const loss = recentAvg(pc.stats, id, '[packetLoss%]');
    if (loss !== null && loss > 5) {
      out.push({ id: `loss-${id}`, level: 'warning', title: `Incoming ${i.kind} packet loss ${loss.toFixed(1)}%` });
    }
    if (i.kind === 'video') {
      const fps = recentAvg(pc.stats, id, 'framesPerSecond');
      if (fps !== null && fps > 0 && fps < 10) {
        out.push({ id: `fps-${id}`, level: 'warning', title: `Incoming video at only ${fps.toFixed(1)} fps` });
      }
      const freezes = recentAvg(pc.stats, id, '[freezeCount/s]', 10);
      if (freezes !== null && freezes > 0) {
        out.push({ id: `freeze-${id}`, level: 'warning', title: 'Incoming video is freezing' });
      }
    }
  }
  for (const s of pc.stats.byType('media-source')) {
    if (s.kind !== 'audio') continue;
    const level = recentAvg(pc.stats, String(s.id), 'audioLevel', 10);
    if (level !== null && level === 0 && pc.stats.times.length >= 10) {
      out.push({ id: `silent-${s.id}`, level: 'info', title: 'Microphone input is completely silent', detail: 'The track may be muted, disabled, or the wrong device is selected.' });
    }
  }

  // --- lifecycle --------------------------------------------------------------------------
  if (pc.collected) {
    out.push({
      id: 'gc-without-close',
      level: 'warning',
      title: 'RTCPeerConnection was garbage collected without close()',
      detail: 'Always call pc.close(); unclosed connections keep sockets and threads alive until GC.'
    });
  }
  if (config?.iceTransportPolicy === 'relay') {
    out.push({ id: 'relay-only', level: 'info', title: 'iceTransportPolicy is "relay": only TURN candidates are used' });
  }

  const order: Record<InsightLevel, number> = { error: 0, warning: 1, info: 2, success: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
