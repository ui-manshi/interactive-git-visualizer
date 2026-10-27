/**
 * graphBuilder.ts
 *
 * Traces parent-hash pointers backward from every branch tip to build the
 * full commit DAG in memory, then assigns each commit a (lane, row)
 * position so it can be rendered as a Git-log-style graph — new commits
 * at the top, branches fanning out into separate vertical lanes, and merge
 * commits drawn with edges converging back together.
 */

import { listBranchRefs, listTagRefs, ParsedCommit } from "./gitObjectParser";
import { readCommit } from "./objectCache";
import { LANE_W, ROW_H } from "./graphLayout";

export interface GraphNodeData {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: number;
  isMerge: boolean;
  branchNames: string[]; // branch(es) whose tip is exactly this commit
  tagNames: string[]; // tags pointing at this commit
}

export interface GraphNode {
  id: string;
  position: { x: number; y: number };
  data: GraphNodeData;
}

export interface GraphEdge {
  id: string;
  source: string; // child commit
  target: string; // parent commit
  /** 0 for the first parent (the line a branch continues along), 1+ for merged-in parents. */
  parentIndex: number;
}

export interface CommitGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
  /** How many commits the repository has in total (nodes may be fewer when truncated). */
  totalCommits: number;
}

// Row and lane spacing are shared with the renderer (see graphLayout.ts).
const ROW_HEIGHT = ROW_H;
const LANE_WIDTH = LANE_W;

/**
 * Walks every branch ref backward via parent pointers (BFS) to collect the
 * full set of reachable commits, resolving each with gitObjectParser.ts
 * (which itself transparently handles loose or packed storage).
 */
export function collectReachableCommits(repoPath: string): Map<string, ParsedCommit> {
  const branches = listBranchRefs(repoPath);
  const visited = new Map<string, ParsedCommit>();
  const seen = new Set<string>();
  const queue: string[] = [];

  for (const branch of branches) {
    if (!seen.has(branch.hash)) {
      seen.add(branch.hash);
      queue.push(branch.hash);
    }
  }

  while (queue.length > 0) {
    const hash = queue.shift()!;
    if (visited.has(hash)) continue;

    const obj = readCommit(repoPath, hash);

    visited.set(hash, obj);

    for (const parentHash of obj.parents) {
      if (!seen.has(parentHash)) {
        seen.add(parentHash);
        queue.push(parentHash);
      }
    }
  }

  return visited;
}

/**
 * Performs a topological sort of the commit DAG such that every commit
 * appears strictly before (above, in the rendered graph) all of its
 * ancestors — i.e. a commit is only emitted once every commit that has it
 * as a parent has already been emitted. Author timestamp is used only to
 * break ties among commits that are simultaneously "ready" (no ordering
 * constraint between them yet), which also keeps same-second commits
 * (common in scripted/rebased repos, where git's 1-second timestamp
 * resolution isn't enough to disambiguate order) from being placed in an
 * order that would put a commit above its own child.
 */
function topologicalSort(commitMap: Map<string, ParsedCommit>): ParsedCommit[] {
  const remainingChildCount = new Map<string, number>();
  for (const hash of commitMap.keys()) remainingChildCount.set(hash, 0);

  for (const commit of commitMap.values()) {
    for (const parentHash of commit.parents) {
      if (commitMap.has(parentHash)) {
        remainingChildCount.set(parentHash, (remainingChildCount.get(parentHash) ?? 0) + 1);
      }
    }
  }

  // "Ready" commits are those with no not-yet-emitted children — initially
  // this is exactly the branch tips (and any other childless commits).
  const ready: ParsedCommit[] = [];
  for (const commit of commitMap.values()) {
    if ((remainingChildCount.get(commit.hash) ?? 0) === 0) {
      ready.push(commit);
    }
  }

  const result: ParsedCommit[] = [];

  while (ready.length > 0) {
    // Among currently-ready commits, prefer the most recent one — this is
    // purely a tie-breaker for nicer interleaving of parallel branches and
    // never violates the topological constraint above.
    let bestIndex = 0;
    for (let i = 1; i < ready.length; i++) {
      if (ready[i].author.timestamp > ready[bestIndex].author.timestamp) {
        bestIndex = i;
      }
    }

    const [commit] = ready.splice(bestIndex, 1);
    result.push(commit);

    for (const parentHash of commit.parents) {
      const parent = commitMap.get(parentHash);
      if (!parent) continue;

      const newCount = (remainingChildCount.get(parentHash) ?? 1) - 1;
      remainingChildCount.set(parentHash, newCount);
      if (newCount === 0) {
        ready.push(parent);
      }
    }
  }

  return result;
}

