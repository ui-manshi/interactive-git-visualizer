/**
 * Branch identity and colour.
 *
 * A commit gets the identity of the branch whose first-parent history it belongs to,
 * so colour tells you *which branch* you are looking at, not which column it landed
 * in. Remote-tracking refs share the identity of their local branch (origin/main is
 * main). Merged branches whose ref has since been deleted still get their own colour,
 * so side branches stay distinguishable in the history.
 */
import type { RawGraphEdge, RawGraphNode } from "./CommitGraph";

export interface RefInfo {
  name: string;
  hash: string;
  remote?: boolean;
}

/**
 * Index 0 is the trunk, drawn in neutral ink: the main line is the "paper" the rest of the
 * history is written on. Side branches take the hues. Teal is deliberately absent: it is the
 * interface accent (selection, focus, primary actions), so on the graph it never means "a branch".
 */
export const BRANCH_PALETTE = [
  "#B4BCC8", // trunk: neutral ink
  "#A78BE3", // violet
  "#6FA3EF", // blue
  "#D9A441", // amber
  "#D9798B", // rose
  "#8CB369", // green
  "#C58F6B", // copper
];

/** Palette member for the n-th identity; the trunk colour is never reused for a side branch. */
export function paletteAt(i: number): string {
  if (i <= 0) return BRANCH_PALETTE[0];
  return BRANCH_PALETTE[1 + ((i - 1) % (BRANCH_PALETTE.length - 1))];
}

export interface BranchModel {
  /** Identity (branch name) of a commit. */
  identityOf: (hash: string) => string | undefined;
  /** Colour of a commit's branch. */
  colorOf: (hash: string) => string;
  /** Colour for a ref in the sidebar or a chip. */
  colorOfRef: (ref: { name: string; remote?: boolean }) => string;
  /** Number of commits in the loaded history that belong to each named branch. */
  identities: string[];
}

/** "origin/feature/x" -> "feature/x" for remote refs; local names are unchanged. */
export function refIdentity(ref: { name: string; remote?: boolean }): string {
  if (!ref.remote) return ref.name;
  const slash = ref.name.indexOf("/");
  return slash === -1 ? ref.name : ref.name.slice(slash + 1);
}

const TRUNK = /^(main|master|trunk)$/;
const DEV = /^(develop|development|dev)$/;
function rank(identity: string): number {
  return TRUNK.test(identity) ? 0 : DEV.test(identity) ? 1 : 2;
}

export function computeBranchModel(
  nodes: RawGraphNode[],
  edges: RawGraphEdge[],
  refs: RefInfo[]
): BranchModel {
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const firstParent = new Map<string, string>();
  const childEdges = new Map<string, RawGraphEdge[]>();
  for (const e of edges) {
    if ((e.parentIndex ?? 0) === 0) firstParent.set(e.source, e.target);
    (childEdges.get(e.target) ?? childEdges.set(e.target, []).get(e.target)!).push(e);
  }

  // Colours follow the order identities are first seen: trunk, develop, then newest branches.
  const tips = refs
    .filter((r) => nodeById.has(r.hash))
    .map((r) => ({ identity: refIdentity(r), hash: r.hash, remote: !!r.remote, ts: nodeById.get(r.hash)!.data.timestamp }))
    .sort(
      (a, b) =>
        rank(a.identity) - rank(b.identity) ||
        Number(a.remote) - Number(b.remote) ||
        b.ts - a.ts ||
        a.identity.localeCompare(b.identity)
    );

  const identityByHash = new Map<string, string>();
  const identities: string[] = [];
  const known = new Set<string>();
  const see = (id: string) => {
    if (!known.has(id)) {
      known.add(id);
      identities.push(id);
    }
  };

  // Every ref gets a colour, even when it points into another branch's history.
  for (const t of tips) see(t.identity);
  for (const r of refs) see(refIdentity(r));

  for (const t of tips) {
    let h: string | undefined = t.hash;
    while (h && nodeById.has(h) && !identityByHash.has(h)) {
      identityByHash.set(h, t.identity);
      h = firstParent.get(h);
    }
  }

  // Commits reachable only through merges (their branch ref is gone): newest first, so a
  // child is always labelled before its parents.
  const order = [...nodes].sort((a, b) => a.position.y - b.position.y);
  for (const n of order) {
    if (identityByHash.has(n.id)) continue;
    const kids = childEdges.get(n.id) ?? [];
    const inherit = kids.find((e) => (e.parentIndex ?? 0) === 0 && identityByHash.has(e.source));
    if (inherit) {
      identityByHash.set(n.id, identityByHash.get(inherit.source)!);
    } else {
      const id = `~${n.id.slice(0, 7)}`;
      identityByHash.set(n.id, id);
      see(id);
    }
  }

  const idx = new Map(identities.map((id, i) => [id, i] as const));
  const color = (id: string | undefined) => paletteAt((id !== undefined ? idx.get(id) : undefined) ?? 0);

  return {
    identityOf: (h) => identityByHash.get(h),
    colorOf: (h) => color(identityByHash.get(h)),
    colorOfRef: (r) => color(refIdentity(r)),
    identities,
  };
}

/** Every commit reachable from `from` through parent links, including `from` itself. */
export function ancestorSet(from: string, parentsOf: Map<string, string[]>): Set<string> {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const h = stack.pop()!;
    if (seen.has(h)) continue;
    seen.add(h);
    for (const p of parentsOf.get(h) ?? []) stack.push(p);
  }
  return seen;
}
