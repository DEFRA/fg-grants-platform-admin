export type DiffLine =
  | {
      kind: "same" | "add" | "del";
      before?: number;
      after?: number;
      text: string;
    }
  | { kind: "gap"; count: number; text: string };

export interface Diff {
  lines: DiffLine[];
  added: number;
  removed: number;
  tooLarge?: boolean;
}

export const DIFF_LIMIT = 2_000_000;
export const DIFF_EDGE = 100;

const foldRuns = (lines: DiffLine[]): DiffLine[] => {
  const out: DiffLine[] = [];
  for (let k = 0; k < lines.length;) {
    const kind = lines[k].kind;
    let e = k;
    while (e < lines.length && lines[e].kind === kind) e++;
    if ((kind === "add" || kind === "del") && e - k > 2 * DIFF_EDGE) {
      const count = e - k - 2 * DIFF_EDGE;
      out.push(...lines.slice(k, k + DIFF_EDGE), {
        kind: "gap",
        count,
        text: `${count.toLocaleString("en-GB")} more ${count === 1 ? "line" : "lines"} ${kind === "add" ? "added" : "removed"}`,
      });
      out.push(...lines.slice(e - DIFF_EDGE, e));
    } else out.push(...lines.slice(k, e));
    k = e;
  }
  return out;
};

export const diffLines = (
  before: string,
  after: string,
  context: number | false = 3,
): Diff => {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  )
    tail++;
  const n = a.length - head - tail;
  const m = b.length - head - tail;
  const ops: Exclude<DiffLine, { kind: "gap" }>[] = [];
  for (let k = 0; k < head; k++)
    ops.push({ kind: "same", before: k + 1, after: k + 1, text: a[k] });
  const tooLarge = (n + 1) * (m + 1) > DIFF_LIMIT;
  if (tooLarge) {
    for (let k = 0; k < n; k++)
      ops.push({ kind: "del", before: head + k + 1, text: a[head + k] });
    for (let k = 0; k < m; k++)
      ops.push({ kind: "add", after: head + k + 1, text: b[head + k] });
  } else {
    const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        t[i][j] =
          a[head + i] === b[head + j]
            ? t[i + 1][j + 1] + 1
            : Math.max(t[i + 1][j], t[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[head + i] === b[head + j]) {
        i++;
        j++;
        ops.push({
          kind: "same",
          before: head + i,
          after: head + j,
          text: a[head + i - 1],
        });
      } else if (i < n && (j >= m || t[i + 1][j] >= t[i][j + 1])) {
        i++;
        ops.push({ kind: "del", before: head + i, text: a[head + i - 1] });
      } else {
        j++;
        ops.push({ kind: "add", after: head + j, text: b[head + j - 1] });
      }
    }
  }
  for (let k = 0; k < tail; k++)
    ops.push({
      kind: "same",
      before: a.length - tail + k + 1,
      after: b.length - tail + k + 1,
      text: a[a.length - tail + k],
    });
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  if (context === false)
    return { lines: tooLarge ? foldRuns(ops) : ops, added, removed, tooLarge };
  const keep = ops.map((_, k) => {
    for (
      let x = Math.max(0, k - context);
      x <= Math.min(ops.length - 1, k + context);
      x++
    )
      if (ops[x].kind !== "same") return true;
    return false;
  });
  const lines: DiffLine[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      lines.push(ops[k]);
      continue;
    }
    const start = k;
    while (k < ops.length && !keep[k]) k++;
    const count = k - start;
    lines.push({
      kind: "gap",
      count,
      text: `${count} unchanged ${count === 1 ? "line" : "lines"}`,
    });
    k--;
  }
  return {
    lines: tooLarge ? foldRuns(lines) : lines,
    added,
    removed,
    tooLarge,
  };
};
