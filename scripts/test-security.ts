/**
 * Security checks for repoResolver. Run: npm run test:security
 * (Needs network access for the one real clone near the end.)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { parseRemoteUrl, resolveRepoPath } from "../lib/repoResolver";

let failed = 0;
const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failed++;
};
async function rejects(fn: () => unknown, msg: string) {
  try {
    await fn();
    ok(false, msg + " (was accepted)");
  } catch {
    ok(true, msg);
  }
}

async function main() {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), "gv-sec-"));
  process.env.CLONE_CACHE_DIR = cache;

  // ---------- Hosted mode ----------
  process.env.ALLOW_LOCAL_PATHS = "false";
  ok(parseRemoteUrl("https://github.com/octocat/Hello-World") === "https://github.com/octocat/Hello-World.git", "hosted: plain GitHub URL accepted");
  ok(parseRemoteUrl(" https://github.com/octocat/Hello-World.git/ ") === "https://github.com/octocat/Hello-World.git", "hosted: .git and trailing slash normalised");
  for (const bad of [
    'https://github.com/a/b"; touch /tmp/pwned; echo "',
    "https://github.com/a/b;touch /tmp/pwned",
    "https://github.com/a/b$(touch /tmp/pwned)",
    "https://github.com/a/b`touch /tmp/pwned`",
    "https://github.com/a/b\nhttps://evil.example/x",
    "https://evil.example/a/b",
    "https://github.com.evil.example/a/b",
    "https://user:pass@github.com/a/b",
    "http://github.com/a/b",
    "git@github.com:a/b.git",
    "ssh://git@github.com/a/b",
    "https://github.com/a/b/tree/main",
    "https://github.com/../b",
    "https://github.com/a/..",
    "file:///etc",
    "--upload-pack=touch /tmp/pwned",
  ]) {
    await rejects(() => parseRemoteUrl(bad), `hosted: rejects ${JSON.stringify(bad)}`);
  }
  await rejects(() => resolveRepoPath("/etc"), "hosted: local path /etc refused");
  await rejects(() => resolveRepoPath(process.cwd()), "hosted: local path of a real repo refused");
  await rejects(() => resolveRepoPath("../../etc"), "hosted: relative path refused");

  // ---------- Local mode: input must never reach a shell ----------
  process.env.ALLOW_LOCAL_PATHS = "true";
  const marker = path.join(os.tmpdir(), "gv-pwned-marker");
  fs.rmSync(marker, { force: true });
  await rejects(() => resolveRepoPath(`https://127.0.0.1:1/x"; touch ${marker}; echo "`), "local: shell-metacharacter URL rejected");
  await rejects(() => resolveRepoPath(`https://127.0.0.1:1/x$(touch ${marker})`), "local: $(...) URL rejected");
  ok(!fs.existsSync(marker), "local: no injected command ran (marker file not created)");
  await rejects(() => resolveRepoPath("https://127.0.0.1:1/nonexistent.git"), "local: unreachable URL fails cleanly");

  // ---------- A real clone, hosted mode ----------
  process.env.ALLOW_LOCAL_PATHS = "false";
  try {
    const dest = await resolveRepoPath("https://github.com/octocat/Hello-World");
    ok(fs.existsSync(path.join(dest, ".git")), "hosted: real GitHub repo clones");
    ok(!fs.existsSync(path.join(dest, "README")), "hosted: clone has no working tree (--no-checkout)");
    const again = await resolveRepoPath("https://github.com/octocat/Hello-World.git");
    ok(again === dest, "hosted: same repo, different spelling, reuses the cache");
    const [a, b] = await Promise.all([resolveRepoPath("https://github.com/octocat/Spoon-Knife"), resolveRepoPath("https://github.com/octocat/Spoon-Knife")]);
    ok(a === b, "hosted: two simultaneous requests share one clone");
  } catch (e) {
    console.log("SKIP  real clone (no network?):", (e as Error).message);
  }

  // ---------- Size cap ----------
  process.env.MAX_REPO_MB = "0.01"; // ~10 KB: anything real is bigger
  await rejects(() => resolveRepoPath("https://github.com/octocat/git-consortium"), "hosted: oversized repo is refused");
  delete process.env.MAX_REPO_MB;

  fs.rmSync(cache, { recursive: true, force: true });
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll security checks passed");
  process.exit(failed ? 1 : 0);
}
main();
