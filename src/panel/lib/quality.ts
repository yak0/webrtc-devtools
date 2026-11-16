// Estimated quality scores. These are heuristics for quick triage, not measurements.

export interface QualityScore {
  /** 1 (bad) .. 5 (excellent); audio uses the MOS scale (max ~4.5). */
  score: number;
  label: 'excellent' | 'good' | 'fair' | 'poor' | 'bad';
  reasons: string[];
}

function label(score: number): QualityScore['label'] {
  return score >= 4.2 ? 'excellent' : score >= 3.6 ? 'good' : score >= 3.1 ? 'fair' : score >= 2.6 ? 'poor' : 'bad';
}

/**
 * Audio MOS from a simplified ITU-T G.107 E-model.
 * Delay = RTT/2 + jitter buffer; packet loss uses Opus-like robustness (Bpl ≈ 10, Ie ≈ 0).
 */
export function audioMos(input: { rttMs?: number | null; jitterBufferMs?: number | null; lossPct?: number | null }): QualityScore {
  const reasons: string[] = [];
  const d = (input.rttMs ?? 0) / 2 + (input.jitterBufferMs ?? 0) + 20; // + packetization
  const id = 0.024 * d + (d > 177.3 ? 0.11 * (d - 177.3) : 0);
  const ppl = Math.max(0, input.lossPct ?? 0);
  const ieEff = (95 * ppl) / (ppl + 10);
  const r = Math.max(0, Math.min(100, 93.2 - id - ieEff));
  const mos = r <= 0 ? 1 : 1 + 0.035 * r + 7e-6 * r * (r - 60) * (100 - r);
  if (d > 177) reasons.push(`high delay (~${Math.round(d)} ms one-way)`);
  if (ppl >= 1) reasons.push(`${ppl.toFixed(1)}% packet loss`);
  const score = Math.max(1, Math.min(4.5, mos));
  return { score, label: label(score), reasons };
}

/** Video score: starts at 5 and subtracts penalties for visible problems. */
export function videoScore(input: {
  fps?: number | null;
  height?: number | null;
  lossPct?: number | null;
  freezesPerMin?: number | null;
  limitation?: string | null;
  rttMs?: number | null;
}): QualityScore {
  let s = 5;
  const reasons: string[] = [];
  const fps = input.fps ?? null;
  if (fps !== null) {
    if (fps < 10) {
      s -= 1.8;
      reasons.push(`${fps.toFixed(0)} fps`);
    } else if (fps < 20) {
      s -= 0.8;
      reasons.push(`${fps.toFixed(0)} fps`);
    }
  }
  const h = input.height ?? null;
  if (h !== null && h > 0) {
    if (h < 240) {
      s -= 1;
      reasons.push(`${h}p`);
    } else if (h < 360) {
      s -= 0.5;
      reasons.push(`${h}p`);
    }
  }
  const loss = input.lossPct ?? 0;
  if (loss > 1) {
    s -= Math.min(1.5, loss / 5);
    reasons.push(`${loss.toFixed(1)}% loss`);
  }
  const freezes = input.freezesPerMin ?? 0;
  if (freezes > 0) {
    s -= Math.min(1.5, freezes * 0.5);
    reasons.push(`${freezes.toFixed(1)} freezes/min`);
  }
  if (input.limitation && input.limitation !== 'none') {
    s -= 0.5;
    reasons.push(`limited by ${input.limitation}`);
  }
  if ((input.rttMs ?? 0) > 400) {
    s -= 0.4;
    reasons.push(`RTT ${Math.round(input.rttMs!)} ms`);
  }
  const score = Math.max(1, Math.min(5, s));
  return { score, label: label(score), reasons };
}

export function scoreTone(label: QualityScore['label']): 'success' | 'warning' | 'error' | 'info' {
  return label === 'excellent' || label === 'good' ? 'success' : label === 'fair' ? 'info' : label === 'poor' ? 'warning' : 'error';
}
