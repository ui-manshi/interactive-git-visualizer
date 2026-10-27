/**
 * repoResolver.ts
 *
 * Accepts either:
 *   - an absolute local filesystem path to a repo (must contain .git/), or
 *   - a remote URL (https://github.com/user/repo, git@github.com:user/repo.git, etc.)
 *
 * For remote URLs, clones the repo into a cached temp directory on disk.
 * Objects arrive as packfiles after clone/fetch — that's fine, since
 * gitObjectParser.ts reads packed objects natively via packParser.ts.
 * `git` itself is only used here for the network transfer (clone/fetch),
 * never for reading or decoding object content.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execSync } from "child_process";
import { invalidatePackCache } from "./packParser";

const CLONE_CACHE_DIR = path.join(os.tmpdir(), "git-visualizer-clones");

// Large repos (lots of history or big assets) can take a while on first
// clone. 5 minutes gives realistic headroom without hanging forever on a
// truly broken/unreachable URL.
// Written only after `git clone` exits successfully. Without it, a clone that
// was interrupted (server stopped, network drop) leaves a .git folder behind
// that looks valid but has no refs or objects, producing an empty graph.
const COMPLETE_MARKER = ".visualizer-clone-complete";

const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;

// Every API call resolves the repo first. Without throttling, browsing files
// in a remote repo would run `git fetch` (a network round-trip) on each click.
const FETCH_INTERVAL_MS = 60 * 1000;
const lastFetchAt = new Map<string, number>();

function isRemoteUrl(input: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(input.trim());
}

function cacheKeyFor(url: string): string {
  return crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);
}

/**
 * Resolves a user-provided path or URL to a local filesystem directory
 * that contains a `.git` folder, cloning the remote repo first if needed.
 */
export function resolveRepoPath(pathOrUrl: string): string {
  const input = pathOrUrl.trim();

  if (!input) {
    throw new Error("Repository path or URL is required.");
  }

  if (!isRemoteUrl(input)) {
    const gitDir = path.join(input, ".git");
    if (!fs.existsSync(gitDir)) {
      throw new Error(
        `No .git directory found at "${input}". Provide the absolute path to a local repository, or a remote URL (e.g. https://github.com/user/repo).`
      );
    }
    return input;
  }

  // Remote URL path: clone into (or reuse) a cache directory.
  if (!fs.existsSync(CLONE_CACHE_DIR)) {
    fs.mkdirSync(CLONE_CACHE_DIR, { recursive: true });
  }

  const dest = path.join(CLONE_CACHE_DIR, cacheKeyFor(input));

  // A cache folder without the completion marker is a leftover from an
  // interrupted clone — discard it and clone again.
  if (fs.existsSync(dest) && !fs.existsSync(path.join(dest, COMPLETE_MARKER))) {
    fs.rmSync(dest, { recursive: true, force: true });
  }

  if (fs.existsSync(path.join(dest, ".git"))) {
    const last = lastFetchAt.get(dest) ?? 0;
    if (Date.now() - last > FETCH_INTERVAL_MS) {
      lastFetchAt.set(dest, Date.now());
      try {
        execSync("git fetch --all --quiet", {
          cwd: dest,
          stdio: "pipe",
          timeout: FETCH_TIMEOUT_MS,
        });
        // A fetch may bring down a new pack; drop our cached idx lookups so
        // packParser.ts re-scans the pack directory on the next read.
        invalidatePackCache(dest);
      } catch {
        // Non-fatal — fall back to whatever was already cloned.
      }
    }
    return dest;
  }

  try {
    execSync(`git clone --quiet "${input}" "${dest}"`, {
      stdio: "pipe",
      timeout: CLONE_TIMEOUT_MS,
    });
  } catch (err) {
    // Clean up a partial clone so the next attempt starts fresh.
    fs.rmSync(dest, { recursive: true, force: true });

    const detail = err instanceof Error ? err.message : String(err);
    const timedOut = /ETIMEDOUT|timed? ?out/i.test(detail);
    throw new Error(
      timedOut
        ? `Cloning "${input}" took longer than ${CLONE_TIMEOUT_MS / 1000}s and was aborted. ` +
          `This can happen with very large repositories or a slow connection — try again, or clone it locally yourself and point this tool at the local path instead.`
        : `Failed to clone "${input}". Check that the URL is correct and the repository is accessible ` +
          `(public, or credentials/SSH keys are configured for this machine). Details: ${detail}`
    );
  }

  lastFetchAt.set(dest, Date.now());
  fs.writeFileSync(path.join(dest, COMPLETE_MARKER), new Date().toISOString());
  return dest;
}
