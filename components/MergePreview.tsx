"use client";

import { useEffect, useState } from "react";

interface PreviewSegment {
  type: "ok" | "skip" | "conflict";
  lines?: string[];
  count?: number;
  base?: string[];
  ours?: string[];
  theirs?: string[];
}

interface FilePreview {
  path: string;
  outcome: "ours-only" | "theirs-only" | "identical" | "merged" | "conflict";
  detail: string;
  conflicts: number;
  segments?: PreviewSegment[];
}

interface Data {
  unrelated: boolean;
  mergeBase: { hash: string; candidates: number } | null;
  files: FilePreview[];
  totalFiles?: number;
  summary: {
    oursOnly: number;
    theirsOnly: number;
    identical: number;
    merged: number;
    conflicted: number;
    conflictRegions: number;
  } | null;
  clean: boolean;
}

const OUTCOME: Record<FilePreview["outcome"], { label: string; cls: string }> = {
  conflict: { label: "Conflict", cls: "bg-del/20 text-del" },
  merged: { label: "Auto-merged", cls: "bg-add/20 text-add" },
  identical: { label: "Same change", cls: "bg-accent/15 text-accent" },
  "theirs-only": { label: "From theirs", cls: "bg-violet/20 text-violet" },
  "ours-only": { label: "From ours", cls: "bg-accent/15 text-accent" },
};

export default function MergePreview({
  repoPath,
  base,
  head,
  relation,
}: {
  repoPath: string;
  base: { name: string; hash: string };
  head: { name: string; hash: string };
  relation: string;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo/mergepreview?path=${encodeURIComponent(repoPath)}&base=${base.hash}&head=${head.hash}`)
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

  if (error) return <p className="text-del">{error}</p>;
  if (!data) return <p className="text-muted">Simulating the merge…</p>;
  if (data.unrelated) {
    return <p className="text-fg/90">These branches share no history, so Git would refuse to merge them without --allow-unrelated-histories.</p>;
  }

  const s = data.summary!;
  const conflicted = data.files.filter((f) => f.outcome === "conflict");
  const others = data.files.filter((f) => f.outcome !== "conflict");

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted m-0">
        What <span className="font-mono text-fg">git merge {head.name}</span> would do while on{" "}
        <span className="font-mono text-fg">{base.name}</span>. Nothing is changed in your repository.
      </p>

      {data.clean ? (
        <div className="rounded-lg border border-add/50 bg-add/10 p-3">
          <p className="m-0 font-semibold text-add">No conflicts</p>
          <p className="m-0 mt-1 text-fg/90">
            {relation === "ahead"
              ? `This would be a fast-forward: ${base.name} simply moves up to ${head.name}.`
              : relation === "behind" || relation === "same"
              ? `${base.name} already contains everything on ${head.name}; there is nothing to merge.`
              : "Git would create a merge commit with no manual fixing needed."}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-del/50 bg-del/10 p-3">
          <p className="m-0 font-semibold text-del">
            {s.conflicted} file{s.conflicted === 1 ? "" : "s"} would conflict ({s.conflictRegions} region
            {s.conflictRegions === 1 ? "" : "s"})
          </p>
          <p className="m-0 mt-1 text-fg/90">Git would stop and ask you to resolve these before the merge can finish.</p>
        </div>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span>{s.merged} auto-merged</span>
        <span>{s.theirsOnly} from {head.name}</span>
        <span>{s.oursOnly} only on {base.name}</span>
        <span>{s.identical} identical</span>
      </div>

      {[...conflicted, ...others].map((f) => (
        <FileCard key={f.path} file={f} base={base.name} head={head.name} />
      ))}
      {data.totalFiles && data.totalFiles > data.files.length && (
        <p className="text-xs text-muted m-0">Showing {data.files.length} of {data.totalFiles} files.</p>
      )}

      <p className="text-2xs text-muted m-0 leading-relaxed">
        This is a line-based three-way merge against the merge base
        {data.mergeBase && data.mergeBase.candidates > 1 ? ` (the most recent of ${data.mergeBase.candidates} candidates)` : ""}.
        Unlike Git, it does not detect renamed files, so a file renamed on one side and edited on the other appears as two separate changes.
      </p>
    </div>
  );
}

function FileCard({ file, base, head }: { file: FilePreview; base: string; head: string }) {
  const st = OUTCOME[file.outcome];
  const body = (
    <div className="flex items-start gap-2 min-w-0">
      <span className={`mt-0.5 flex-shrink-0 text-2xs font-bold px-1.5 py-0.5 rounded ${st.cls}`}>{st.label}</span>
      <span className="min-w-0">
        <span className="block font-mono text-xs text-fg break-all">{file.path}</span>
        <span className="block text-2xs text-muted">{file.detail}</span>
      </span>
    </div>
  );

  if (!file.segments) {
    return <div className="rounded-lg inset p-2.5">{body}</div>;
  }

  return (
    <details open={file.outcome === "conflict"} className="rounded-lg inset group">
      <summary className="p-2.5 cursor-pointer list-none">{body}</summary>
      <div className="border-t border-line bg-ground/60 p-2 overflow-x-auto font-mono text-2xs leading-relaxed">
        {file.segments.map((seg, i) => {
          if (seg.type === "skip") {
            return (
              <div key={i} className="text-faint px-2 py-0.5">
                … {seg.count} unchanged line{seg.count === 1 ? "" : "s"}
              </div>
            );
          }
          if (seg.type === "ok") {
            return (
              <div key={i} className="text-muted">
                {seg.lines!.map((l, j) => (
                  <div key={j} className="px-2 whitespace-pre-wrap break-all">
                    {l || " "}
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div key={i} className="my-1 rounded border border-del/40 overflow-hidden">
              <div className="px-2 py-0.5 bg-accent/15 text-accent">{`<<<<<<< ours (${base})`}</div>
              {seg.ours!.map((l, j) => (
                <div key={j} className="px-2 bg-accent/5 text-fg whitespace-pre-wrap break-all">
                  {l || " "}
                </div>
              ))}
              <div className="px-2 py-0.5 bg-raised text-muted">=======</div>
              {seg.theirs!.map((l, j) => (
                <div key={j} className="px-2 bg-violet/5 text-fg whitespace-pre-wrap break-all">
                  {l || " "}
                </div>
              ))}
              <div className="px-2 py-0.5 bg-violet/15 text-violet">{`>>>>>>> theirs (${head})`}</div>
            </div>
          );
        })}
      </div>
    </details>
  );
}
