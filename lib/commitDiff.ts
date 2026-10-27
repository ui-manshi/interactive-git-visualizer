/**
 * commitDiff.ts
 *
 * Diffs two commits: resolves each commit's snapshot to a flat file map,
 * compares blob hashes to find added / deleted / modified files (an
 * unchanged blob has an identical hash, so no content needs reading), and
 * runs the Myers line diff only on files that actually changed.
 */

import { listFilesAtCommit, readBlob, isBinary, FlatFile } from "./fileTree";
import { diffLines, diffStats, buildHunks, Hunk } from "./myersDiff";

/** Marker appended to a file's last line when it has no trailing newline. */
export const NO_EOL = "\u0001";

export type ChangeStatus = "added" | "deleted" | "modified";

export interface FileChange {
  path: string;
  status: ChangeStatus;
  binary: boolean;
  submodule: boolean;
  modeOnly: boolean; // same content, different mode (e.g. chmod +x)
  additions: number | null; // null = not computed
  deletions: number | null;
}

export interface CommitDiffSummary {
  files: FileChange[];
  totalFiles: number;
  additions: number;
  deletions: number;
  statsLimited: boolean; // true if line counts were skipped for some files
}

export interface FileDiff {
  path: string;
  status: ChangeStatus;
  binary: boolean;
  submodule: boolean;
  additions: number;
  deletions: number;
  approximate: boolean;
  hunks: Hunk[];
}

const STAT_FILE_LIMIT = 300;

/** Splits file content into lines; tags a missing final newline so EOF-only changes still diff. */
export function toLines(buf: Buffer): string[] {
  const text = buf.toString("utf8");
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  } else {
    lines[lines.length - 1] += NO_EOL;
  }
  return lines;
}

function toMap(files: FlatFile[]): Map<string, FlatFile> {
  return new Map(files.map((f) => [f.path, f]));
}

function loadSides(
  repoPath: string,
  from: string | null,
  to: string
): { oldMap: Map<string, FlatFile>; newMap: Map<string, FlatFile> } {
  const newMap = toMap(listFilesAtCommit(repoPath, to).files);
  const oldMap = from ? toMap(listFilesAtCommit(repoPath, from).files) : new Map<string, FlatFile>();
  return { oldMap, newMap };
}

function statusOf(o: FlatFile | undefined, n: FlatFile | undefined): ChangeStatus | null {
  if (!o && n) return "added";
  if (o && !n) return "deleted";
  if (o && n && (o.hash !== n.hash || o.mode !== n.mode)) return "modified";
  return null;
}

/** Reads one side of a file as lines, or null if binary / missing / submodule. */
function sideLines(
  repoPath: string,
  f: FlatFile | undefined
): { lines: string[]; binary: boolean } {
  if (!f || f.isSubmodule) return { lines: [], binary: false };
  const buf = readBlob(repoPath, f.hash);
  if (isBinary(buf)) return { lines: [], binary: true };
  return { lines: toLines(buf), binary: false };
}

/**
 * Summarises every file that differs between two commits. `from` may be
 * null to diff against the empty tree (i.e. show a root commit's contents).
 */
export function diffCommits(
  repoPath: string,
  from: string | null,
  to: string
): CommitDiffSummary {
  const { oldMap, newMap } = loadSides(repoPath, from, to);
  const paths = Array.from(new Set([...oldMap.keys(), ...newMap.keys()])).sort();

  const files: FileChange[] = [];
  let additions = 0;
  let deletions = 0;
  let statsLimited = false;

  for (const p of paths) {
    const o = oldMap.get(p);
    const n = newMap.get(p);
    const status = statusOf(o, n);
    if (!status) continue;

    const submodule = !!(o?.isSubmodule || n?.isSubmodule);
    const change: FileChange = {
      path: p,
      status,
      binary: false,
      submodule,
      modeOnly: !!(o && n && o.hash === n.hash),
      additions: null,
      deletions: null,
    };

    if (!submodule && !change.modeOnly) {
      if (files.length < STAT_FILE_LIMIT) {
        const oldSide = sideLines(repoPath, o);
        const newSide = sideLines(repoPath, n);
        if (oldSide.binary || newSide.binary) {
          change.binary = true;
        } else {
          const stats = diffStats(diffLines(oldSide.lines, newSide.lines).ops);
          change.additions = stats.additions;
          change.deletions = stats.deletions;
          additions += stats.additions;
          deletions += stats.deletions;
        }
      } else {
        statsLimited = true;
      }
    } else if (change.modeOnly) {
      change.additions = 0;
      change.deletions = 0;
    }

    files.push(change);
  }

  return { files, totalFiles: files.length, additions, deletions, statsLimited };
}

/** Full line-level diff (as hunks with context) for a single file between two commits. */
export function diffFile(
  repoPath: string,
  from: string | null,
  to: string,
  filePath: string
): FileDiff {
  const { oldMap, newMap } = loadSides(repoPath, from, to);
  const o = oldMap.get(filePath);
  const n = newMap.get(filePath);
  const status = statusOf(o, n);
  if (!status) {
    throw new Error(`File "${filePath}" has no changes between these commits`);
  }

  const submodule = !!(o?.isSubmodule || n?.isSubmodule);
  const base: FileDiff = {
    path: filePath,
    status,
    binary: false,
    submodule,
    additions: 0,
    deletions: 0,
    approximate: false,
    hunks: [],
  };
  if (submodule) return base;

  const oldSide = sideLines(repoPath, o);
  const newSide = sideLines(repoPath, n);
  if (oldSide.binary || newSide.binary) return { ...base, binary: true };

  const result = diffLines(oldSide.lines, newSide.lines);
  const stats = diffStats(result.ops);
  return {
    ...base,
    additions: stats.additions,
    deletions: stats.deletions,
    approximate: result.approximate,
    hunks: buildHunks(result.ops, 3),
  };
}
