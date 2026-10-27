/**
 * merge3.ts
 *
 * Line-based three-way merge ("diff3"), built on our own Myers diff.
 *
 * Given a common ancestor (base) and two edited versions (ours, theirs), it
 * keeps changes made on only one side, accepts identical changes made on both
 * sides, and reports a conflict where both sides changed the same region
 * differently. Changes that touch (are adjacent) also count as a conflict, the
 * same rule Git's merge uses.
 */

import { diffLines } from "./myersDiff";

export type MergeSegment =
  | { type: "ok"; lines: string[] }
  | { type: "conflict"; base: string[]; ours: string[]; theirs: string[] };

export interface Merge3Result {
  segments: MergeSegment[];
  conflicts: number;
  /** True if a diff was too large to align exactly. */
  approximate: boolean;
}

interface Change {
  bs: number; // base range [bs, be)
  be: number;
  xs: number; // other version's range [xs, xe)
  xe: number;
}

function changesOf(base: string[], other: string[]): { changes: Change[]; approximate: boolean } {
  const result = diffLines(base, other);
  const changes: Change[] = [];
  let bi = 0;
  let xi = 0;
  let cur: Change | null = null;
  for (const op of result.ops) {
    if (op.type === "equal") {
      if (cur) {
        changes.push(cur);
        cur = null;
      }
      bi++;
      xi++;
    } else {
      if (!cur) cur = { bs: bi, be: bi, xs: xi, xe: xi };
      if (op.type === "delete") cur.be = ++bi;
      else cur.xe = ++xi;
    }
  }
  if (cur) changes.push(cur);
  return { changes, approximate: !!result.approximate };
}

function applyGroup(base: string[], other: string[], changes: Change[], start: number, end: number): string[] {
  const out: string[] = [];
  let cursor = start;
  for (const c of changes) {
    out.push(...base.slice(cursor, c.bs), ...other.slice(c.xs, c.xe));
    cursor = c.be;
  }
  out.push(...base.slice(cursor, end));
  return out;
}

const same = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

export function merge3(base: string[], ours: string[], theirs: string[]): Merge3Result {
  const O = changesOf(base, ours);
  const T = changesOf(base, theirs);
  const segments: MergeSegment[] = [];
  let ok: string[] = [];
  let conflicts = 0;

  const flush = () => {
    if (ok.length) segments.push({ type: "ok", lines: ok });
    ok = [];
  };

  let pos = 0;
  let i = 0;
  let j = 0;
  while (i < O.changes.length || j < T.changes.length) {
    const a = O.changes[i];
    const b = T.changes[j];

    if (a && (!b || a.be < b.bs)) {
      ok.push(...base.slice(pos, a.bs), ...ours.slice(a.xs, a.xe));
      pos = a.be;
      i++;
      continue;
    }
    if (b && (!a || b.be < a.bs)) {
      ok.push(...base.slice(pos, b.bs), ...theirs.slice(b.xs, b.xe));
      pos = b.be;
      j++;
      continue;
    }

    // Overlapping or touching changes on both sides: grow the region until nothing else touches it.
    const gi = i;
    const gj = j;
    const start = Math.min(a.bs, b.bs);
    let end = Math.max(a.be, b.be);
    i++;
    j++;
    for (;;) {
      let grew = false;
      if (i < O.changes.length && O.changes[i].bs <= end) {
        end = Math.max(end, O.changes[i++].be);
        grew = true;
      }
      if (j < T.changes.length && T.changes[j].bs <= end) {
        end = Math.max(end, T.changes[j++].be);
        grew = true;
      }
      if (!grew) break;
    }

    ok.push(...base.slice(pos, start));
    const o = applyGroup(base, ours, O.changes.slice(gi, i), start, end);
    const t = applyGroup(base, theirs, T.changes.slice(gj, j), start, end);

    if (same(o, t)) {
      ok.push(...o); // both sides made the identical change
    } else {
      // Lines the two sides still agree on at the edges are not part of the conflict.
      let pre = 0;
      while (pre < o.length && pre < t.length && o[pre] === t[pre]) pre++;
      let suf = 0;
      while (suf < o.length - pre && suf < t.length - pre && o[o.length - 1 - suf] === t[t.length - 1 - suf]) suf++;
      ok.push(...o.slice(0, pre));
      flush();
      segments.push({
        type: "conflict",
        base: base.slice(start, end),
        ours: o.slice(pre, o.length - suf),
        theirs: t.slice(pre, t.length - suf),
      });
      conflicts++;
      ok.push(...o.slice(o.length - suf));
    }
    pos = end;
  }

  ok.push(...base.slice(pos));
  flush();
  return { segments, conflicts, approximate: O.approximate || T.approximate };
}

/** The merged text when there are no conflicts. */
export function mergedLines(result: Merge3Result): string[] {
  return result.segments.flatMap((s) => (s.type === "ok" ? s.lines : s.ours));
}
