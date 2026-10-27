/**
 * gitObjectParser.ts
 *
 * Reads, decompresses, and decodes raw Git objects directly from a
 * repository's .git/objects directory — both loose objects and objects
 * stored in packfiles (via packParser.ts) — without shelling out to the
 * native `git` CLI for any of the actual object decoding.
 *
 * Git object format (after zlib decompression):
 *   "<type> <size>\0<content>"
 *
 * Supported types: blob, tree, commit
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { readObjectFromPacks, describePackedObject, objectDirsFor, PackedObjectInfo } from "./packParser";

export type GitObjectType = "blob" | "tree" | "commit" | "tag";

export interface ParsedBlob {
  type: "blob";
  hash: string;
  size: number;
  content: Buffer;
}

export interface TreeEntry {
  mode: string;
  name: string;
  hash: string;
  isDirectory: boolean;
}

export interface ParsedTree {
  type: "tree";
  hash: string;
  size: number;
  entries: TreeEntry[];
}

export interface CommitPerson {
  name: string;
  email: string;
  timestamp: number; // unix seconds
  timezone: string;
}

export interface ParsedCommit {
  type: "commit";
  hash: string;
  size: number;
  tree: string;
  parents: string[];
  author: CommitPerson;
  committer: CommitPerson;
  message: string;
}

export type ParsedGitObject = ParsedBlob | ParsedTree | ParsedCommit;

/**
 * Resolves the on-disk path for a loose object given its 40-char SHA-1 hash.
 * Git shards objects into a subdirectory named after the first 2 hex chars.
 */
