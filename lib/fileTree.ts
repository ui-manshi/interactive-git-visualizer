/**
 * fileTree.ts
 *
 * Resolves a commit's snapshot: commit -> root tree object -> (recursively)
 * every file in the repository at that point in history. Works entirely
 * through gitObjectParser.ts, so it handles loose and packed objects alike.
 */

import { parseObject } from "./gitObjectParser";

export interface FlatFile {
  path: string; // e.g. "src/components/Button.tsx"
  hash: string; // blob hash (or, for submodules, the pinned commit hash)
  mode: string; // "100644", "100755", "120000" (symlink), "160000" (submodule)
  isSubmodule: boolean;
}

const MAX_FILES = 20000;

/** Returns the root tree hash of a commit. */
export function getCommitTreeHash(repoPath: string, commitHash: string): string {
  const obj = parseObject(repoPath, commitHash);
  if (obj.type !== "commit") {
    throw new Error(`Object ${commitHash} is a ${obj.type}, expected a commit`);
  }
  return obj.tree;
}

/** Walks a tree object depth-first and returns every file beneath it, sorted by path. */
export function flattenTree(
  repoPath: string,
  treeHash: string
): { files: FlatFile[]; truncated: boolean } {
  const files: FlatFile[] = [];
  const stack: { hash: string; prefix: string }[] = [{ hash: treeHash, prefix: "" }];
  let truncated = false;

  while (stack.length > 0) {
    const { hash, prefix } = stack.pop()!;
    const tree = parseObject(repoPath, hash);
    if (tree.type !== "tree") continue;

    for (const entry of tree.entries) {
      const fullPath = prefix + entry.name;

      if (entry.isDirectory) {
        stack.push({ hash: entry.hash, prefix: fullPath + "/" });
      } else {
        if (files.length >= MAX_FILES) {
          truncated = true;
          continue;
        }
        files.push({
          path: fullPath,
          hash: entry.hash,
          mode: entry.mode,
          // Submodules (mode 160000) point at a commit in ANOTHER repo, so
          // there is no blob here to read.
          isSubmodule: entry.mode === "160000",
        });
      }
    }
  }

  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { files, truncated };
}

/** Convenience: full file listing for a commit. */
export function listFilesAtCommit(repoPath: string, commitHash: string) {
  return flattenTree(repoPath, getCommitTreeHash(repoPath, commitHash));
}

/** Reads a blob's raw bytes. */
export function readBlob(repoPath: string, blobHash: string): Buffer {
  const obj = parseObject(repoPath, blobHash);
  if (obj.type !== "blob") {
    throw new Error(`Object ${blobHash} is a ${obj.type}, expected a blob`);
  }
  return obj.content;
}

/** Git's own heuristic: a NUL byte in the first 8000 bytes means "binary". */
export function isBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}
