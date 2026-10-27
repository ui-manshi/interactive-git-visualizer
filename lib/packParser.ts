/**
 * packParser.ts
 *
 * Reads objects directly out of Git packfiles (.git/objects/pack/*.pack),
 * using the accompanying .idx file for O(log n) hash -> offset lookup.
 * This is necessary because every real-world clone/fetch transfers objects
 * as packfiles, not loose objects — a native reader here means the tool
 * doesn't depend on `git unpack-objects` or any other CLI behavior.
 *
 * Implements:
 *   - Git pack idx v2 parsing (fan-out table + binary search)
 *   - Pack object header parsing (type + size, variable-length encoding)
 *   - OFS_DELTA and REF_DELTA resolution (git's delta-compression scheme)
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";

export type RawObjectType = "commit" | "tree" | "blob" | "tag";

export interface RawPackObject {
  type: RawObjectType;
  payload: Buffer;
}

const OBJ_TYPE_NAMES: Record<number, RawObjectType> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
};

interface ParsedIndex {
  packPath: string;
  fanout: number[]; // 256 entries, cumulative counts
  hashes: Buffer; // objectCount * 20 bytes, sorted
  offsets: number[]; // objectCount entries, resolved to absolute file offsets
  objectCount: number;
}

// Cache parsed .idx files per repo. Each entry remembers the pack directory's
// modification time: git adds/removes files there on gc, repack and fetch, so
// a changed mtime means our parsed indexes may be stale and must be reloaded.
const indexCache = new Map<string, { signature: string; indexes: ParsedIndex[] }>();

function packDirFor(repoPath: string): string {
  return path.join(repoPath, ".git", "objects", "pack");
}

/**
 * Every object directory Git would search for this repository: its own, plus
 * any listed in .git/objects/info/alternates (used by `git clone --shared`,
 * `--reference`, and some forks), followed recursively.
 */
export function objectDirsFor(repoPath: string): string[] {
  const primary = path.join(repoPath, ".git", "objects");
  const dirs = [primary];
  const queue = [primary];
  for (let depth = 0; queue.length && depth < 5; depth++) {
    const dir = queue.shift()!;
    const altFile = path.join(dir, "info", "alternates");
    if (!fs.existsSync(altFile)) continue;
    for (const line of fs.readFileSync(altFile, "utf8").split("\n")) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      const resolved = path.resolve(dir, entry); // relative entries are relative to the objects dir
      if (!dirs.includes(resolved) && fs.existsSync(resolved)) {
        dirs.push(resolved);
        queue.push(resolved);
      }
    }
  }
  return dirs;
}

/** Parses a Git pack .idx (version 2) file into an in-memory lookup table. */
function parseIdxFile(idxPath: string, packPath: string): ParsedIndex {
  const buf = fs.readFileSync(idxPath);

  const magic = buf.readUInt32BE(0);
  const version = buf.readUInt32BE(4);
  if (magic !== 0xff744f63 || version !== 2) {
    throw new Error(
      `Unsupported idx file format at ${idxPath} (only pack idx v2 is supported)`
    );
  }

  let offset = 8;

  // Fan-out table: 256 x 4-byte cumulative counts.
  const fanout: number[] = new Array(256);
  for (let i = 0; i < 256; i++) {
    fanout[i] = buf.readUInt32BE(offset);
    offset += 4;
  }
  const objectCount = fanout[255];

  // Sorted SHA-1 table: objectCount x 20 bytes.
  const hashesStart = offset;
  const hashes = buf.subarray(hashesStart, hashesStart + objectCount * 20);
  offset = hashesStart + objectCount * 20;

  // CRC32 table: objectCount x 4 bytes (not needed for reading, skip).
  offset += objectCount * 4;

  // 4-byte offset table: objectCount x 4 bytes. MSB set means "look up the
  // real offset in the 8-byte large-offset table" (only relevant for packs
  // larger than 2GB).
  const smallOffsetsStart = offset;
  offset += objectCount * 4;

  const largeOffsetEntries: number[] = [];
  // We don't know up front how many large offsets exist without scanning;
  // scan the small-offset table for MSB-set entries.
  const needsLargeOffset: boolean[] = new Array(objectCount).fill(false);
  let largeOffsetCount = 0;
  for (let i = 0; i < objectCount; i++) {
    const raw = buf.readUInt32BE(smallOffsetsStart + i * 4);
    if (raw & 0x80000000) {
      needsLargeOffset[i] = true;
      largeOffsetCount++;
    }
  }

  const largeOffsetsStart = offset;
  for (let i = 0; i < largeOffsetCount; i++) {
    const high = buf.readUInt32BE(largeOffsetsStart + i * 8);
    const low = buf.readUInt32BE(largeOffsetsStart + i * 8 + 4);
    largeOffsetEntries.push(high * 0x100000000 + low);
  }

  const offsets: number[] = new Array(objectCount);
  let largeIdx = 0;
  for (let i = 0; i < objectCount; i++) {
    const raw = buf.readUInt32BE(smallOffsetsStart + i * 4);
    if (raw & 0x80000000) {
      offsets[i] = largeOffsetEntries[largeIdx++];
    } else {
      offsets[i] = raw;
    }
  }

  return { packPath, fanout, hashes, offsets, objectCount };
}