function objectPathFor(repoPath: string, hash: string): string {
  if (!/^[0-9a-f]{40}$/i.test(hash)) {
    throw new Error(`Invalid Git object hash: "${hash}"`);
  }
  const dir = hash.slice(0, 2);
  const file = hash.slice(2);
  // Own object directory first, then any alternates (shared / reference clones).
  const candidates = objectDirsFor(repoPath).map((d) => path.join(d, dir, file));
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

/**
 * Decompresses raw object bytes and splits the "<type> <size>\0" header
 * from the payload.
 */
function inflateAndSplitHeader(raw: Buffer): {
  type: GitObjectType;
  size: number;
  payload: Buffer;
} {
  const inflated = zlib.inflateSync(raw);
  const nullIndex = inflated.indexOf(0);
  if (nullIndex === -1) {
    throw new Error("Malformed object: no null byte terminating header");
  }
  const header = inflated.subarray(0, nullIndex).toString("utf8");
  const payload = inflated.subarray(nullIndex + 1);

  const [type, sizeStr] = header.split(" ");
  const size = parseInt(sizeStr, 10);

  if (payload.length !== size) {
    throw new Error(
      `Size mismatch for object: header says ${size} bytes, payload is ${payload.length} bytes`
    );
  }

  return { type: type as GitObjectType, size, payload };
}

/** Parses a tree object's binary entry list into structured entries. */
function parseTreeEntries(payload: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;

  while (offset < payload.length) {
    // "<mode> <name>\0<20-byte binary sha1>"
    const spaceIndex = payload.indexOf(0x20, offset); // ' '
    const mode = payload.subarray(offset, spaceIndex).toString("utf8");

    const nullIndex = payload.indexOf(0, spaceIndex);
    const name = payload.subarray(spaceIndex + 1, nullIndex).toString("utf8");

    const hashStart = nullIndex + 1;
    const hashEnd = hashStart + 20;
    const hash = payload.subarray(hashStart, hashEnd).toString("hex");

    entries.push({
      mode,
      name,
      hash,
      isDirectory: mode === "40000",
    });

    offset = hashEnd;
  }

  return entries;
}

/** Parses a single "name <email> <timestamp> <timezone>" author/committer line. */
function parsePersonLine(line: string): CommitPerson {
  // e.g. "Jane Dev <jane@example.com> 1737331200 -0700"
  const match = line.match(/^(.*) <(.+)> (\d+) ([+-]\d{4})$/);
  if (!match) {
    throw new Error(`Could not parse author/committer line: "${line}"`);
  }
  const [, name, email, timestamp, timezone] = match;
  return { name, email, timestamp: parseInt(timestamp, 10), timezone };
}

/** Parses a commit object's UTF-8 text payload into structured fields. */
function parseCommitPayload(payload: Buffer): {
  tree: string;
  parents: string[];
  author: CommitPerson;
  committer: CommitPerson;
  message: string;
} {
  const text = payload.toString("utf8");
  const [headerBlock, ...messageParts] = text.split("\n\n");
  const message = messageParts.join("\n\n").trimEnd();

  const lines = headerBlock.split("\n");
  let tree = "";
  const parents: string[] = [];
  let author: CommitPerson | null = null;
  let committer: CommitPerson | null = null;

  for (const line of lines) {
    if (line.startsWith("tree ")) {
      tree = line.slice("tree ".length).trim();
    } else if (line.startsWith("parent ")) {
      parents.push(line.slice("parent ".length).trim());
    } else if (line.startsWith("author ")) {
      author = parsePersonLine(line.slice("author ".length));
    } else if (line.startsWith("committer ")) {
      committer = parsePersonLine(line.slice("committer ".length));
    }
  }

  if (!tree || !author || !committer) {
    throw new Error("Commit object missing required fields (tree/author/committer)");
  }

  return { tree, parents, author, committer, message };
}

/**
 * Resolves an object's type and decompressed payload, trying loose storage
 * first and falling back to packed storage (via packParser.ts) — mirroring
 * how Git itself resolves objects from either location transparently.
 */
function getTypeAndPayload(
  repoPath: string,
  hash: string
): { type: GitObjectType; payload: Buffer } {
  const objPath = objectPathFor(repoPath, hash);

  if (fs.existsSync(objPath)) {
    const raw = fs.readFileSync(objPath);
    const { type, payload } = inflateAndSplitHeader(raw);
    return { type, payload };
  }

  const packed = readObjectFromPacks(repoPath, hash);
  if (packed) {
    return { type: packed.type, payload: packed.payload };
  }

  throw new Error(`Object ${hash} not found as a loose object or in any pack in ${repoPath}`);
}

/**
 * Recomputes the SHA-1 hash of an object (loose or packed) to verify our
 * parser reproduces Git's own content-addressable hash. Git's object ID is
 * always sha1("<type> <size>\0<content>"), regardless of storage form.
 */
export function verifyObjectHash(repoPath: string, hash: string): boolean {
  const { type, payload } = getTypeAndPayload(repoPath, hash);
  const header = Buffer.from(`${type} ${payload.length}\0`);
  const recomputed = crypto
    .createHash("sha1")
    .update(Buffer.concat([header, payload]))
    .digest("hex");
  return recomputed === hash;
}

/**
 * Main entry point: reads an object by hash (loose or packed), and returns
 * a fully parsed, typed representation.
 */
export function parseObject(repoPath: string, hash: string): ParsedGitObject {
  const { type, payload } = getTypeAndPayload(repoPath, hash);
  const size = payload.length;

  switch (type) {
    case "blob":
      return { type: "blob", hash, size, content: payload };

    case "tree":
      return { type: "tree", hash, size, entries: parseTreeEntries(payload) };

    case "commit": {
      const { tree, parents, author, committer, message } = parseCommitPayload(payload);
      return { type: "commit", hash, size, tree, parents, author, committer, message };
    }

    default:
      throw new Error(`Unsupported or unhandled object type: "${type}"`);
  }
}

/** Reads a ref file (e.g. refs/heads/main) and returns the commit hash it points to. */
export function resolveRef(repoPath: string, ref: string = "refs/heads/main"): string {
  const refPath = path.join(repoPath, ".git", ref);
  if (fs.existsSync(refPath)) {
    return fs.readFileSync(refPath, "utf8").trim();
  }

  // Fall back to packed-refs (Git compacts refs here after gc/clone)
  const packedRefsPath = path.join(repoPath, ".git", "packed-refs");
  if (fs.existsSync(packedRefsPath)) {
    const lines = fs.readFileSync(packedRefsPath, "utf8").split("\n");
    for (const line of lines) {
      if (line.endsWith(ref)) {
        return line.split(" ")[0];
      }
    }
  }

  throw new Error(`Could not resolve ref "${ref}" in repository at ${repoPath}`);
}

/** Recursively collects loose ref files under a directory (handles names like feature/login). */
function collectLooseRefs(dir: string, prefix: string, out: Map<string, string>): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectLooseRefs(full, `${prefix}${entry.name}/`, out);
    } else {
      const value = fs.readFileSync(full, "utf8").trim();
      if (/^[0-9a-f]{40}$/i.test(value)) out.set(`${prefix}${entry.name}`, value);
    }
  }
}

