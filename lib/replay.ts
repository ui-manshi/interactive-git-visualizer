/**
 * replay.ts
 *
 * Simulates `git cherry-pick` and `git rebase` without touching the repository.
 * Each commit's changes (its diff against its first parent) are applied, one
 * after another, on top of a target commit using the three-way merge, with the
 * result kept in memory. Like Git, replay stops at the first commit that would
 * conflict.
 */

import { readCommit, blobAtPath, changedFiles } from "./objectCache";
import { readBlob, isBinary } from "./fileTree";
import { splitLines } from "./fileInsights";
import { ancestors, findMergeBase } from "./branchCompare";
import { merge3, mergedLines } from "./merge3";

type Version = { hash: string } | { text: string } | null;

export interface ReplayStep {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  status: "clean" | "empty" | "conflict" | "not-attempted";
  filesChanged: number;
  conflictFiles: string[];
  /** Why each conflicting file conflicts. */
  conflictReasons: string[];
}

const MAX_FILES_PER_COMMIT = 400;

export function replayCommits(repoPath: string, ontoHash: string, commits: string[]) {
  const ontoTree = readCommit(repoPath, ontoHash).tree;
  // File contents as they stand after the commits replayed so far (null = deleted).
  const overlay = new Map<string, Version>();

  const current = (file: string): Version => {
    if (overlay.has(file)) return overlay.get(file)!;
    const b = blobAtPath(repoPath, ontoTree, file);
    return b ? { hash: b.hash } : null;
  };
  const asBuffer = (v: Version): Buffer =>
    !v ? Buffer.alloc(0) : "text" in v ? Buffer.from(v.text, "utf8") : readBlob(repoPath, v.hash);
  const same = (a: Version, b: Version): boolean => {
    if (!a || !b) return a === b;
    if ("hash" in a && "hash" in b) return a.hash === b.hash;
    return asBuffer(a).equals(asBuffer(b));
  };

  const steps: ReplayStep[] = [];
  let stopped = false;

  for (const hash of commits) {
    const c = readCommit(repoPath, hash);
    const step: ReplayStep = {
      hash,
      message: c.message.split("\n")[0],
      author: c.author.name,
      timestamp: c.author.timestamp,
      status: "clean",
      filesChanged: 0,
      conflictFiles: [],
      conflictReasons: [],
    };
    if (stopped) {
      step.status = "not-attempted";
      steps.push(step);
      continue;
    }

    const parentTree = c.parents[0] ? readCommit(repoPath, c.parents[0]).tree : null;
    const files = changedFiles(repoPath, parentTree, c.tree, MAX_FILES_PER_COMMIT);
    step.filesChanged = files.length;
    const pending = new Map<string, Version>();
    let changedAnything = false;

    for (const file of files) {
      const b = parentTree ? blobAtPath(repoPath, parentTree, file) : null;
      const t = blobAtPath(repoPath, c.tree, file);
      const B: Version = b ? { hash: b.hash } : null;
      const T: Version = t ? { hash: t.hash } : null;
      const O = current(file);

      if (same(O, T)) continue; // already in the target: nothing to apply
      if (same(B, O)) {
        pending.set(file, T); // the target never touched it: take the commit's version
        changedAnything = true;
        continue;
      }
      if (same(B, T)) continue; // the commit's side is unchanged
      if (!B || !O || !T) {
        step.conflictFiles.push(file);
        step.conflictReasons.push(
          !B ? "added with different content" : !O ? "deleted in the target but modified by this commit" : "modified in the target but deleted by this commit"
        );
        continue;
      }
      const [bb, ob, tb] = [asBuffer(B), asBuffer(O), asBuffer(T)];
      if (isBinary(bb) || isBinary(ob) || isBinary(tb)) {
        step.conflictFiles.push(file);
        step.conflictReasons.push("binary file changed on both sides");
        continue;
      }
      const result = merge3(splitLines(bb), splitLines(ob), splitLines(tb));
      if (result.conflicts > 0) {
        step.conflictFiles.push(file);
        step.conflictReasons.push(`${result.conflicts} conflicting region${result.conflicts === 1 ? "" : "s"}`);
      } else {
        pending.set(file, { text: mergedLines(result).join("\n") + "\n" });
        changedAnything = true;
      }
    }

    if (step.conflictFiles.length > 0) {
      step.status = "conflict";
      stopped = true;
    } else {
      for (const [f, v] of pending) overlay.set(f, v);
      if (!changedAnything) step.status = "empty";
    }
    steps.push(step);
  }

  return { steps, stoppedAt: steps.findIndex((s) => s.status === "conflict") };
}

