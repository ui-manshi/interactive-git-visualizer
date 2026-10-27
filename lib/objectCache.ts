/**
 * objectCache.ts
 *
 * Git objects are immutable (their ID is a hash of their content), so parsed
 * commits and trees can be cached for the life of the server process. This is
 * what keeps history walks, blame and "load more commits" fast on big repos.
 */

import { parseObject, ParsedCommit, TreeEntry } from "./gitObjectParser";

const CACHE_LIMIT = 250_000;
const commitCache = new Map<string, ParsedCommit>();
const treeCache = new Map<string, TreeEntry[]>();

function trim<T>(m: Map<string, T>) {
  if (m.size > CACHE_LIMIT) m.clear();
}

export function readCommit(repoPath: string, hash: string): ParsedCommit {
  const key = `${repoPath}\0${hash}`;
  const hit = commitCache.get(key);
  if (hit) return hit;
  const obj = parseObject(repoPath, hash);
  if (obj.type !== "commit") throw new Error(`Object ${hash} is a ${obj.type}, expected a commit`);
  trim(commitCache);
  commitCache.set(key, obj);
  return obj;
}

export function readTree(repoPath: string, hash: string): TreeEntry[] {
  const key = `${repoPath}\0${hash}`;
  const hit = treeCache.get(key);
  if (hit) return hit;
  const obj = parseObject(repoPath, hash);
  if (obj.type !== "tree") throw new Error(`Object ${hash} is a ${obj.type}, expected a tree`);
  trim(treeCache);
  treeCache.set(key, obj.entries);
  return obj.entries;
}

/** Finds the file at `filePath` inside a tree by walking only the directories on its path. */
export function blobAtPath(
  repoPath: string,
  treeHash: string,
  filePath: string
): { hash: string; mode: string } | null {
  const parts = filePath.split("/").filter(Boolean);
  let cur = treeHash;
  for (let i = 0; i < parts.length; i++) {
    const entry = readTree(repoPath, cur).find((e) => e.name === parts[i]);
    if (!entry) return null;
    if (i === parts.length - 1) return entry.isDirectory ? null : { hash: entry.hash, mode: entry.mode };
    if (!entry.isDirectory) return null;
    cur = entry.hash;
  }
  return null;
}

/**
 * Paths of files that differ between two trees. Subtrees with the same hash are
 * skipped without being opened, so this is cheap even for large repositories.
 */
export function changedFiles(
  repoPath: string,
  oldTree: string | null,
  newTree: string | null,
  limit = 5000
): string[] {
  const out: string[] = [];

  function walk(o: string | null, n: string | null, prefix: string) {
    if (out.length >= limit) return;
    const oe = o ? readTree(repoPath, o) : [];
    const ne = n ? readTree(repoPath, n) : [];
    const om = new Map(oe.map((e) => [e.name, e]));
    const nm = new Map(ne.map((e) => [e.name, e]));
    for (const name of new Set([...om.keys(), ...nm.keys()])) {
      const a = om.get(name);
      const b = nm.get(name);
      if (a && b && a.hash === b.hash && a.mode === b.mode) continue;
      const aDir = !!a?.isDirectory;
      const bDir = !!b?.isDirectory;
      if (aDir || bDir) walk(aDir ? a!.hash : null, bDir ? b!.hash : null, `${prefix}${name}/`);
      if ((a && !aDir) || (b && !bDir)) out.push(prefix + name);
    }
  }

  walk(oldTree, newTree, "");
  return out;
}