/**
 * Lists branch refs: local branches (refs/heads) and remote-tracking
 * branches (refs/remotes/<remote>/*), from both loose ref files and
 * .git/packed-refs. Loose files win over packed entries, as in Git.
 * A fresh clone only has ONE local branch, so remote branches are what
 * make the other branches of a cloned repo visible.
 */
export function listBranchRefs(repoPath: string): { name: string; hash: string; remote: boolean }[] {
  const gitDir = path.join(repoPath, ".git");
  const all = new Map<string, string>(); // full ref name -> hash

  // 1. packed-refs (lower priority)
  const packedPath = path.join(gitDir, "packed-refs");
  if (fs.existsSync(packedPath)) {
    for (const line of fs.readFileSync(packedPath, "utf8").split("\n")) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [hash, name] = line.trim().split(" ");
      if (hash && name && /^[0-9a-f]{40}$/i.test(hash)) all.set(name, hash);
    }
  }

  // 2. loose refs override packed ones
  collectLooseRefs(path.join(gitDir, "refs", "heads"), "refs/heads/", all);
  collectLooseRefs(path.join(gitDir, "refs", "remotes"), "refs/remotes/", all);

  const refs: { name: string; hash: string; remote: boolean }[] = [];
  for (const [fullName, hash] of all) {
    if (fullName.startsWith("refs/heads/")) {
      refs.push({ name: fullName.slice("refs/heads/".length), hash, remote: false });
    } else if (fullName.startsWith("refs/remotes/") && !fullName.endsWith("/HEAD")) {
      refs.push({ name: fullName.slice("refs/remotes/".length), hash, remote: true });
    }
  }

  // Local branches first, then remotes; alphabetical within each group.
  refs.sort((a, b) => {
    return Number(a.remote) - Number(b.remote) || a.name.localeCompare(b.name);
  });
  return refs;
}

/**
 * Reads .git/HEAD: the checked-out branch, or the commit when HEAD is detached.
 * Returns null when HEAD is missing or unreadable.
 */
export function readHead(repoPath: string): { branch: string | null; hash: string | null } | null {
  try {
    const raw = fs.readFileSync(path.join(repoPath, ".git", "HEAD"), "utf8").trim();
    const m = raw.match(/^ref:\s*refs\/heads\/(.+)$/);
    if (m) return { branch: m[1], hash: null };
    if (/^[0-9a-f]{40}$/i.test(raw)) return { branch: null, hash: raw.toLowerCase() };
  } catch {
    // no HEAD file (bare or partial clone)
  }
  return null;
}

// ---------------------------------------------------------------------------
// Raw object inspection (used by the "Raw" tab in the UI)
// ---------------------------------------------------------------------------

export interface HexRow {
  offset: number;
  hex: string; // space-separated byte pairs
  ascii: string;
}

export interface ObjectInspection {
  hash: string;
  type: GitObjectType;
  size: number; // payload size in bytes (what the header's size field says)
  storage: "loose" | "packed";
  /** Size of the zlib-compressed loose file on disk; null for packed objects. */
  storedBytes: number | null;
  /** Where and how the object sits inside a packfile (null for loose objects). */
  pack: PackedObjectInfo | null;
  /** The header Git hashes in front of the payload, e.g. "commit 234". */
  header: string;
  /** Hex dump of "<header>\0<payload>", the exact bytes that get SHA-1 hashed. */
  hexRows: HexRow[];
  hexBytesShown: number;
  hexTotalBytes: number;
  recomputedHash: string;
  verified: boolean;
  /** Readable payload for commits, tags and text blobs; null for trees and binary blobs. */
  text: string | null;
  textTruncated: boolean;
  entries: TreeEntry[] | null;
  tree: string | null;
  parents: string[] | null;
}

const HEX_DUMP_LIMIT = 256;
const TEXT_LIMIT = 20000;

