"use client";

import { useEffect, useState } from "react";

export interface FileChange {
  path: string;
  status: "added" | "deleted" | "modified";
  binary: boolean;
  submodule: boolean;
  modeOnly: boolean;
  additions: number | null;
  deletions: number | null;
}

export interface DiffSummary {
  files: FileChange[];
  totalFiles: number;
  additions: number;
  deletions: number;
  /** Line counts were skipped for some files because they are very large. */
  statsLimited: boolean;
}

const cache = new Map<string, Promise<DiffSummary>>();

/** The summary of changes between two commits (from = null diffs against the empty tree). Cached per pair. */
export function fetchDiffSummary(repoPath: string, from: string | null, to: string): Promise<DiffSummary> {
  const url = `/api/repo/diff?path=${encodeURIComponent(repoPath)}&from=${from ?? ""}&to=${to}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        return data as DiffSummary;
      });
    // A failed request must not be cached, so the next attempt can succeed.
    p.catch(() => cache.delete(url));
    cache.set(url, p);
    if (cache.size > 200) cache.delete(cache.keys().next().value as string);
  }
  return p;
}

/** Loads the change summary for a pair of commits. `to` = null means "nothing selected yet". */
export function useDiffSummary(repoPath: string, from: string | null, to: string | null) {
  const [state, setState] = useState<{ summary: DiffSummary | null; error: string | null }>({ summary: null, error: null });
  useEffect(() => {
    if (!to) {
      setState({ summary: null, error: null });
      return;
    }
    let cancelled = false;
    setState({ summary: null, error: null });
    fetchDiffSummary(repoPath, from, to)
      .then((summary) => !cancelled && setState({ summary, error: null }))
      .catch((e) => !cancelled && setState({ summary: null, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, [repoPath, from, to]);
  return { ...state, loading: !!to && !state.summary && !state.error };
}
