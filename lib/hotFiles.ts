import { collectReachableCommits } from "./graphBuilder";
import { readCommit, changedFiles } from "./objectCache";

const DEFAULT_SCAN = 300;

/** Files touched by the most commits among the newest `scan` non-merge commits. */
export function hotFiles(repoPath: string, scan = DEFAULT_SCAN) {
  const all = Array.from(collectReachableCommits(repoPath).values()).sort(
    (a, b) => b.author.timestamp - a.author.timestamp
  );
  const recent = all.filter((c) => c.parents.length <= 1).slice(0, scan);

  const counts = new Map<string, number>();
  for (const c of recent) {
    const parentTree = c.parents[0] ? readCommit(repoPath, c.parents[0]).tree : null;
    for (const f of changedFiles(repoPath, parentTree, c.tree, 500)) {
      counts.set(f, (counts.get(f) ?? 0) + 1);
    }
  }

  const files = Array.from(counts, ([path, commits]) => ({ path, commits }))
    .sort((a, b) => b.commits - a.commits || a.path.localeCompare(b.path))
    .slice(0, 15);

  return { files, scanned: recent.length, totalCommits: all.length };
}