export function inspectObject(repoPath: string, hash: string): ObjectInspection {
  const { type, payload } = getTypeAndPayload(repoPath, hash);

  const objPath = objectPathFor(repoPath, hash);
  const isLoose = fs.existsSync(objPath);
  const storedBytes = isLoose ? fs.statSync(objPath).size : null;

  const header = `${type} ${payload.length}`;
  const full = Buffer.concat([Buffer.from(header), Buffer.from([0]), payload]);
  const recomputedHash = crypto.createHash("sha1").update(full).digest("hex");

  const shown = full.subarray(0, HEX_DUMP_LIMIT);
  const hexRows: HexRow[] = [];
  for (let i = 0; i < shown.length; i += 16) {
    const chunk = shown.subarray(i, i + 16);
    hexRows.push({
      offset: i,
      hex: Array.from(chunk, (b) => b.toString(16).padStart(2, "0")).join(" "),
      ascii: Array.from(chunk, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".")).join(""),
    });
  }

  let text: string | null = null;
  let textTruncated = false;
  const looksBinary = payload.subarray(0, 8000).includes(0);
  if (type === "commit" || type === "tag" || (type === "blob" && !looksBinary)) {
    const s = payload.toString("utf8");
    textTruncated = s.length > TEXT_LIMIT;
    text = textTruncated ? s.slice(0, TEXT_LIMIT) : s;
  }

  let entries: TreeEntry[] | null = null;
  let tree: string | null = null;
  let parents: string[] | null = null;
  if (type === "tree") {
    entries = parseTreeEntries(payload);
  } else if (type === "commit") {
    const c = parseCommitPayload(payload);
    tree = c.tree;
    parents = c.parents;
  }

  return {
    hash,
    type,
    size: payload.length,
    storage: isLoose ? "loose" : "packed",
    storedBytes,
    pack: isLoose ? null : describePackedObject(repoPath, hash),
    header,
    hexRows,
    hexBytesShown: shown.length,
    hexTotalBytes: full.length,
    recomputedHash,
    verified: recomputedHash === hash,
    text,
    textTruncated,
    entries,
    tree,
    parents,
  };
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export interface TagRef {
  name: string;
  /** The commit this tag ultimately points at (annotated tags are followed through). */
  hash: string;
  annotated: boolean;
  /** First line of an annotated tag's message. */
  message: string | null;
}

/**
 * Lists tags from loose refs and packed-refs. Annotated tags are real `tag`
 * objects, so they are resolved by reading the object and following its
 * "object <hash>" line until a commit is reached.
 */
export function listTagRefs(repoPath: string): TagRef[] {
  const gitDir = path.join(repoPath, ".git");
  const raw = new Map<string, string>(); // full ref name -> hash of the commit or tag object

  const packedPath = path.join(gitDir, "packed-refs");
  if (fs.existsSync(packedPath)) {
    for (const line of fs.readFileSync(packedPath, "utf8").split("\n")) {
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [hash, name] = line.trim().split(" ");
      if (hash && name?.startsWith("refs/tags/") && /^[0-9a-f]{40}$/i.test(hash)) raw.set(name, hash);
    }
  }
  collectLooseRefs(path.join(gitDir, "refs", "tags"), "refs/tags/", raw);

  const out: TagRef[] = [];
  for (const [fullName, startHash] of raw) {
    try {
      let cur = startHash;
      let annotated = false;
      let message: string | null = null;
      let commit: string | null = null;

      for (let depth = 0; depth < 6; depth++) {
        const { type, payload } = getTypeAndPayload(repoPath, cur);
        if (type === "commit") {
          commit = cur;
          break;
        }
        if (type !== "tag") break;
        annotated = true;
        const text = payload.toString("utf8");
        if (message === null) {
          const idx = text.indexOf("\n\n");
          if (idx !== -1) message = text.slice(idx + 2).trim().split("\n")[0] || null;
        }
        const m = text.match(/^object ([0-9a-f]{40})/m);
        if (!m) break;
        cur = m[1];
      }

      if (commit) out.push({ name: fullName.slice("refs/tags/".length), hash: commit, annotated, message });
    } catch {
      // A tag pointing at a missing object (e.g. a shallow clone) is skipped rather than failing the page.
    }
  }
  return out;
}
