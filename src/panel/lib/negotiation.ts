// Explains codec negotiation: what was offered, what the answer kept, what is actually used.
import type { TraceEvent } from '@/shared/protocol';
import { isAuxCodec, parseSdp, type SdpCodec } from './sdp';
import { sdpHistory } from './sdp-history';
import type { StatsTimeline } from './stats-timeline';

export interface MidNegotiation {
  mid: string;
  kind: string;
  offered: string[];
  answered: string[];
  removed: string[];
  /** Codec names in use according to getStats(), per direction. */
  sending?: string;
  receiving?: string;
  preferencesCalled: boolean;
  notes: string[];
}

function codecLabel(c: SdpCodec): string {
  if (/^h264$/i.test(c.name)) {
    const profile = /profile-level-id=([0-9a-f]{6})/i.exec(c.fmtp ?? '')?.[1];
    const mode = /packetization-mode=(\d)/.exec(c.fmtp ?? '')?.[1];
    return `H264${profile ? ` ${profile}` : ''}${mode ? ` pm${mode}` : ''}`;
  }
  if (/^vp9$/i.test(c.name)) {
    const p = /profile-id=(\d)/.exec(c.fmtp ?? '')?.[1];
    return p && p !== '0' ? `VP9 p${p}` : 'VP9';
  }
  return c.name;
}

function uniq(list: string[]): string[] {
  return [...new Set(list)];
}

export function explainNegotiation(events: TraceEvent[], stats: StatsTimeline): MidNegotiation[] {
  const history = sdpHistory(events).filter((h) => h.applied && h.sdp);
  // The latest applied offer/answer pair, whichever side made it.
  const answer = [...history].reverse().find((h) => h.type === 'answer' || h.type === 'pranswer');
  if (!answer) return [];
  const offer = [...history].reverse().find((h) => h.type === 'offer' && h.seq < answer.seq && h.side !== answer.side);
  if (!offer) return [];
  const o = parseSdp(offer.sdp);
  const a = parseSdp(answer.sdp);

  const codecIdToName = (id: unknown) => {
    const c = stats.current.get(String(id));
    return c ? String(c.mimeType ?? '').split('/')[1] : undefined;
  };
  const used = (type: string, mid: string) => {
    const s = stats.byType(type).find((x) => String(x.mid) === mid && x.codecId);
    return s ? codecIdToName(s.codecId) : undefined;
  };
  const prefsMids = new Set(
    events.filter((e) => e.name === 'setCodecPreferences').map((e) => /mid=([^)]+)/.exec(e.target ?? '')?.[1] ?? '?')
  );

  return o.media
    .filter((m) => m.kind === 'audio' || m.kind === 'video')
    .map((om) => {
      const am = a.media.find((x) => x.mid === om.mid) ?? a.media[om.index];
      const offered = uniq(om.codecs.filter((c) => c.name && !isAuxCodec(c.name)).map(codecLabel));
      const answered = am ? uniq(am.codecs.filter((c) => c.name && !isAuxCodec(c.name)).map(codecLabel)) : [];
      const removed = offered.filter((c) => !answered.includes(c));
      const mid = om.mid ?? String(om.index);
      const notes: string[] = [];
      if (am?.port === 0) notes.push('The answerer rejected this m-section (port 0).');
      if (answered.length) notes.push(`Senders use the first codec of the answer that both support: ${answered[0]}.`);
      if (removed.length) notes.push(`Not supported or not wanted by the answerer: ${removed.join(', ')}.`);
      if (offer.side === 'local') notes.push('This side made the offer; its codec order is a preference the answerer may reorder.');
      else notes.push('The remote side made the offer; this side answered with its supported subset.');
      return {
        mid,
        kind: om.kind,
        offered,
        answered,
        removed,
        sending: used('outbound-rtp', mid),
        receiving: used('inbound-rtp', mid),
        preferencesCalled: prefsMids.has(mid) || prefsMids.has('?'),
        notes
      };
    });
}