/** Commits `head` has that `onto` lacks, oldest first, split into replayable commits and merge commits (which a plain rebase drops). */
export function commitsToReplay(repoPath: string, ontoHash: string, headHash: string) {
  const ontoSet = ancestors(repoPath, ontoHash).set;
  const headSet = ancestors(repoPath, headHash).set;
  const unique = [...headSet].filter((h) => !ontoSet.has(h));
  const uniqueSet = new Set(unique);

  // Parents before children, so each commit is replayed after the ones it builds on.
  const indegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const h of unique) {
    const parents = readCommit(repoPath, h).parents.filter((p) => uniqueSet.has(p));
    indegree.set(h, parents.length);
    for (const p of parents) (children.get(p) ?? children.set(p, []).get(p)!).push(h);
  }
  const ready = unique
    .filter((h) => indegree.get(h) === 0)
    .sort((a, b) => readCommit(repoPath, a).author.timestamp - readCommit(repoPath, b).author.timestamp);
  const ordered: string[] = [];
  while (ready.length) {
    const h = ready.shift()!;
    ordered.push(h);
    for (const ch of children.get(h) ?? []) {
      indegree.set(ch, indegree.get(ch)! - 1);
      if (indegree.get(ch) === 0) {
        ready.push(ch);
        ready.sort((a, b) => readCommit(repoPath, a).author.timestamp - readCommit(repoPath, b).author.timestamp);
      }
    }
  }

  const replayable = ordered.filter((h) => readCommit(repoPath, h).parents.length <= 1);
  return { replayable, mergeCommitsDropped: ordered.length - replayable.length };
}

export function rebasePreview(repoPath: string, ontoHash: string, headHash: string, maxCommits = 100) {
  const { replayable, mergeCommitsDropped } = commitsToReplay(repoPath, ontoHash, headHash);
  const mb = findMergeBase(repoPath, ontoHash, headHash);
  const limited = replayable.slice(0, maxCommits);
  const { steps, stoppedAt } = replayCommits(repoPath, ontoHash, limited);

  // Git does nothing when the branch is already contained in, or already sits on top of, the target.
  const headInOnto = ancestors(repoPath, ontoHash).set.has(headHash);
  const alreadyOnTop = ancestors(repoPath, headHash).set.has(ontoHash);

  return {
    ontoHash,
    headHash,
    mergeBase: mb?.hash ?? null,
    upToDate: headInOnto || alreadyOnTop,
    steps,
    stoppedAt,
    mergeCommitsDropped,
    truncated: replayable.length > maxCommits,
    totalToReplay: replayable.length,
  };
}

export function cherryPickPreview(repoPath: string, commitHash: string, ontoHash: string) {
  const c = readCommit(repoPath, commitHash);
  if (c.parents.length > 1) {
    throw new Error("This is a merge commit. git cherry-pick needs -m to say which parent to follow, so it is not previewed.");
  }
  const alreadyThere = ancestors(repoPath, ontoHash).set.has(commitHash);
  const { steps } = replayCommits(repoPath, ontoHash, [commitHash]);
  return { ontoHash, commitHash, alreadyThere, step: steps[0] };
}
