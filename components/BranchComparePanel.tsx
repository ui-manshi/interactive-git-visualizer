"use client";

import { useEffect, useState } from "react";
import MergePreview from "./MergePreview";
import RebasePreview from "./RebasePreview";

interface CommitLite {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
}

interface CompareData {
  relation: "same" | "ahead" | "behind" | "diverged" | "unrelated";
  mergeBase: CommitLite | null;
  mergeBaseCount: number;
  ahead: { count: number; commits: CommitLite[] };
  behind: { count: number; commits: CommitLite[] };
  uniqueHashes: string[];
  files: {
    head: string[];
    headTotal: number;
    base: string[];
    baseTotal: number;
    bothSides: string[];
    bothSidesTotal: number;
  };
  truncated: boolean;
}

interface Props {
  repoPath: string;
  base: { name: string; hash: string };
  head: { name: string; hash: string };
  onGoToCommit: (hash: string) => void;
  /** Dim every commit except the ones unique to one side; null clears. */
  onHighlight: (hashes: Set<string> | null) => void;
  onSwap: () => void;
  onClose: () => void;
}

export default function BranchComparePanel({ repoPath, base, head, onGoToCommit, onHighlight, onSwap, onClose }: Props) {
  const [data, setData] = useState<CompareData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "merge" | "rebase">("overview");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo/branchcompare?path=${encodeURIComponent(repoPath)}&base=${base.hash}&head=${head.hash}`)
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

  useEffect(() => {
    if (!data) return;
    onHighlight(new Set([...data.uniqueHashes, ...(data.mergeBase ? [data.mergeBase.hash] : [])]));
    return () => onHighlight(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const summary = (d: CompareData) => {
    switch (d.relation) {
      case "same":
        return "Both branches point at the same commit.";
      case "ahead":
        return `${head.name} is ${d.ahead.count} commit${d.ahead.count === 1 ? "" : "s"} ahead of ${base.name}. Merging it into ${base.name} would be a fast-forward.`;
      case "behind":
        return `${head.name} is ${d.behind.count} commit${d.behind.count === 1 ? "" : "s"} behind ${base.name} and has nothing new of its own.`;
      case "diverged":
        return `The branches have diverged: ${head.name} has ${d.ahead.count} commit${d.ahead.count === 1 ? "" : "s"} that ${base.name} lacks, and ${base.name} has ${d.behind.count} that ${head.name} lacks.`;
      default:
        return "These branches share no history.";
    }
  };

  return (
    <div className="flex flex-col min-h-0 h-full">
      <div className="px-4 pt-3 pb-2 flex items-start justify-between gap-3 flex-shrink-0">
        <div className="min-w-0">
          <h2 className="font-semibold text-lg leading-snug m-0">Compare branches</h2>
          <p className="text-xs text-muted mt-1 m-0 flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-fg">{base.name}</span>
            <button onClick={onSwap} className="hover:text-fg px-1 rounded" title="Swap sides" aria-label="Swap sides">
              ⇄
            </button>
            <span className="font-mono text-fg">{head.name}</span>
          </p>
        </div>
        <button onClick={onClose} className="text-muted hover:text-fg w-7 h-7 rounded hover:bg-raised" aria-label="Close" title="Close">
          ✕
        </button>
      </div>

      <div role="tablist" className="px-4 flex gap-1 flex-shrink-0">
        {(
          [
            ["overview", "Overview"],
            ["merge", "Merge preview"],
            ["rebase", "Rebase preview"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === id ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5 text-sm">
        {error && <p className="text-del">{error}</p>}
        {!data && !error && <p className="text-muted">Comparing…</p>}
        {data && tab === "merge" && <MergePreview repoPath={repoPath} base={base} head={head} relation={data.relation} />}
        {data && tab === "rebase" && (
          <RebasePreview repoPath={repoPath} base={base} head={head} mergeBase={data.mergeBase} baseOnly={data.behind.commits} />
        )}
        {data && tab === "overview" && (
          <>
            <p className="m-0 text-fg/90 leading-relaxed">{summary(data)}</p>

            <div className="grid grid-cols-3 gap-2">
              <Stat label={`Ahead (${head.name})`} value={data.ahead.count} color="rgb(var(--accent))" />
              <Stat label={`Behind (${base.name})`} value={data.behind.count} color="rgb(var(--violet))" />
              <div className="rounded-lg inset p-2.5">
                <p className="text-2xs text-muted m-0">Merge base</p>
                {data.mergeBase ? (
                  <button
                    onClick={() => onGoToCommit(data.mergeBase!.hash)}
                    className="font-mono text-sm text-accent hover:underline mt-1"
                    title={data.mergeBase.message}
                  >
                    {data.mergeBase.hash.slice(0, 7)}
                  </button>
                ) : (
                  <p className="text-muted mt-1 m-0">none</p>
                )}
                {data.mergeBaseCount > 1 && <p className="text-2xs text-muted m-0">{data.mergeBaseCount} candidates</p>}
              </div>
            </div>

            <CommitList title={`Only on ${head.name}`} total={data.ahead.count} commits={data.ahead.commits} onGoToCommit={onGoToCommit} />
            <CommitList title={`Only on ${base.name}`} total={data.behind.count} commits={data.behind.commits} onGoToCommit={onGoToCommit} />

            {data.mergeBase && (
              <section className="space-y-3">
                <p className="text-xs text-muted m-0">Files changed since the merge base</p>
                <FileList title={`On ${head.name}`} files={data.files.head} total={data.files.headTotal} />
                <FileList title={`On ${base.name}`} files={data.files.base} total={data.files.baseTotal} />
                {data.files.bothSidesTotal > 0 && (
                  <div className="rounded-lg border border-warn/40 bg-warn/10 p-3">
                    <FileList
                      title="Changed on both sides"
                      note="These files were edited on both branches, so merging them may produce conflicts."
                      files={data.files.bothSides}
                      total={data.files.bothSidesTotal}
                    />
                  </div>
                )}
              </section>
            )}
            {data.truncated && <p className="text-xs text-warn m-0">History was very long, so counts may be incomplete.</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg inset p-2.5">
      <p className="text-2xs text-muted m-0 truncate" title={label}>
        {label}
      </p>
      <p className="font-semibold text-xl m-0 mt-0.5" style={{ color }}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function CommitList({
  title,
  total,
  commits,
  onGoToCommit,
}: {
  title: string;
  total: number;
  commits: CommitLite[];
  onGoToCommit: (hash: string) => void;
}) {
  if (total === 0) return null;
  return (
    <section>
      <p className="text-xs text-muted mb-1.5 m-0">
        {title} ({total.toLocaleString()})
      </p>
      <ul className="m-0 p-0 list-none rounded-lg inset overflow-hidden">
        {commits.map((c) => (
          <li key={c.hash} className="border-b border-white/[0.07] last:border-b-0">
            <button onClick={() => onGoToCommit(c.hash)} className="w-full text-left px-2.5 py-1.5 hover:bg-raised">
              <span className="block text-sm text-fg truncate">{c.message}</span>
              <span className="block text-2xs text-muted truncate">
                <span className="font-mono text-accent">{c.hash.slice(0, 7)}</span> · {c.author} ·{" "}
                {new Date(c.timestamp * 1000).toLocaleDateString()}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {total > commits.length && <p className="text-2xs text-muted mt-1 m-0">Showing the newest {commits.length}.</p>}
    </section>
  );
}

function FileList({ title, files, total, note }: { title: string; files: string[]; total: number; note?: string }) {
  const shown = files.slice(0, 40);
  return (
    <div>
      <p className="text-xs text-fg m-0">
        {title} <span className="text-muted">({total.toLocaleString()})</span>
      </p>
      {note && <p className="text-2xs text-muted m-0 mt-0.5">{note}</p>}
      {total === 0 ? (
        <p className="text-2xs text-muted m-0 mt-1">No file changes.</p>
      ) : (
        <ul className="m-0 mt-1 p-0 list-none font-mono text-2xs text-fg/90 space-y-0.5">
          {shown.map((f) => (
            <li key={f} className="break-all">
              {f}
            </li>
          ))}
          {total > shown.length && <li className="text-muted font-sans">+ {(total - shown.length).toLocaleString()} more</li>}
        </ul>
      )}
    </div>
  );
}
