/**
 * myersDiff.ts
 *
 * Line-level diffing using Eugene Myers' O(ND) algorithm ("An O(ND)
 * Difference Algorithm and Its Variations", 1986), which finds a
 * *minimal* edit script (fewest insertions + deletions) between two
 * sequences of lines.
 *
 * How it works: picture an edit graph where moving right deletes a line
 * from A, moving down inserts a line from B, and moving diagonally is
 * free when the lines match. Myers explores it in rounds d = 0, 1, 2...
 * (d = number of edits so far). For each diagonal k = x - y it remembers
 * the furthest x reachable with d edits. The first d that reaches the
 * bottom-right corner is the minimal edit distance; we then walk the saved
 * per-round snapshots backwards to recover the actual edit path.
 *
 * Two practical optimizations on top of the textbook version:
 *   1. Common prefix/suffix lines are trimmed first (most real diffs touch
 *      a small region of a large file).
 *   2. Only the live window of each round's furthest-reaching array is
 *      snapshotted (2d+3 entries instead of the whole array), and the
 *      edit distance is capped (see MAX_EDIT_DISTANCE) so memory stays
 *      bounded — beyond the cap we fall back to "replace the whole
 *      changed region" and flag the result as approximate.
 */

export type DiffOpType = "equal" | "insert" | "delete";

export interface DiffOp {
  type: DiffOpType;
  text: string;
  oldLine?: number; // 1-based, present for equal + delete
  newLine?: number; // 1-based, present for equal + insert
}

export interface DiffResult {
  ops: DiffOp[];
  /** True when the edit distance exceeded the cap and the changed region was replaced wholesale. */
  approximate: boolean;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: DiffOp[];
}

const MAX_EDIT_DISTANCE = 4000;

interface Edit {
  type: DiffOpType;
  a?: number; // index into A (equal, delete)
  b?: number; // index into B (insert)
}

/** Walks the saved snapshots backwards to reconstruct the edit path. */
function backtrack(trace: Int32Array[], n: number, m: number, finalD: number): Edit[] {
  let x = n;
  let y = m;
  const edits: Edit[] = [];

  for (let d = finalD; d >= 0; d--) {
    const snap = trace[d];
    const get = (k: number) => snap[k + d + 1];

    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && get(k - 1) < get(k + 1))) {
      prevK = k + 1; // we arrived by moving down (insert)
    } else {
      prevK = k - 1; // we arrived by moving right (delete)
    }

    const prevX = get(prevK);
    const prevY = prevX - prevK;

    // Unwind the diagonal "snake" of matching lines.
    while (x > prevX && y > prevY) {
      edits.push({ type: "equal", a: x - 1, b: y - 1 });
      x--;
      y--;
    }

    if (d > 0) {
      if (x === prevX) {
        edits.push({ type: "insert", b: prevY });
      } else {
        edits.push({ type: "delete", a: prevX });
      }
    }

    x = prevX;
    y = prevY;
  }

  return edits.reverse();
}

/** Core Myers search. Returns null if the edit distance exceeds `maxD`. */
function myers(a: string[], b: string[], maxD: number): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3); // v[off + k] = furthest x on diagonal k
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    // Snapshot the window of diagonals [-d-1, d+1] as of the end of round d-1.
    trace.push(v.slice(off - d - 1, off + d + 2));

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) {
        x = v[off + k + 1]; // step down from diagonal k+1
      } else {
        x = v[off + k - 1] + 1; // step right from diagonal k-1
      }
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[off + k] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, n, m, d);
      }
    }
  }

  return null;
}

/** Diffs two arrays of lines, returning an ordered list of equal/insert/delete ops. */
export function diffLines(a: string[], b: string[]): DiffResult {
  // 1. Trim the common prefix and suffix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  // 2. Diff the differing middle region.
  let edits: Edit[] | null;
  let approximate = false;

  if (midA.length === 0) {
    edits = midB.map((_, i) => ({ type: "insert" as const, b: i }));
  } else if (midB.length === 0) {
    edits = midA.map((_, i) => ({ type: "delete" as const, a: i }));
  } else {
    edits = myers(midA, midB, MAX_EDIT_DISTANCE);
    if (edits === null) {
      approximate = true;
      edits = [
        ...midA.map((_, i) => ({ type: "delete" as const, a: i })),
        ...midB.map((_, i) => ({ type: "insert" as const, b: i })),
      ];
    }
  }

  // 3. Stitch prefix + middle + suffix together with line numbers.
  const ops: DiffOp[] = [];
  let oldNo = 1;
  let newNo = 1;

  for (let i = 0; i < start; i++) {
    ops.push({ type: "equal", text: a[i], oldLine: oldNo++, newLine: newNo++ });
  }

  for (const e of edits) {
    if (e.type === "equal") {
      ops.push({ type: "equal", text: midA[e.a!], oldLine: oldNo++, newLine: newNo++ });
    } else if (e.type === "delete") {
      ops.push({ type: "delete", text: midA[e.a!], oldLine: oldNo++ });
    } else {
      ops.push({ type: "insert", text: midB[e.b!], newLine: newNo++ });
    }
  }

  for (let i = endA; i < a.length; i++) {
    ops.push({ type: "equal", text: a[i], oldLine: oldNo++, newLine: newNo++ });
  }

  return { ops, approximate };
}

/** Counts inserted and deleted lines in an op list. */
export function diffStats(ops: DiffOp[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const op of ops) {
    if (op.type === "insert") additions++;
    else if (op.type === "delete") deletions++;
  }
  return { additions, deletions };
}

/**
 * Groups ops into unified-diff-style hunks: each change plus `context`
 * unchanged lines on either side, merging hunks whose context overlaps.
 */
export function buildHunks(ops: DiffOp[], context = 3): Hunk[] {
  // Running counts of old/new lines consumed before each op.
  const oldBefore: number[] = new Array(ops.length + 1);
  const newBefore: number[] = new Array(ops.length + 1);
  oldBefore[0] = 0;
  newBefore[0] = 0;
  for (let i = 0; i < ops.length; i++) {
    oldBefore[i + 1] = oldBefore[i] + (ops[i].type !== "insert" ? 1 : 0);
    newBefore[i + 1] = newBefore[i] + (ops[i].type !== "delete" ? 1 : 0);
  }

  const ranges: [number, number][] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === "equal") continue;
    const from = Math.max(0, i - context);
    const to = Math.min(ops.length - 1, i + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) {
      last[1] = Math.max(last[1], to);
    } else {
      ranges.push([from, to]);
    }
  }

  return ranges.map(([from, to]) => {
    const slice = ops.slice(from, to + 1);
    return {
      oldStart: oldBefore[from] + 1,
      oldLines: oldBefore[to + 1] - oldBefore[from],
      newStart: newBefore[from] + 1,
      newLines: newBefore[to + 1] - newBefore[from],
      ops: slice,
    };
  });
}
