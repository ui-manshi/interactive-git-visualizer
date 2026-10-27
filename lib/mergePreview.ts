/**
 * mergePreview.ts
 *
 * Simulates `git merge <theirs>` while on <ours> without touching the
 * repository: finds the merge base, lists what each side changed, and runs a
 * three-way line merge on every file both sides edited.
 *
 * Limitations (stated in the UI too): no rename detection, so a file renamed on
 * one side and edited on the other shows up as two separate changes; and only
 * the most recent merge base is used when there are several.
 */

import { readCommit, blobAtPath, changedFiles } from "./objectCache";
import { readBlob, isBinary } from "./fileTree";
import { splitLines } from "./fileInsights";
import { findMergeBase } from "./branchCompare";
import { merge3, mergedLines, MergeSegment } from "./merge3";

export type FileOutcome =
  | "ours-only" // changed only on our side: nothing to do
  | "theirs-only" // changed only on their side: taken as is
  | "identical" // both sides made the same change
  | "merged" // both sides edited it, in different places: merges cleanly
  | "conflict";

export interface PreviewSegment {
  type: "ok" | "skip" | "conflict";
  lines?: string[]; // ok
  count?: number; // skip: how many unchanged lines were collapsed
  base?: string[];
  ours?: string[];
  theirs?: string[];
}

export interface FilePreview {
  path: string;
  outcome: FileOutcome;
  /** Human-readable reason, e.g. "modify/delete: deleted on our side, modified on theirs". */
  detail: string;
  conflicts: number;
  segments?: PreviewSegment[];
}

const MAX_FILES_LISTED = 500;
const MAX_FILES_WITH_SEGMENTS = 40;
const CONTEXT = 3;
const MAX_CONFLICT_SIDE_LINES = 200;

/** Collapses long runs of unchanged lines so the payload stays small. */
function compact(segments: MergeSegment[]): PreviewSegment[] {
  const out: PreviewSegment[] = [];
  segments.forEach((seg, idx) => {
    if (seg.type === "conflict") {
      out.push({
        type: "conflict",
        base: seg.base.slice(0, MAX_CONFLICT_SIDE_LINES),
        ours: seg.ours.slice(0, MAX_CONFLICT_SIDE_LINES),
        theirs: seg.theirs.slice(0, MAX_CONFLICT_SIDE_LINES),
      });
      return;
    }
    const first = idx === 0;
    const last = idx === segments.length - 1;
    const keepHead = first ? 0 : CONTEXT;
    const keepTail = last ? 0 : CONTEXT;
    if (seg.lines.length <= keepHead + keepTail + 1) {
      out.push({ type: "ok", lines: seg.lines });
      return;
    }
    if (keepHead) out.push({ type: "ok", lines: seg.lines.slice(0, keepHead) });
    out.push({ type: "skip", count: seg.lines.length - keepHead - keepTail });
    if (keepTail) out.push({ type: "ok", lines: seg.lines.slice(seg.lines.length - keepTail) });
  });
  return out;
}

export function mergePreview(repoPath: string, oursHash: string, theirsHash: string) {
  const mb = findMergeBase(repoPath, oursHash, theirsHash);
  if (!mb) {
    return { unrelated: true as const, mergeBase: null, files: [], summary: null, clean: false };
  }

  const baseTree = readCommit(repoPath, mb.hash).tree;
  const oursTree = readCommit(repoPath, oursHash).tree;
  const theirsTree = readCommit(repoPath, theirsHash).tree;

  const oursChanged = new Set(changedFiles(repoPath, baseTree, oursTree));
  const theirsChanged = new Set(changedFiles(repoPath, baseTree, theirsTree));
  const all = [...new Set([...oursChanged, ...theirsChanged])].sort();

  const files: FilePreview[] = [];
  let withSegments = 0;

  for (const file of all) {
    const inO = oursChanged.has(file);
    const inT = theirsChanged.has(file);
    if (inO && !inT) {
      files.push({ path: file, outcome: "ours-only", detail: "Changed only on our side.", conflicts: 0 });
      continue;
    }
    if (inT && !inO) {
      files.push({ path: file, outcome: "theirs-only", detail: "Changed only on their side; taken as is.", conflicts: 0 });
      continue;
    }

    const B = blobAtPath(repoPath, baseTree, file);
    const O = blobAtPath(repoPath, oursTree, file);
    const T = blobAtPath(repoPath, theirsTree, file);

    if ((O?.hash ?? null) === (T?.hash ?? null)) {
      files.push({
        path: file,
        outcome: "identical",
        detail: !O ? "Deleted on both sides." : "Both sides made the same change.",
        conflicts: 0,
      });
      continue;
    }
    if (B && (!O || !T)) {
      files.push({
        path: file,
        outcome: "conflict",
        detail: `modify/delete: ${!O ? "deleted on our side but modified on theirs" : "modified on our side but deleted on theirs"}.`,
        conflicts: 1,
      });
      continue;
    }

    const bufs = [B, O, T].map((v) => (v ? readBlob(repoPath, v.hash) : Buffer.alloc(0)));
    if (bufs.some((b) => isBinary(b))) {
      files.push({ path: file, outcome: "conflict", detail: "Binary file changed on both sides.", conflicts: 1 });
      continue;
    }

    const result = merge3(splitLines(bufs[0]), splitLines(bufs[1]), splitLines(bufs[2]));
    const conflict = result.conflicts > 0;
    const entry: FilePreview = {
      path: file,
      outcome: conflict ? "conflict" : "merged",
      detail: !B
        ? conflict
          ? "add/add: the file was added on both sides with different content."
          : "Added on both sides with compatible content."
        : conflict
        ? `Both sides edited the same lines (${result.conflicts} conflict region${result.conflicts === 1 ? "" : "s"}).`
        : "Both sides edited this file, but in different places; it merges cleanly.",
      conflicts: result.conflicts,
    };
    if (result.approximate) entry.detail += " (The diff was too large to align exactly, so treat this as an estimate.)";
    if (withSegments < MAX_FILES_WITH_SEGMENTS) {
      entry.segments = compact(result.segments);
      withSegments++;
    }
    // A clean merge needs no segments beyond what we kept for display; mergedLines is only a sanity check.
    if (!conflict) void mergedLines(result);
    files.push(entry);
  }

  const count = (o: FileOutcome) => files.filter((f) => f.outcome === o).length;
  const conflicted = files.filter((f) => f.outcome === "conflict");

  return {
    unrelated: false as const,
    mergeBase: { hash: mb.hash, candidates: mb.candidates },
    files: files.slice(0, MAX_FILES_LISTED),
    totalFiles: files.length,
    summary: {
      oursOnly: count("ours-only"),
      theirsOnly: count("theirs-only"),
      identical: count("identical"),
      merged: count("merged"),
      conflicted: conflicted.length,
      conflictRegions: conflicted.reduce((n, f) => n + f.conflicts, 0),
    },
    clean: conflicted.length === 0,
  };
}
