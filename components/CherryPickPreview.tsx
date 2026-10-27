"use client";

import { useState } from "react";
import DagView from "./DagView";
import { laneColor } from "./lanes";
import { StatusChip } from "./RebasePreview";

interface Result {
  alreadyThere: boolean;
  step: {
    status: "clean" | "empty" | "conflict" | "not-attempted";
    filesChanged: number;
    conflictFiles: string[];
    conflictReasons: string[];
    message: string;
  };
}

export default function CherryPickPreview({
  repoPath,
  commitHash,
  refs,
}: {
  repoPath: string;
  commitHash: string;
  refs: { name: string; hash: string }[];
}) {
  const [target, setTarget] = useState(refs[0]?.name ?? "");
  const [result, setResult] = useState<{ target: { name: string; hash: string }; data: Result } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    const t = refs.find((r) => r.name === target);
    if (!t) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch(`/api/repo/cherrypick?path=${encodeURIComponent(repoPath)}&commit=${commitHash}&onto=${t.hash}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult({ target: t, data: d });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const st = result?.data.step.status;
  const diagram = result && (
    <DagView
      ariaLabel={`Cherry-pick result: a copy of the commit on top of ${result.target.name}`}
      minLanes={2}
      nodes={[
        { id: "tip", col: 0, lane: 0, label: "tip", sub: result.target.hash.slice(0, 7), color: laneColor(0), title: `Tip of ${result.target.name}` },
        {
          id: "copy",
          col: 1,
          lane: 0,
          label: "X'",
          sub: "new",
          color: laneColor(1),
          status: st === "conflict" ? "conflict" : st === "empty" ? "empty" : undefined,
          title: "The copy that cherry-pick would create",
        },
        { id: "orig", col: 1, lane: 1, label: "X", sub: commitHash.slice(0, 7), color: laneColor(1), title: "The commit being picked (unchanged)" },
      ]}
      edges={[
        { from: "copy", to: "tip" },
        { from: "orig", to: "copy", kind: "copy" },
      ]}
      tags={[
        st === "conflict"
          ? { nodeId: "copy", text: "stops here", kind: "note" }
          : { nodeId: "copy", text: result.target.name, kind: "branch" },
      ]}
    />
  );

  return (
    <section className="rounded-lg inset p-3 space-y-2.5">
      <p className="text-xs text-muted m-0">Cherry-pick preview</p>
      <p className="text-xs text-fg/90 m-0">See whether this commit would apply cleanly on another branch, without changing anything.</p>
      <div className="flex gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Branch to cherry-pick onto"
          className="flex-1 min-w-0 field rounded-md px-2 py-1.5 text-xs text-fg"
        >
          {refs.map((r) => (
            <option key={r.name} value={r.name}>
              onto {r.name}
            </option>
          ))}
        </select>
        <button
          onClick={run}
          disabled={loading || !target}
          className="text-xs font-semibold px-3 py-1.5 rounded-md btn text-fg disabled:opacity-50"
        >
          {loading ? "Checking…" : "Preview"}
        </button>
      </div>

      {error && <p className="text-xs text-del m-0">{error}</p>}
      {result && (
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <StatusChip status={result.data.step.status} />
            <p className="text-xs text-fg/90 m-0">
              {result.data.step.status === "clean" &&
                `Applies cleanly onto ${result.target.name} (${result.data.step.filesChanged} file${result.data.step.filesChanged === 1 ? "" : "s"}).`}
              {result.data.step.status === "empty" &&
                `Its changes are already present on ${result.target.name}, so git would report an empty cherry-pick.`}
              {result.data.step.status === "conflict" &&
                `Would conflict in ${result.data.step.conflictFiles.length} file${result.data.step.conflictFiles.length === 1 ? "" : "s"}.`}
            </p>
          </div>
          {result.data.step.conflictFiles.map((f, i) => (
            <p key={f} className="text-2xs font-mono text-del m-0 break-all">
              {f} <span className="font-sans text-muted">({result.data.step.conflictReasons[i]})</span>
            </p>
          ))}
          {result.data.alreadyThere && (
            <p className="text-2xs text-warn m-0">This exact commit is already part of {result.target.name}&apos;s history.</p>
          )}
          <div className="rounded-lg code-surface p-1">{diagram}</div>
          <p className="text-2xs text-muted m-0">The copy X&apos; gets a new hash; the original X stays where it is.</p>
        </div>
      )}
    </section>
  );
}
