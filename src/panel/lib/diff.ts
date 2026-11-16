export type DiffLine = { op: 'same' | 'add' | 'del'; text: string; a?: number; b?: number };

/** Line diff via LCS. SDPs are small (hundreds of lines), so O(n·m) is fine. */
export function diffLines(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 25_000_000) {
    // Too large: fall back to a trivial diff.
    return [...a.map((text, i) => ({ op: 'del' as const, text, a: i })), ...b.map((text, j) => ({ op: 'add' as const, text, b: j }))];
  }
  const lcs: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', text: a[i], a: i, b: j });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ op: 'del', text: a[i], a: i++ });
    } else {
      out.push({ op: 'add', text: b[j], b: j++ });
    }
  }
  while (i < n) out.push({ op: 'del', text: a[i], a: i++ });
  while (j < m) out.push({ op: 'add', text: b[j], b: j++ });
  return out;
}

export function diffStats(lines: DiffLine[]) {
  let added = 0;
  let removed = 0;
  for (const l of lines) {
    if (l.op === 'add') added++;
    else if (l.op === 'del') removed++;
  }
  return { added, removed };
}