/** Loads (and caches) all parsed pack indexes for a repository. */
function loadIndexesForRepo(repoPath: string): ParsedIndex[] {
  // One pack directory per object directory (own + alternates). The signature
  // changes whenever any of them gains or loses a file.
  const packDirs = objectDirsFor(repoPath).map((d) => path.join(d, "pack"));
  const signature = packDirs
    .map((d) => (fs.existsSync(d) ? String(fs.statSync(d).mtimeMs) : "-1"))
    .join("|");

  const cached = indexCache.get(repoPath);
  if (cached && cached.signature === signature) return cached.indexes;

  const indexes: ParsedIndex[] = [];
  for (const dir of packDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (file.endsWith(".idx")) {
        const idxPath = path.join(dir, file);
        const packPath = idxPath.replace(/\.idx$/, ".pack");
        if (fs.existsSync(packPath)) {
          indexes.push(parseIdxFile(idxPath, packPath));
        }
      }
    }
  }

  indexCache.set(repoPath, { signature, indexes });
  return indexes;
}

/** Binary-searches a parsed idx for a 40-char hex hash; returns its offset or null. */
function findOffsetInIndex(index: ParsedIndex, hashHex: string): number | null {
  const targetBytes = Buffer.from(hashHex, "hex");
  const firstByte = targetBytes[0];

  const low = firstByte === 0 ? 0 : index.fanout[firstByte - 1];
  const high = index.fanout[firstByte];

  let lo = low;
  let hi = high - 1;

  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const midHash = index.hashes.subarray(mid * 20, mid * 20 + 20);
    const cmp = Buffer.compare(midHash, targetBytes);
    if (cmp === 0) return index.offsets[mid];
    if (cmp < 0) lo = mid + 1;
    else hi = mid - 1;
  }

  return null;
}

/** Finds which pack (if any) contains the given object hash, and its offset. */
function locateObject(
  repoPath: string,
  hashHex: string
): { packPath: string; offset: number } | null {
  for (const index of loadIndexesForRepo(repoPath)) {
    const offset = findOffsetInIndex(index, hashHex);
    if (offset !== null) {
      return { packPath: index.packPath, offset };
    }
  }
  return null;
}

/** Reads the variable-length (type, size) header at the start of a pack object entry. */
function readObjectHeader(buf: Buffer, offset: number): {
  type: number;
  size: number;
  nextOffset: number;
} {
  let byte = buf[offset++];
  const type = (byte >> 4) & 0x7;
  let size = byte & 0x0f;
  let shift = 4;

  while (byte & 0x80) {
    byte = buf[offset++];
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }

  return { type, size, nextOffset: offset };
}

