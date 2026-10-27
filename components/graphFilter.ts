import type { RawGraphEdge, RawGraphNode } from "./CommitGraph";

export interface FilterState {
  q: string;
  author: string;
  branch: string;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
}

export const EMPTY_FILTER: FilterState = { q: "", author: "", branch: "", from: "", to: "" };

export function isFilterActive(f: FilterState): boolean {
  return !!(f.q.trim() || f.author || f.branch || f.from || f.to);
}

/**
 * Returns the set of commit hashes matching every active filter, or null when
 * no filter is active (meaning "everything matches").
 */
export function computeMatches(
  nodes: RawGraphNode[],
  edges: RawGraphEdge[],
  refs: { name: string; hash: string }[],
  f: FilterState
): Set<string> | null {
  if (!isFilterActive(f)) return null;

  // Branch filter = every commit reachable from that branch's tip.
  let reachable: Set<string> | null = null;
  if (f.branch) {
    reachable = new Set();
    const tip = refs.find((r) => r.name === f.branch)?.hash;
    if (tip) {
      const parents = new Map<string, string[]>();
      for (const e of edges) {
        const list = parents.get(e.source);
        if (list) list.push(e.target);
        else parents.set(e.source, [e.target]);
      }
      const stack = [tip];
      while (stack.length) {
        const h = stack.pop()!;
        if (reachable.has(h)) continue;
        reachable.add(h);
        for (const p of parents.get(h) ?? []) stack.push(p);
      }
    }
  }

  const q = f.q.trim().toLowerCase();
  const fromTs = f.from ? new Date(`${f.from}T00:00:00`).getTime() / 1000 : null;
  const toTs = f.to ? new Date(`${f.to}T23:59:59`).getTime() / 1000 : null;

  const out = new Set<string>();
  for (const n of nodes) {
    const d = n.data;
    if (reachable && !reachable.has(n.id)) continue;
    if (f.author && d.author !== f.author) continue;
    if (fromTs !== null && d.timestamp < fromTs) continue;
    if (toTs !== null && d.timestamp > toTs) continue;
    if (
      q &&
      !(
        d.message.toLowerCase().includes(q) ||
        d.author.toLowerCase().includes(q) ||
        (d.tagNames ?? []).some((t) => t.toLowerCase().includes(q)) ||
        n.id.startsWith(q)
      )
    )
      continue;
    out.add(n.id);
  }
  return out;
}
