/**
 * repoResolver.ts
 *
 * Turns what the user typed into a local directory that contains a `.git` folder.
 *
 *   - Local mode (default, `npm run dev`): an absolute path to a repo, or a remote URL.
 *   - Hosted mode (`ALLOW_LOCAL_PATHS=false`, set by the Dockerfile): ONLY public
 *     `https://github.com/<owner>/<repo>` URLs. Local paths are refused, so a public deployment
 *     cannot be used to browse the server's own files.
 *
 * Remote repos are cloned into a cache directory. Objects arrive as packfiles, which
 * gitObjectParser.ts / packParser.ts read natively. `git` is only used here for the network
 * transfer (clone/fetch), never to read or decode object content.
 *
 * Security notes
 *   - `git` is always started with an argument list (execFile), never through a shell, and the
 *     URL comes after `--`, so user input can neither inject commands nor be read as an option.
 *   - Clones are async, so a slow clone no longer freezes every other request.
 *   - Clone count, time, size and disk use are capped (see the env vars below).
 *
 * Environment variables (all optional)
 *   ALLOW_LOCAL_PATHS     "false" = hosted mode (see above). Default: true.
 *   CLONE_CACHE_DIR       Where clones are kept. Default: <os tmpdir>/git-visualizer-clones.
 *   MAX_REPO_MB           Abort a clone that grows past this size. Default: 300 hosted, unlimited local.
 *   MAX_CACHED_REPOS      Keep at most this many clones; the least recently used are deleted. Default: 25.
 *   MAX_CONCURRENT_CLONES Clones allowed at the same time. Default: 2.
 */

import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { execFile } from "child_process";
import { invalidatePackCache } from "./packParser";

// ---- Configuration (read on every call so tests and deployments can change it) ----

function allowLocalPaths(): boolean {
  return process.env.ALLOW_LOCAL_PATHS !== "false";
}

function cacheDir(): string {
  return process.env.CLONE_CACHE_DIR || path.join(os.tmpdir(), "git-visualizer-clones");
}

function intEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? n : fallback;
}

const maxRepoBytes = () => intEnv("MAX_REPO_MB", allowLocalPaths() ? 0 : 300) * 1024 * 1024;
const maxCachedRepos = () => Math.max(1, intEnv("MAX_CACHED_REPOS", 25));
const maxConcurrentClones = () => Math.max(1, intEnv("MAX_CONCURRENT_CLONES", 2));

// Written only after `git clone` exits successfully. Without it, a clone that was interrupted
// (server stopped, network drop) leaves a .git folder behind that looks valid but has no refs or
// objects, producing an empty graph.
const COMPLETE_MARKER = ".visualizer-clone-complete";

const CLONE_TIMEOUT_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 2 * 60 * 1000;

// Every API call resolves the repo first. Without throttling, browsing files in a remote repo
// would run `git fetch` (a network round-trip) on each click.
const FETCH_INTERVAL_MS = 60 * 1000;
const lastFetchAt = new Map<string, number>();

/** Environment for every git child process: never prompt for credentials, restrict transports. */
function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ALLOW_PROTOCOL: allowLocalPaths() ? "https:http:ssh" : "https",
  };
}

// ---- Input validation ----

/** Anything that looks like a remote URL rather than a filesystem path. */
export function isRemoteUrl(input: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/i.test(input.trim());
}

const GITHUB_REPO = /^https:\/\/github\.com\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/?$/;

export class InputError extends Error {}

/**
 * Validates a remote URL and returns the exact string that is handed to `git clone`.
 * Hosted mode accepts only plain public GitHub repo URLs; local mode is more permissive but
 * still rejects whitespace and control characters.
 */
export function parseRemoteUrl(input: string): string {
  const url = input.trim();
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f"'`\\$;|&<>(){}]/.test(url)) {
    throw new InputError("That URL contains characters that are not allowed.");
  }
  if (!allowLocalPaths()) {
    const m = GITHUB_REPO.exec(url);
    if (!m || m[1] === "." || m[1] === ".." || m[2] === "." || m[2] === "..") {
      throw new InputError(
        "Only public GitHub repository URLs are supported here, for example https://github.com/octocat/Hello-World"
      );
    }
    return `https://github.com/${m[1]}/${m[2]}.git`;
  }
  if (url.length > 2048 || url.startsWith("-")) throw new InputError("That URL is not valid.");
  return url;
}

function cacheKeyFor(url: string): string {
  return crypto.createHash("sha1").update(url.toLowerCase()).digest("hex").slice(0, 16);
}

// ---- Git helpers ----

function runGit(args: string[], opts: { cwd?: string; timeout: number }) {
  let child: ReturnType<typeof execFile> | undefined;
  const done = new Promise<void>((resolve, reject) => {
    child = execFile(
      "git",
      args,
      { cwd: opts.cwd, timeout: opts.timeout, env: gitEnv(), maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, _stdout, stderr) => (err ? reject(Object.assign(err, { stderr })) : resolve())
    );
  });
  return { child: child!, done };
}

/** Total size of a directory in bytes; stops counting once `limit` is passed. */
function dirSize(dir: string, limit: number): number {
  let total = 0;
  const stack = [dir];
  while (stack.length > 0 && total <= limit) {
    const d = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) stack.push(full);
      else if (e.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch {}
      }
    }
  }
  return total;
}

// A refresh is a network round trip. Running it synchronously froze the whole server (every
// request, including static files) for seconds on each page load; it runs in the background so the
// page is served from the existing clone at once and new commits show up on the next load.
const refreshing = new Set<string>();

