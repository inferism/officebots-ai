// Small unified-diff generator (no dependency), used to show a settings change before it is written.

type Op = { kind: " " | "-" | "+"; text: string };

/** Line-level diff by longest common subsequence. Files here are small, so O(n*m) is fine. */
function diffLines(a: string[], b: string[]): Op[] {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) ops.push({ kind: " ", text: a[i++]! }), j++;
    else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) ops.push({ kind: "-", text: a[i++]! });
    else ops.push({ kind: "+", text: b[j++]! });
  }
  while (i < n) ops.push({ kind: "-", text: a[i++]! });
  while (j < m) ops.push({ kind: "+", text: b[j++]! });
  return ops;
}

const split = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));

/** Unified diff of two texts. Returns "" when they are identical. */
export function unifiedDiff(before: string, after: string, labelBefore: string, labelAfter: string, context = 3): string {
  if (before === after) return "";
  const ops = diffLines(split(before), split(after));
  const changed = ops.flatMap((o, i) => (o.kind === " " ? [] : [i]));
  if (changed.length === 0) return ""; // only a trailing-newline difference
  // group changes that are close enough to share context into hunks
  const hunks: [number, number][] = [];
  for (const idx of changed) {
    const last = hunks[hunks.length - 1];
    if (last && idx - last[1] <= context * 2 + 1) last[1] = idx;
    else hunks.push([idx, idx]);
  }
  const out = [`--- ${labelBefore}`, `+++ ${labelAfter}`];
  for (const [first, last] of hunks) {
    const start = Math.max(0, first - context);
    const end = Math.min(ops.length - 1, last + context);
    const slice = ops.slice(start, end + 1);
    const before0 = ops.slice(0, start).filter((o) => o.kind !== "+").length;
    const after0 = ops.slice(0, start).filter((o) => o.kind !== "-").length;
    const bc = slice.filter((o) => o.kind !== "+").length;
    const ac = slice.filter((o) => o.kind !== "-").length;
    out.push(`@@ -${bc === 0 ? before0 : before0 + 1},${bc} +${ac === 0 ? after0 : after0 + 1},${ac} @@`);
    for (const o of slice) out.push(o.kind + o.text);
  }
  return out.join("\n") + "\n";
}