/** Reads git's variable-length "offset" encoding used by OFS_DELTA entries. */
function readOfsDeltaOffset(buf: Buffer, offset: number): {
  value: number;
  nextOffset: number;
} {
  let byte = buf[offset++];
  let value = byte & 0x7f;

  while (byte & 0x80) {
    byte = buf[offset++];
    value += 1;
    value = (value << 7) | (byte & 0x7f);
  }

  return { value, nextOffset: offset };
}

/** Reads a delta-encoding variable-length integer (used for source/target size). */
function readDeltaVarInt(buf: Buffer, pos: number): { value: number; nextPos: number } {
  let result = 0;
  let shift = 0;
  let byte: number;
  do {
    byte = buf[pos++];
    result |= (byte & 0x7f) << shift;
    shift += 7;
  } while (byte & 0x80);
  return { value: result, nextPos: pos };
}

/**
 * Applies a git delta (as used by OFS_DELTA/REF_DELTA objects) against a
 * base buffer, producing the reconstructed target object content.
 */
function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let pos = 0;
  const { value: sourceSize, nextPos: p1 } = readDeltaVarInt(delta, pos);
  pos = p1;
  const { value: targetSize, nextPos: p2 } = readDeltaVarInt(delta, pos);
  pos = p2;

  if (sourceSize !== base.length) {
    throw new Error(
      `Delta source size mismatch: expected base of ${sourceSize} bytes, got ${base.length}`
    );
  }

  const target = Buffer.alloc(targetSize);
  let targetPos = 0;

  while (pos < delta.length) {
    const opcode = delta[pos++];

    if (opcode & 0x80) {
      // Copy instruction: which of the following bytes are present is
      // encoded in the low 7 bits of the opcode.
      let copyOffset = 0;
      let copySize = 0;

      if (opcode & 0x01) copyOffset |= delta[pos++];
      if (opcode & 0x02) copyOffset |= delta[pos++] << 8;
      if (opcode & 0x04) copyOffset |= delta[pos++] << 16;
      if (opcode & 0x08) copyOffset |= (delta[pos++] << 24) >>> 0;
      if (opcode & 0x10) copySize |= delta[pos++];
      if (opcode & 0x20) copySize |= delta[pos++] << 8;
      if (opcode & 0x40) copySize |= delta[pos++] << 16;
      if (copySize === 0) copySize = 0x10000;

      base.copy(target, targetPos, copyOffset, copyOffset + copySize);
      targetPos += copySize;
    } else if (opcode !== 0) {
      // Insert instruction: opcode itself is the length of literal bytes
      // that follow in the delta stream.
      delta.copy(target, targetPos, pos, pos + opcode);
      pos += opcode;
      targetPos += opcode;
    } else {
      throw new Error("Malformed delta: reserved opcode 0 encountered");
    }
  }

  return target;
}

/** Reads `length` bytes at `position` without loading the rest of the file. */
function readAt(fd: number, position: number, length: number): Buffer {
  const buf = Buffer.alloc(length);
  const bytesRead = fs.readSync(fd, buf, 0, length, position);
  return bytesRead < length ? buf.subarray(0, bytesRead) : buf;
}

/**
 * Inflates the zlib stream starting at `position`. We know the *uncompressed*
 * size from the entry header and zlib's worst-case expansion is tiny, so we
 * read just a bit more than that; if the stream still looks truncated we
 * double the window and retry.
 */
function inflateAt(fd: number, fileSize: number, position: number, expectedSize: number): Buffer {
  let length = expectedSize + (expectedSize >> 10) + 128;
  for (;;) {
    const available = Math.max(0, fileSize - position);
    const chunk = readAt(fd, position, Math.min(length, available));
    try {
      return zlib.inflateSync(chunk);
    } catch (err) {
      if (chunk.length >= available) throw err; // already read to EOF
      length *= 2;
    }
  }
}

/**
 * Reads and fully resolves (including delta chains) the object stored at
 * a given byte offset within a pack file, using positional reads so a large
 * pack is never loaded into memory wholesale.
 */