function refreshInBackground(dest: string) {
  if (refreshing.has(dest)) return;
  refreshing.add(dest);
  runGit(["fetch", "--all", "--quiet"], { cwd: dest, timeout: FETCH_TIMEOUT_MS }).done
    .then(() => invalidatePackCache(dest)) // a fetch may bring down a new pack
    .catch(() => {}) // non-fatal: keep serving what was already cloned
    .finally(() => refreshing.delete(dest));
}

/** Delete the least recently used clones beyond the cap. */
function evictOldClones(keep: string) {
  const root = cacheDir();
  let dirs: { dir: string; used: number }[];
  try {
    dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const dir = path.join(root, e.name);
        let used = 0;
        try {
          used = fs.statSync(path.join(dir, COMPLETE_MARKER)).mtimeMs;
        } catch {}
        return { dir, used };
      });
  } catch {
    return;
  }
  const excess = dirs.length - maxCachedRepos();
  if (excess <= 0) return;
  dirs
    .filter((d) => d.dir !== keep && !inflight.has(d.dir))
    .sort((a, b) => a.used - b.used)
    .slice(0, excess)
    .forEach((d) => {
      lastFetchAt.delete(d.dir);
      invalidatePackCache(d.dir);
      fs.rmSync(d.dir, { recursive: true, force: true });
    });
}

// ---- Cloning ----

const inflight = new Map<string, Promise<string>>();
let activeClones = 0;

async function cloneInto(url: string, dest: string, display: string): Promise<string> {
  if (activeClones >= maxConcurrentClones()) {
    throw new InputError("The server is busy cloning other repositories. Please try again in a minute.");
  }
  activeClones++;
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    // Discard leftovers of an interrupted clone.
    fs.rmSync(dest, { recursive: true, force: true });

    // --no-checkout: only the object database is needed, not a working copy (less disk and time).
    const { child, done } = runGit(
      ["-c", "protocol.file.allow=never", "clone", "--quiet", "--no-checkout", "--", url, dest],
      { timeout: CLONE_TIMEOUT_MS }
    );

    // Abort a clone that grows beyond the size cap.
    const cap = maxRepoBytes();
    let tooBig = false;
    const watcher =
      cap > 0
        ? setInterval(() => {
            if (dirSize(dest, cap) > cap) {
              tooBig = true;
              child.kill("SIGKILL");
            }
          }, 1500)
        : undefined;

    try {
      await done;
    } catch (err) {
      fs.rmSync(dest, { recursive: true, force: true });
      if (tooBig) {
        throw new InputError(
          `"${display}" is larger than this server allows (${Math.round(cap / 1024 / 1024)} MB). Try a smaller repository, or run the tool locally.`
        );
      }
      const e = err as NodeJS.ErrnoException & { killed?: boolean; stderr?: string };
      if (e.killed || /ETIMEDOUT|timed? ?out/i.test(e.message)) {
        throw new InputError(
          `Cloning "${display}" took longer than ${CLONE_TIMEOUT_MS / 1000}s and was aborted. Try again, or clone it locally and point this tool at the local path.`
        );
      }
      // Hosted mode keeps git's raw output (which can contain server paths) out of the response.
      const detail = allowLocalPaths() ? ` Details: ${(e.stderr || e.message).toString().trim()}` : "";
      throw new InputError(
        `Failed to clone "${display}". Check that the URL is correct and the repository is public.${detail}`
      );
    } finally {
      if (watcher) clearInterval(watcher);
    }

    if (cap > 0 && dirSize(dest, cap) > cap) {
      fs.rmSync(dest, { recursive: true, force: true });
      throw new InputError(
        `"${display}" is larger than this server allows (${Math.round(cap / 1024 / 1024)} MB). Try a smaller repository, or run the tool locally.`
      );
    }

    fs.writeFileSync(path.join(dest, COMPLETE_MARKER), new Date().toISOString());
    lastFetchAt.set(dest, Date.now());
    evictOldClones(dest);
    return dest;
  } finally {
    activeClones--;
  }
}

/**
 * Resolves a user-provided path or URL to a local directory that contains a `.git` folder,
 * cloning a remote repository first if needed. Concurrent requests for the same new repository
 * share one clone.
 */
export async function resolveRepoPath(pathOrUrl: string): Promise<string> {
  const input = (pathOrUrl ?? "").trim();
  if (!input) throw new InputError("Repository path or URL is required.");

  if (!isRemoteUrl(input)) {
    if (!allowLocalPaths()) {
      throw new InputError(
        "Local paths are disabled on this server. Paste a public GitHub URL, for example https://github.com/octocat/Hello-World"
      );
    }
    if (!fs.existsSync(path.join(input, ".git"))) {
      throw new InputError(
        `No .git directory found at "${input}". Provide the absolute path to a local repository, or a remote URL (e.g. https://github.com/user/repo).`
      );
    }
    return input;
  }

  const url = parseRemoteUrl(input);
  const dest = path.join(cacheDir(), cacheKeyFor(url));

  // Already cloned (and the clone finished): serve it, refresh in the background now and then.
  if (fs.existsSync(path.join(dest, COMPLETE_MARKER)) && fs.existsSync(path.join(dest, ".git"))) {
    const last = lastFetchAt.get(dest) ?? 0;
    if (Date.now() - last > FETCH_INTERVAL_MS) {
      lastFetchAt.set(dest, Date.now());
      try {
        const now = new Date();
        fs.utimesSync(path.join(dest, COMPLETE_MARKER), now, now); // marks it recently used
      } catch {}
      refreshInBackground(dest);
    }
    return dest;
  }

  let pending = inflight.get(dest);
  if (!pending) {
    pending = cloneInto(url, dest, input).finally(() => inflight.delete(dest));
    inflight.set(dest, pending);
  }
  return pending;
}
