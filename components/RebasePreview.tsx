"use client";

import { useEffect, useMemo, useState } from "react";
import DagView, { DagEdge, DagNode, DagTag } from "./DagView";
import { laneColor } from "./lanes";

interface CommitLite {
  hash: string;
  message: string;
}

interface Step {
  hash: string;
  message: string;
  status: "clean" | "empty" | "conflict" | "not-attempted";
  filesChanged: number;
  conflictFiles: string[];
  conflictReasons: string[];
}

interface Data {
  steps: Step[];
  stoppedAt: number;
  upToDate: boolean;
  mergeCommitsDropped: number;
  truncated: boolean;
  totalToReplay: number;
}

const BASE_COLOR = laneColor(0);
const HEAD_COLOR = laneColor(1);

/** Keeps the first two and last two entries of a long list, with a gap marker between. */
function squash<T>(list: T[], max = 5): { item: T | null; hidden: number }[] {
  if (list.length <= max) return list.map((item) => ({ item, hidden: 0 }));
  return [
    { item: list[0], hidden: 0 },
    { item: list[1], hidden: 0 },
    { item: null, hidden: list.length - 4 },
    { item: list[list.length - 2], hidden: 0 },
    { item: list[list.length - 1], hidden: 0 },
  ];
}

export default function RebasePreview({
  repoPath,
  base,
  head,
  mergeBase,
  baseOnly,
}: {
  repoPath: string;
  base: { name: string; hash: string };
  head: { name: string; hash: string };
  mergeBase: { hash: string } | null;
  /** Commits only on the base branch, newest first (from the branch comparison). */
  baseOnly: CommitLite[];
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo/rebasepreview?path=${encodeURIComponent(repoPath)}&onto=${base.hash}&head=${head.hash}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath, base.hash, head.hash]);

  const diagrams = useMemo(() => {
    if (!data || data.upToDate || data.steps.length === 0) return null;

    const baseItems = squash([...baseOnly].reverse());
    const headItems = squash(data.steps);

    const mb: DagNode = { id: "mb", col: 0, lane: 0, label: "MB", sub: mergeBase?.hash.slice(0, 7), title: "Merge base", color: BASE_COLOR };
    const baseNodes: DagNode[] = baseItems.map((b, i) =>
      b.item
        ? { id: `b${i}`, col: i + 1, lane: 0, label: `B${indexOf(baseItems, i)}`, sub: b.item.hash.slice(0, 7), title: b.item.message, color: BASE_COLOR }
        : { id: `b${i}`, col: i + 1, lane: 0, label: "", gap: true, sub: `${b.hidden} more` }
    );
    const headNodes: DagNode[] = headItems.map((h, i) =>
      h.item
        ? { id: `h${i}`, col: i + 1, lane: 1, label: `H${indexOf(headItems, i)}`, sub: h.item.hash.slice(0, 7), title: h.item.message, color: HEAD_COLOR }
        : { id: `h${i}`, col: i + 1, lane: 1, label: "", gap: true, sub: `${h.hidden} more` }
    );

    const chain = (ids: string[], first: string): DagEdge[] => ids.map((id, i) => ({ from: id, to: i === 0 ? first : ids[i - 1] }));
    const baseIds = baseNodes.map((n) => n.id);
    const headIds = headNodes.map((n) => n.id);
    const baseTip = baseIds.length ? baseIds[baseIds.length - 1] : "mb";

    const before = {
      nodes: [mb, ...baseNodes, ...headNodes],
      edges: [...chain(baseIds, "mb"), ...chain(headIds, "mb")],
      tags: [
        { nodeId: baseTip, text: base.name, kind: "branch" },
        { nodeId: headIds[headIds.length - 1], text: head.name, kind: "branch" },
      ] as DagTag[],
    };

    // After: the head commits are copied on top of the base tip; the originals fade.
    const stopped = data.stoppedAt >= 0;
    const replayed: DagNode[] = headItems.map((h, i) => {
      const step = h.item;
      const baseCol = baseNodes.length + 1 + i;
      if (!step) return { id: `r${i}`, col: baseCol, lane: 0, label: "", gap: true, sub: `${h.hidden} more` };
      return {
        id: `r${i}`,
        col: baseCol,
        lane: 0,
        label: `H${indexOf(headItems, i)}'`,
        sub: "new",
        title: `${step.message} (${step.status})`,
        color: HEAD_COLOR,
        ghost: step.status === "not-attempted",
        status: step.status === "conflict" ? "conflict" : step.status === "empty" ? "empty" : undefined,
      };
    });
    const replayedIds = replayed.map((n) => n.id);
    const ghosts = headNodes.map((n) => ({ ...n, ghost: true }));
    const afterEdges: DagEdge[] = [
      ...chain(baseIds, "mb"),
      ...replayedIds.map((id, i) => ({ from: id, to: i === 0 ? baseTip : replayedIds[i - 1] })),
      ...chain(headIds, "mb").map((e) => ({ ...e, ghost: true })),
      ...headNodes.filter((n) => !n.gap).map((n) => ({ from: n.id, to: replayed[headNodes.indexOf(n)].id, kind: "copy" as const })),
    ];
    const conflictIdx = replayed.findIndex((n) => n.status === "conflict");
    const after = {
      nodes: [mb, ...baseNodes, ...replayed, ...ghosts],
      edges: afterEdges,
      tags: [
        { nodeId: baseTip, text: base.name, kind: "branch" },
        stopped && conflictIdx >= 0
          ? { nodeId: replayedIds[conflictIdx], text: "stops here", kind: "note" }
          : { nodeId: replayedIds[replayedIds.length - 1], text: head.name, kind: "branch" },
        ...(stopped ? [{ nodeId: headIds[headIds.length - 1], text: head.name, kind: "branch" }] : []),
      ] as DagTag[],
    };
    return { before, after };
  }, [data, baseOnly, base.name, head.name, mergeBase]);

  if (error) return <p className="text-del">{error}</p>;
  if (!data) return <p className="text-muted">Replaying the commits…</p>;
  if (data.upToDate || data.steps.length === 0) {
    return (
      <p className="text-fg/90">
        Nothing to rebase: <span className="font-mono">{head.name}</span> is already up to date with{" "}
        <span className="font-mono">{base.name}</span>.
      </p>
    );
  }

  const stopStep = data.stoppedAt >= 0 ? data.steps[data.stoppedAt] : null;
  const applied = data.steps.filter((s) => s.status === "clean" || s.status === "empty").length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted m-0">
        What <span className="font-mono text-fg">git rebase {base.name}</span> would do while on{" "}
        <span className="font-mono text-fg">{head.name}</span>: each of its commits is re-applied on top of{" "}
        <span className="font-mono text-fg">{base.name}</span>. Nothing is changed in your repository.
      </p>

      {stopStep ? (
        <div className="rounded-lg border border-del/50 bg-del/10 p-3">
          <p className="m-0 font-semibold text-del">The rebase would stop at commit {data.stoppedAt + 1} of {data.totalToReplay}</p>
          <p className="m-0 mt-1 text-fg/90">
            &ldquo;{stopStep.message}&rdquo; conflicts in {stopStep.conflictFiles.length} file{stopStep.conflictFiles.length === 1 ? "" : "s"}. Git would
            pause there until you resolve it.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-add/50 bg-add/10 p-3">
          <p className="m-0 font-semibold text-add">All {applied} commit{applied === 1 ? "" : "s"} would replay without conflicts</p>
        </div>
      )}

      {diagrams && (
        <div className="space-y-3">
          <div>
            <p className="text-xs text-muted m-0 mb-1">Before</p>
            <div className="rounded-lg code-surface p-1">
              <DagView {...diagrams.before} minLanes={2} ariaLabel={`Before rebase: ${head.name} branches off ${base.name}`} />
            </div>
          </div>
          <div>
            <p className="text-xs text-muted m-0 mb-1">After (dashed commits are the originals, copied forward)</p>
            <div className="rounded-lg code-surface p-1">
              <DagView {...diagrams.after} minLanes={2} ariaLabel={`After rebase: ${head.name} commits replayed on top of ${base.name}`} />
            </div>
          </div>
        </div>
      )}

      <ol className="m-0 p-0 list-none rounded-lg inset overflow-hidden">
        {data.steps.map((s, i) => (
          <li key={s.hash} className="px-2.5 py-2 border-b border-white/[0.07] last:border-b-0 flex items-start gap-2">
            <StatusChip status={s.status} />
            <span className="min-w-0">
              <span className="block text-[13px] text-fg truncate">
                {i + 1}. {s.message}
              </span>
              <span className="block text-[11px] text-muted">
                <span className="font-mono text-accent">{s.hash.slice(0, 7)}</span> · {s.filesChanged} file{s.filesChanged === 1 ? "" : "s"}
              </span>
              {s.conflictFiles.map((f, k) => (
                <span key={f} className="block text-[11px] text-del font-mono break-all">
                  {f} <span className="font-sans text-muted">({s.conflictReasons[k]})</span>
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
      {data.truncated && <p className="text-xs text-warn m-0">Only the first {data.steps.length} of {data.totalToReplay} commits were simulated.</p>}

      <p className="text-[11px] text-muted m-0 leading-relaxed">
        {data.mergeCommitsDropped > 0 && `${data.mergeCommitsDropped} merge commit${data.mergeCommitsDropped === 1 ? " is" : "s are"} not replayed, as in a plain git rebase. `}
        Git also skips commits whose changes are already on {base.name}; this preview does not detect that. Every replayed commit gets a new hash.
      </p>
    </div>
  );
}

/** The 1-based position of a commit within the list, skipping the gap marker. */
function indexOf<T>(items: { item: T | null; hidden: number }[], i: number): number {
  const gapIdx = items.findIndex((x) => x.item === null);
  if (gapIdx === -1 || i < gapIdx) return i + 1;
  const hidden = items[gapIdx].hidden;
  return i + hidden; // entries after the gap continue the numbering past the hidden ones
}

export function StatusChip({ status }: { status: Step["status"] }) {
  const map = {
    clean: { t: "Clean", cls: "bg-add/20 text-add" },
    empty: { t: "Empty", cls: "bg-warn/20 text-warn" },
    conflict: { t: "Conflict", cls: "bg-del/20 text-del" },
    "not-attempted": { t: "Not reached", cls: "bg-raised text-muted" },
  }[status];
  return <span className={`mt-0.5 flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded ${map.cls}`}>{map.t}</span>;
}