// Delta chains re-read the same base objects over and over (every blame step,
// every diff). Resolved objects are cached with a byte budget, oldest evicted first.
const RESOLVED_BUDGET_BYTES = 64 * 1024 * 1024;
const RESOLVED_MAX_OBJECT_BYTES = 4 * 1024 * 1024;
const resolvedCache = new Map<string, RawPackObject>();
let resolvedBytes = 0;

function readObjectAtOffset(
  repoPath: string,
  fd: number,
  fileSize: number,
  packPath: string,
  offset: number
): RawPackObject {
  const key = `${packPath}:${offset}`;
  const hit = resolvedCache.get(key);
  if (hit) return hit;

  const obj = readObjectAtOffsetUncached(repoPath, fd, fileSize, packPath, offset);

  if (obj.payload.length <= RESOLVED_MAX_OBJECT_BYTES) {
    resolvedCache.set(key, obj);
    resolvedBytes += obj.payload.length;
    for (const [k, v] of resolvedCache) {
      if (resolvedBytes <= RESOLVED_BUDGET_BYTES) break;
      resolvedCache.delete(k);
      resolvedBytes -= v.payload.length;
    }
  }
  return obj;
}

function readObjectAtOffsetUncached(
  repoPath: string,
  fd: number,
  fileSize: number,
  packPath: string,
  offset: number
): RawPackObject {
  // An entry header (type/size varint + OFS offset varint or 20-byte base
  // hash) always fits comfortably in 64 bytes.
  const head = readAt(fd, offset, Math.min(64, fileSize - offset));
  const { type, size, nextOffset } = readObjectHeader(head, 0);

  if (type >= 1 && type <= 4) {
    const payload = inflateAt(fd, fileSize, offset + nextOffset, size);
    return { type: OBJ_TYPE_NAMES[type], payload };
  }

  if (type === 6) {
    // OFS_DELTA: base lives at a negative offset from this entry's start.
    const { value: negOffset, nextOffset: afterOfs } = readOfsDeltaOffset(head, nextOffset);
    const deltaData = inflateAt(fd, fileSize, offset + afterOfs, size);
    const base = readObjectAtOffset(repoPath, fd, fileSize, packPath, offset - negOffset);
    return { type: base.type, payload: applyDelta(base.payload, deltaData) };
  }

  if (type === 7) {
    // REF_DELTA: next 20 bytes are the base object's SHA-1 hash.
    const baseHash = head.subarray(nextOffset, nextOffset + 20).toString("hex");
    const deltaData = inflateAt(fd, fileSize, offset + nextOffset + 20, size);

    const loc = locateObject(repoPath, baseHash);
    if (!loc) throw new Error(`REF_DELTA base object ${baseHash} not found in any pack`);
    const base = readFromPack(repoPath, loc.packPath, loc.offset);
    return { type: base.type, payload: applyDelta(base.payload, deltaData) };
  }

  throw new Error(`Unknown pack object type code: ${type}`);
}

/**
 * Opens the pack, reads one object, and closes it again. The handle is
 * deliberately NOT kept open between calls: on Windows an open handle stops
 * `git gc` / `git fetch` from replacing or deleting pack files.
 */
function readFromPack(repoPath: string, packPath: string, offset: number): RawPackObject {
  const fd = fs.openSync(packPath, "r");
  try {
    const fileSize = fs.fstatSync(fd).size;
    return readObjectAtOffset(repoPath, fd, fileSize, packPath, offset);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Public entry point: looks up an object by hash across all packs in a
 * repository and returns its fully resolved type + content, or null if
 * the object isn't found in any pack (caller should then check loose
 * objects instead).
 */
export function readObjectFromPacks(repoPath: string, hashHex: string): RawPackObject | null {
  const location = locateObject(repoPath, hashHex);
  if (!location) return null;
  return readFromPack(repoPath, location.packPath, location.offset);
}

/** Clears the cached idx data for a repo (call after a fresh clone/fetch). */
export function invalidatePackCache(repoPath: string): void {
  indexCache.delete(repoPath);
  resolvedCache.clear();
  resolvedBytes = 0;
}


// ---------------------------------------------------------------------------
// Inspection: how is an object stored, and what do the packs look like?
// ---------------------------------------------------------------------------

export type PackEntryType = "commit" | "tree" | "blob" | "tag" | "ofs_delta" | "ref_delta";

const ENTRY_TYPE_NAMES: Record<number, PackEntryType> = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
  6: "ofs_delta",
  7: "ref_delta",
};

