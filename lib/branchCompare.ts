/**
 * branchCompare.ts
 *
 * Compares two commits (usually branch tips): which commits each side has that
 * the other lacks, where they diverged (the merge base), and which files each
 * side changed since then.
 */

import { readCommit, changedFiles } from "./objectCache";

const ANCESTOR_LIMIT = 100_000;
const LIST_LIMIT = 100;
const FILE_LIMIT = 300;

export function ancestors(repoPath: string, tip: string): { set: Set<string>; truncated: boolean } {
  const set = new Set<string>([tip]);
  const queue = [tip];
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    if (set.size >= ANCESTOR_LIMIT) {
      truncated = true;
      break;
    }
    for (const p of readCommit(repoPath, queue[i]).parents) {
      if (!set.has(p)) {
        set.add(p);
        queue.push(p);
      }
    }
  }
  return { set, truncated };
}

export interface CommitLite {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
}

function lite(repoPath: string, hash: string): CommitLite {
  const c = readCommit(repoPath, hash);
  return { hash, message: c.message.split("\n")[0], author: c.author.name, timestamp: c.author.timestamp };
}

function newestFirst(repoPath: string, hashes: string[]): { list: CommitLite[]; total: number } {
  const all = hashes.map((h) => lite(repoPath, h)).sort((a, b) => b.timestamp - a.timestamp);
  return { list: all.slice(0, LIST_LIMIT), total: all.length };
}

export function compareBranches(repoPath: string, baseHash: string, headHash: string) {
  const A = ancestors(repoPath, baseHash);
  const B = ancestors(repoPath, headHash);

  const onlyHead = [...B.set].filter((h) => !A.set.has(h)); // "ahead"
  const onlyBase = [...A.set].filter((h) => !B.set.has(h)); // "behind"

  // Common ancestors form an ancestor-closed set, so a merge base is a common
  // commit that is not the parent of another common commit.
  const common = [...A.set].filter((h) => B.set.has(h));
  const commonSet = new Set(common);
  const notBases = new Set<string>();
  for (const h of common) for (const p of readCommit(repoPath, h).parents) if (commonSet.has(p)) notBases.add(p);
  const bases = common.filter((h) => !notBases.has(h)).map((h) => lite(repoPath, h));
  bases.sort((a, b) => b.timestamp - a.timestamp);
  const mergeBase = bases[0] ?? null;

  let relation: "same" | "ahead" | "behind" | "diverged" | "unrelated";
  if (baseHash === headHash) relation = "same";
  else if (!mergeBase) relation = "unrelated";
  else if (onlyBase.length === 0) relation = "ahead";
  else if (onlyHead.length === 0) relation = "behind";
  else relation = "diverged";

  let headFiles: string[] = [];
  let baseFiles: string[] = [];
  if (mergeBase) {
    const mbTree = readCommit(repoPath, mergeBase.hash).tree;
    headFiles = changedFiles(repoPath, mbTree, readCommit(repoPath, headHash).tree);
    baseFiles = changedFiles(repoPath, mbTree, readCommit(repoPath, baseHash).tree);
  }
  const baseSet = new Set(baseFiles);
  const bothSides = headFiles.filter((f) => baseSet.has(f));

  const ahead = newestFirst(repoPath, onlyHead);
  const behind = newestFirst(repoPath, onlyBase);

  return {
    baseHash,
    headHash,
    relation,
    mergeBase,
    mergeBaseCount: bases.length,
    ahead: { count: ahead.total, commits: ahead.list },
    behind: { count: behind.total, commits: behind.list },
    /** Hashes of every commit unique to one side, for highlighting in the graph. */
    uniqueHashes: [...onlyHead, ...onlyBase].slice(0, 5000),
    files: {
      head: headFiles.slice(0, FILE_LIMIT),
      headTotal: headFiles.length,
      base: baseFiles.slice(0, FILE_LIMIT),
      baseTotal: baseFiles.length,
      bothSides: bothSides.slice(0, FILE_LIMIT),
      bothSidesTotal: bothSides.length,
    },
    truncated: A.truncated || B.truncated,
  };
}


/** The most recent common ancestor of two commits (null if their histories are unrelated). */
export function findMergeBase(repoPath: string, a: string, b: string): { hash: string; candidates: number } | null {
  const A = ancestors(repoPath, a).set;
  const B = ancestors(repoPath, b).set;
  const common = [...A].filter((h) => B.has(h));
  const commonSet = new Set(common);
  const notBases = new Set<string>();
  for (const h of common) for (const p of readCommit(repoPath, h).parents) if (commonSet.has(p)) notBases.add(p);
  const bases = common.filter((h) => !notBases.has(h));
  if (bases.length === 0) return null;
  bases.sort((x, y) => readCommit(repoPath, y).author.timestamp - readCommit(repoPath, x).author.timestamp);
  return { hash: bases[0], candidates: bases.length };
}
