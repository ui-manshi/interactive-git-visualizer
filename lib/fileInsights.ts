/**
 * fileInsights.ts
 *
 * File history ("which commits changed this file?") and blame ("which commit
 * last changed each line?"), built on the object cache and our own Myers diff.
 * No renames are followed: a renamed file starts a new history at its new path.
 */

import { readCommit, blobAtPath } from "./objectCache";
import { readBlob, isBinary } from "./fileTree";
import { diffLines } from "./myersDiff";

// ----------------------------- file history --------------------------------

export interface FileHistoryEntry {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  status: "added" | "modified" | "deleted";
}

const HISTORY_SCAN_LIMIT = 30_000;
const HISTORY_RESULT_LIMIT = 300;

export function fileHistory(repoPath: string, fromHash: string, file: string) {
  const seen = new Set<string>([fromHash]);
  const queue: string[] = [fromHash];
  const found: FileHistoryEntry[] = [];
  let scanned = 0;
  let truncated = false;

  for (let qi = 0; qi < queue.length; qi++) {
    if (scanned >= HISTORY_SCAN_LIMIT) {
      truncated = true;
      break;
    }
    scanned++;
    const commit = readCommit(repoPath, queue[qi]);
    const cur = blobAtPath(repoPath, commit.tree, file);
    const parentBlobs = commit.parents.map((p) => blobAtPath(repoPath, readCommit(repoPath, p).tree, file));

    let status: FileHistoryEntry["status"] | null = null;
    if (commit.parents.length === 0) {
      if (cur) status = "added";
    } else if (cur) {
      // Changed relative to every parent (a merge that equals one parent is not a change to the file).
      if (parentBlobs.every((b) => !b || b.hash !== cur.hash)) {
        status = parentBlobs.every((b) => !b) ? "added" : "modified";
      }
    } else if (parentBlobs.every((b) => !!b)) {
      status = "deleted";
    }

    if (status) {
      found.push({
        hash: commit.hash,
        message: commit.message.split("\n")[0],
        author: commit.author.name,
        timestamp: commit.author.timestamp,
        status,
      });
    }

    for (const p of commit.parents) {
      if (!seen.has(p)) {
        seen.add(p);
        queue.push(p);
      }
    }
  }

  found.sort((a, b) => b.timestamp - a.timestamp);
  return {
    file,
    commits: found.slice(0, HISTORY_RESULT_LIMIT),
    totalChanges: found.length,
    scanned,
    truncated,
  };
}

// --------------------------------- blame -----------------------------------

const MAX_BLAME_LINES = 6000;
const MAX_BLAME_STEPS = 3000;

export function splitLines(buf: Buffer): string[] {
  const lines = buf.toString("utf8").split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export interface BlameResult {
  file: string;
  lines: { text: string; c: number }[];
  commits: { hash: string; author: string; timestamp: number; summary: string }[];
  /** True if a diff was too large to align exactly, or history was cut short. */
  approximate: boolean;
}

/**
 * Walks history backwards from `commitHash`. Every line starts as "suspect" in
 * that commit. For each commit, lines that also exist (per a Myers diff) in a
 * parent are handed to that parent; lines that exist in no parent were
 * introduced by this commit, so it gets the blame.
 */
export function blame(repoPath: string, commitHash: string, file: string): BlameResult {
  const head = readCommit(repoPath, commitHash);
  const headBlob = blobAtPath(repoPath, head.tree, file);
  if (!headBlob) throw new Error(`"${file}" does not exist at this commit`);

  const headBuf = readBlob(repoPath, headBlob.hash);
  if (isBinary(headBuf)) throw new Error("This is a binary file, so blame is not available.");
  const headLines = splitLines(headBuf);
  if (headLines.length > MAX_BLAME_LINES) {
    throw new Error(`This file has ${headLines.length.toLocaleString()} lines; blame is limited to ${MAX_BLAME_LINES.toLocaleString()}.`);
  }

  const linesCache = new Map<string, string[]>();
  const linesOf = (blobHash: string) => {
    let l = linesCache.get(blobHash);
    if (!l) {
      l = splitLines(readBlob(repoPath, blobHash));
      linesCache.set(blobHash, l);
    }
    return l;
  };

  const owner: (string | null)[] = new Array(headLines.length).fill(null);
  // commit -> (index of line in the final file -> index of that line in this commit's version)
  const pending = new Map<string, Map<number, number>>();
  pending.set(commitHash, new Map(headLines.map((_, i) => [i, i] as const)));

  let approximate = false;
  let steps = 0;

  while (pending.size > 0) {
    let best = "";
    let bestTs = -Infinity;
    for (const h of pending.keys()) {
      const ts = readCommit(repoPath, h).author.timestamp;
      if (ts > bestTs) {
        best = h;
        bestTs = ts;
      }
    }
    let suspects = pending.get(best)!;
    pending.delete(best);

    if (++steps > MAX_BLAME_STEPS) {
      // Out of budget: attribute what is left to where we stopped.
      approximate = true;
      for (const fi of suspects.keys()) owner[fi] = best;
      for (const [h, m] of pending) for (const fi of m.keys()) owner[fi] = h;
      break;
    }

    const commit = readCommit(repoPath, best);
    const cur = blobAtPath(repoPath, commit.tree, file);
    if (!cur) {
      for (const fi of suspects.keys()) owner[fi] = best;
      continue;
    }

    for (const parentHash of commit.parents) {
      if (suspects.size === 0) break;
      const pb = blobAtPath(repoPath, readCommit(repoPath, parentHash).tree, file);
      if (!pb) continue;

      let passed: Map<number, number>;
      if (pb.hash === cur.hash) {
        passed = suspects;
        suspects = new Map();
      } else {
        const result = diffLines(linesOf(pb.hash), linesOf(cur.hash));
        if (result.approximate) approximate = true;
        const toParent = new Map<number, number>();
        for (const op of result.ops) {
          if (op.type === "equal") toParent.set(op.newLine! - 1, op.oldLine! - 1);
        }
        passed = new Map();
        const rest = new Map<number, number>();
        for (const [fi, li] of suspects) {
          const pl = toParent.get(li);
          if (pl !== undefined) passed.set(fi, pl);
          else rest.set(fi, li);
        }
        suspects = rest;
      }

      const existing = pending.get(parentHash);
      if (existing) for (const [k, v] of passed) existing.set(k, v);
      else pending.set(parentHash, passed);
    }

    for (const fi of suspects.keys()) owner[fi] = best;
  }

  const index = new Map<string, number>();
  const commits: BlameResult["commits"] = [];
  const lines = headLines.map((text, i) => {
    const h = owner[i] ?? commitHash;
    let c = index.get(h);
    if (c === undefined) {
      const co = readCommit(repoPath, h);
      c = commits.length;
      index.set(h, c);
      commits.push({
        hash: h,
        author: co.author.name,
        timestamp: co.author.timestamp,
        summary: co.message.split("\n")[0],
      });
    }
    return { text: text.replace(/\r$/, ""), c };
  });

  return { file, lines, commits, approximate };
}