/**
 * Assigns a lane (horizontal column) to each commit using a simplified
 * version of the algorithm `git log --graph` uses: lanes track which
 * commit hash they're "waiting for" next. A commit reuses the lane that
 * was waiting for it; otherwise it starts a new lane. Merge commits open
 * additional lanes for their non-first parents.
 */
function assignLanesAndBuildGraph(
  commits: ParsedCommit[],
  branchTipNames: Map<string, string[]>,
  tagNamesByCommit: Map<string, string[]>
): CommitGraph {
  const commitHashes = new Set(commits.map((c) => c.hash));
  const lanes: (string | null)[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  commits.forEach((commit, row) => {
    let lane = lanes.indexOf(commit.hash);
    // Several children can leave a lane waiting for this same commit. Once the commit
    // is placed, those lanes have arrived, so free them (otherwise they stay occupied
    // forever and every later branch is pushed further right).
    if (lane !== -1) {
      for (let i = lane + 1; i < lanes.length; i++) if (lanes[i] === commit.hash) lanes[i] = null;
    }
    if (lane === -1) {
      lane = lanes.indexOf(null);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(null);
      }
    }

    nodes.push({
      id: commit.hash,
      position: { x: lane * LANE_WIDTH, y: row * ROW_HEIGHT },
      data: {
        hash: commit.hash,
        shortHash: commit.hash.slice(0, 7),
        message: commit.message.split("\n")[0],
        author: commit.author.name,
        timestamp: commit.author.timestamp,
        isMerge: commit.parents.length > 1,
        branchNames: branchTipNames.get(commit.hash) ?? [],
        tagNames: tagNamesByCommit.get(commit.hash) ?? [],
      },
    });

    const [firstParent, ...restParents] = commit.parents;
    lanes[lane] = firstParent ?? null;

    for (const parentHash of restParents) {
      if (!lanes.includes(parentHash)) {
        const freeLane = lanes.indexOf(null);
        if (freeLane === -1) {
          lanes.push(parentHash);
        } else {
          lanes[freeLane] = parentHash;
        }
      }
    }

    commit.parents.forEach((parentHash, parentIndex) => {
      if (commitHashes.has(parentHash)) {
        edges.push({
          id: `${commit.hash}->${parentHash}`,
          source: commit.hash,
          target: parentHash,
          parentIndex,
        });
      }
    });
  });

  return { nodes, edges, truncated: false, totalCommits: commits.length };
}

/**
 * Builds the full renderable commit graph for a repository.
 *
 * @param maxCommits caps how many commits are laid out, to keep very large
 *   histories from overwhelming the browser. Commits are kept newest-first,
 *   so the cap simply trims the oldest tail of history.
 */
// The sorted history only changes when a ref moves, so repeated requests ("load more",
// reloads) reuse it instead of re-walking every commit.
const sortedCache = new Map<string, { signature: string; commits: ParsedCommit[] }>();

export function buildCommitGraph(repoPath: string, maxCommits = 500): CommitGraph {
  const branches = listBranchRefs(repoPath);
  const branchTipNames = new Map<string, string[]>();
  for (const branch of branches) {
    const existing = branchTipNames.get(branch.hash) ?? [];
    existing.push(branch.name);
    branchTipNames.set(branch.hash, existing);
  }

  const tagNamesByCommit = new Map<string, string[]>();
  for (const tag of listTagRefs(repoPath)) {
    const existing = tagNamesByCommit.get(tag.hash) ?? [];
    existing.push(tag.name);
    tagNamesByCommit.set(tag.hash, existing);
  }

  const signature = branches.map((b) => `${b.name}:${b.hash}`).join("|");
  let cached = sortedCache.get(repoPath);
  if (!cached || cached.signature !== signature) {
    cached = { signature, commits: topologicalSort(collectReachableCommits(repoPath)) };
    sortedCache.set(repoPath, cached);
  }
  const allCommits = cached.commits;

  const truncated = allCommits.length > maxCommits;
  const commits = allCommits.slice(0, maxCommits);

  const graph = assignLanesAndBuildGraph(commits, branchTipNames, tagNamesByCommit);
  graph.truncated = truncated;
  graph.totalCommits = allCommits.length;
  return graph;
}