export interface PackChainStep {
  hash: string | null;
  offset: number;
  entryType: PackEntryType;
  /** Bytes this entry occupies in the pack file (header + compressed data). */
  storedBytes: number | null;
}

export interface PackedObjectInfo {
  packFile: string;
  offset: number;
  /** How the object itself is stored: whole, or as a delta against another object. */
  entryType: PackEntryType;
  /** Size of the stored data once inflated (the delta instructions for delta entries). */
  inflatedSize: number;
  storedBytes: number | null;
  /** This object first, then each base it depends on, ending at a full object. */
  chain: PackChainStep[];
  depth: number;
  truncated: boolean;
}

interface IndexLookups {
  offsetToHash: Map<number, string>;
  sortedOffsets: number[];
}
const lookupCache = new WeakMap<ParsedIndex, IndexLookups>();

function lookupsFor(index: ParsedIndex): IndexLookups {
  let l = lookupCache.get(index);
  if (!l) {
    const offsetToHash = new Map<number, string>();
    for (let i = 0; i < index.objectCount; i++) {
      offsetToHash.set(index.offsets[i], index.hashes.subarray(i * 20, i * 20 + 20).toString("hex"));
    }
    l = { offsetToHash, sortedOffsets: [...index.offsets].sort((a, b) => a - b) };
    lookupCache.set(index, l);
  }
  return l;
}

