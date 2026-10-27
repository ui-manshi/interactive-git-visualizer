"use client";

import { useEffect, useState } from "react";
import { laneColor } from "./lanes";

function ago(unixSeconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  const units: [number, string][] = [
    [31536000, "y"],
    [2592000, "mo"],
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
  ];
  for (const [secs, name] of units) if (diff >= secs) return `${Math.floor(diff / secs)}${name} ago`;
  return "just now";
}

function useApi<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(url)
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
  }, [url]);
  return { data, error };
}

// -------------------------------- blame ------------------------------------

interface BlameData {
  lines: { text: string; c: number }[];
  commits: { hash: string; author: string; timestamp: number; summary: string }[];
  approximate: boolean;
}

export function BlameView({
  repoPath,
  commitHash,
  file,
  onGoToCommit,
}: {
  repoPath: string;
  commitHash: string;
  file: string;
  onGoToCommit?: (hash: string) => void;
}) {
  const { data, error } = useApi<BlameData>(
    `/api/repo/blame?path=${encodeURIComponent(repoPath)}&commit=${commitHash}&file=${encodeURIComponent(file)}`
  );

  if (error) return <p className="p-3 text-sm text-del">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted">Working out who wrote each line…</p>;

  return (
    <div>
      <p className="px-3 py-2 text-xs text-muted border-b border-line m-0">
        {data.lines.length} lines from {data.commits.length} commit{data.commits.length === 1 ? "" : "s"}. Each
        block shows the commit that last changed those lines.
        {data.approximate && " Some diffs were too large to align exactly, so a few lines may be attributed to a later commit."}
      </p>
      <table className="w-full text-xs font-mono border-collapse">
        <tbody>
          {data.lines.map((l, i) => {
            const start = i === 0 || data.lines[i - 1].c !== l.c;
            const c = data.commits[l.c];
            return (
              <tr key={i} className={start && i > 0 ? "border-t border-white/[0.07]" : ""}>
                <td
                  className="w-40 max-w-[10rem] pl-2 pr-2 align-top whitespace-nowrap"
                  style={{ borderLeft: `3px solid ${laneColor(l.c)}` }}
                >
                  {start && (
                    <div className="flex items-center gap-2 overflow-hidden">
                      <button
                        className="text-accent hover:underline flex-shrink-0"
                        onClick={() => onGoToCommit?.(c.hash)}
                        title={`${c.summary}\n${c.author}, ${new Date(c.timestamp * 1000).toLocaleString()}`}
                      >
                        {c.hash.slice(0, 7)}
                      </button>
                      <span className="text-muted truncate font-sans" title={c.author}>
                        {c.author}
                      </span>
                    </div>
                  )}
                  {start && <div className="text-[10px] text-faint font-sans">{ago(c.timestamp)}</div>}
                </td>
                <td className="w-10 pr-2 text-right text-faint select-none align-top">{i + 1}</td>
                <td className="whitespace-pre-wrap break-all text-fg pr-2 align-top">{l.text || " "}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------- history -----------------------------------

interface HistoryData {
  commits: { hash: string; message: string; author: string; timestamp: number; status: "added" | "modified" | "deleted" }[];
  totalChanges: number;
  truncated: boolean;
}

const STATUS_STYLE = {
  added: { letter: "A", cls: "bg-add/20 text-add" },
  modified: { letter: "M", cls: "bg-warn/20 text-warn" },
  deleted: { letter: "D", cls: "bg-del/20 text-del" },
};

export function FileHistoryView({
  repoPath,
  commitHash,
  file,
  onGoToCommit,
  onHighlight,
}: {
  repoPath: string;
  commitHash: string;
  file: string;
  onGoToCommit?: (hash: string) => void;
  onHighlight?: (hashes: Set<string> | null) => void;
}) {
  const { data, error } = useApi<HistoryData>(
    `/api/repo/filehistory?path=${encodeURIComponent(repoPath)}&commit=${commitHash}&file=${encodeURIComponent(file)}`
  );
  const [highlight, setHighlight] = useState(true);

  // Dim every commit that did not touch this file; clean up when the view closes.
  useEffect(() => {
    if (!data || !highlight) {
      onHighlight?.(null);
      return;
    }
    onHighlight?.(new Set(data.commits.map((c) => c.hash)));
    return () => onHighlight?.(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, highlight]);

  if (error) return <p className="p-3 text-sm text-del">{error}</p>;
  if (!data) return <p className="p-3 text-sm text-muted">Searching history…</p>;

  return (
    <div>
      <div className="px-3 py-2 border-b border-line flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-muted m-0">
          {data.totalChanges} commit{data.totalChanges === 1 ? "" : "s"} changed this file
          {data.truncated && " (history scan stopped early)"}. Renames are not followed.
        </p>
        <label className="flex items-center gap-1.5 text-xs text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={highlight}
            onChange={(e) => setHighlight(e.target.checked)}
            className="accent-[rgb(var(--accent))]"
          />
          Highlight in graph
        </label>
      </div>
      <ul className="m-0 p-0 list-none">
        {data.commits.map((c) => {
          const st = STATUS_STYLE[c.status];
          return (
            <li key={c.hash}>
              <button
                onClick={() => onGoToCommit?.(c.hash)}
                className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-raised border-b border-white/[0.06]"
              >
                <span className={`mt-0.5 w-5 h-5 flex-shrink-0 rounded text-[10px] font-bold flex items-center justify-center ${st.cls}`} title={c.status}>
                  {st.letter}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] text-fg truncate">{c.message}</span>
                  <span className="block text-[11px] text-muted truncate">
                    <span className="font-mono text-accent">{c.hash.slice(0, 7)}</span> · {c.author} · {ago(c.timestamp)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