/** The pack ends with a 20-byte checksum; an entry runs until the next entry starts. */
function storedBytesAt(index: ParsedIndex, offset: number, fileSize: number): number | null {
  const sorted = lookupsFor(index).sortedOffsets;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] === offset) {
      const next = mid + 1 < sorted.length ? sorted[mid + 1] : fileSize - 20;
      return next - offset;
    }
    if (sorted[mid] < offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

/** Describes where and how an object sits in the packs, or null if it is not packed. */
export function describePackedObject(repoPath: string, hashHex: string): PackedObjectInfo | null {
  const start = locateObject(repoPath, hashHex);
  if (!start) return null;

  const indexes = loadIndexesForRepo(repoPath);
  const chain: PackChainStep[] = [];
  let packPath = start.packPath;
  let offset = start.offset;
  let first: { entryType: PackEntryType; inflatedSize: number } | null = null;
  let truncated = false;

  for (let guard = 0; guard < 1000; guard++) {
    const index = indexes.find((i) => i.packPath === packPath);
    const fd = fs.openSync(packPath, "r");
    let next: { packPath: string; offset: number } | null = null;
    try {
      const fileSize = fs.fstatSync(fd).size;
      const head = readAt(fd, offset, Math.min(64, fileSize - offset));
      const { type, size, nextOffset } = readObjectHeader(head, 0);
      const entryType = ENTRY_TYPE_NAMES[type];
      if (!entryType) throw new Error(`Unknown pack object type code: ${type}`);
      if (!first) first = { entryType, inflatedSize: size };

      chain.push({
        hash: index ? lookupsFor(index).offsetToHash.get(offset) ?? null : null,
        offset,
        entryType,
        storedBytes: index ? storedBytesAt(index, offset, fileSize) : null,
      });

      if (type === 6) {
        next = { packPath, offset: offset - readOfsDeltaOffset(head, nextOffset).value };
      } else if (type === 7) {
        const baseHash = head.subarray(nextOffset, nextOffset + 20).toString("hex");
        const loc = locateObject(repoPath, baseHash);
        if (!loc) {
          chain.push({ hash: baseHash, offset: -1, entryType: "blob", storedBytes: null });
          truncated = true;
        } else next = loc;
      }
    } finally {
      fs.closeSync(fd);
    }
    if (!next) break;
    packPath = next.packPath;
    offset = next.offset;
  }

  return {
    packFile: path.basename(start.packPath),
    offset: start.offset,
    entryType: first!.entryType,
    inflatedSize: first!.inflatedSize,
    storedBytes: chain[0].storedBytes,
    chain,
    depth: chain.length - 1,
    truncated,
  };
}

export interface PackStats {
  file: string;
  bytes: number;
  objects: number;
  /** How many entries are stored whole vs. as deltas, per type. */
  entries: Record<PackEntryType, number>;
  maxDeltaDepth: number | null;
  inAlternate: boolean;
}

const DEPTH_SCAN_LIMIT = 300_000;

/** Counts entry types in every pack by reading only each entry's small header (no inflating). */
export function packStats(repoPath: string): PackStats[] {
  const primaryPackDir = packDirFor(repoPath);
  return loadIndexesForRepo(repoPath).map((index) => {
    const entries: Record<PackEntryType, number> = { commit: 0, tree: 0, blob: 0, tag: 0, ofs_delta: 0, ref_delta: 0 };
    const fd = fs.openSync(index.packPath, "r");
    const depthMemo = new Map<number, number>();
    let maxDepth: number | null = index.objectCount <= DEPTH_SCAN_LIMIT ? 0 : null;
    try {
      const fileSize = fs.fstatSync(fd).size;

      // Header-only walk of the delta chain, memoised so each entry is visited once.
      const depthOf = (offset: number, guard = 0): number => {
        const known = depthMemo.get(offset);
        if (known !== undefined) return known;
        if (guard > 5000) return 0;
        const head = readAt(fd, offset, Math.min(64, fileSize - offset));
        const { type, nextOffset } = readObjectHeader(head, 0);
        let depth = 0;
        if (type === 6) depth = depthOf(offset - readOfsDeltaOffset(head, nextOffset).value, guard + 1) + 1;
        else if (type === 7) {
          const base = findOffsetInIndex(index, head.subarray(nextOffset, nextOffset + 20).toString("hex"));
          depth = base === null ? 1 : depthOf(base, guard + 1) + 1; // bases in another pack count as one step
        }
        depthMemo.set(offset, depth);
        return depth;
      };

      for (let i = 0; i < index.objectCount; i++) {
        const offset = index.offsets[i];
        const head = readAt(fd, offset, 1);
        const name = ENTRY_TYPE_NAMES[(head[0] >> 4) & 0x7];
        if (name) entries[name]++;
        if (maxDepth !== null && (name === "ofs_delta" || name === "ref_delta")) {
          maxDepth = Math.max(maxDepth, depthOf(offset));
        }
      }

      return {
        file: path.basename(index.packPath),
        bytes: fileSize,
        objects: index.objectCount,
        entries,
        maxDeltaDepth: maxDepth,
        inAlternate: path.dirname(index.packPath) !== primaryPackDir,
      };
    } finally {
      fs.closeSync(fd);
    }
  });
}

/** Counts loose objects (files under objects/xx/) in the repository's own object directory. */
export function looseStats(repoPath: string, limit = 200_000): { count: number; bytes: number; truncated: boolean } {
  const root = path.join(repoPath, ".git", "objects");
  let count = 0;
  let bytes = 0;
  let truncated = false;
  if (!fs.existsSync(root)) return { count, bytes, truncated };
  outer: for (const dir of fs.readdirSync(root)) {
    if (!/^[0-9a-f]{2}$/.test(dir)) continue;
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (!/^[0-9a-f]{38}$/.test(file)) continue;
      count++;
      bytes += fs.statSync(path.join(root, dir, file)).size;
      if (count >= limit) {
        truncated = true;
        break outer;
      }
    }
  }
  return { count, bytes, truncated };
}
