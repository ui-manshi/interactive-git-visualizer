/**
 * Cross-checks our file-tree and diff results against native git (used here
 * ONLY as a test oracle — the app itself never shells out to git to read
 * objects).
 *
 * Run with: npm run test:vs-git -- /path/to/repo
 *
 * For every ordered pair of commits in the repo it compares:
 *   - the set of changed files + their status      vs  `git diff --name-status --no-renames`
 *   - per-file added/deleted line counts            vs  `git diff --numstat --minimal --no-renames`
 * and for every commit it compares the file listing vs `git ls-tree -r`.
 */
import { execFileSync } from "child_process";
import { diffCommits } from "../lib/commitDiff";
import { listFilesAtCommit } from "../lib/fileTree";

const repo = process.argv[2];
if (!repo) throw new Error("usage: test-vs-git <repo path>");

const git = (...args: string[]) =>
  execFileSync("git", ["-C", repo, "-c", "core.quotepath=off", ...args], { encoding: "utf8", maxBuffer: 1 << 28 });

const commits = git("rev-list", "--all").split("\n").filter(Boolean);
console.log(`Repository: ${repo}  (${commits.length} commits)`);

let treeChecks = 0;
let diffChecks = 0;
let fileChecks = 0;
const failures: string[] = [];

// 1. File listings
for (const c of commits) {
  const ours = listFilesAtCommit(repo, c).files.map((f) => `${f.mode} ${f.hash} ${f.path}`).sort();
  const theirs = git("ls-tree", "-r", c)
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [meta, p] = l.split("\t");
      const [mode, , hash] = meta.split(" ");
      return `${mode} ${hash} ${p}`;
    })
    .sort();
  treeChecks++;
  if (JSON.stringify(ours) !== JSON.stringify(theirs)) failures.push(`ls-tree mismatch at ${c.slice(0, 7)}`);
}

// 2. Diffs for every ordered pair (plus root-vs-empty for each commit)
const STATUS: Record<string, string> = { A: "added", D: "deleted", M: "modified" };

function compare(from: string | null, to: string) {
  const label = `${from ? from.slice(0, 7) : "(empty)"}..${to.slice(0, 7)}`;
  const ours = diffCommits(repo, from, to);

  const base = from ?? "4b825dc642cb6eb9a060e54bf8d69288fbee4904"; // git's well-known empty tree
  const nameStatus = new Map<string, string>();
  for (const l of git("diff", "--name-status", "--no-renames", base, to).split("\n").filter(Boolean)) {
    const [s, ...rest] = l.split("\t");
    nameStatus.set(rest.join("\t"), STATUS[s[0]] ?? s);
  }
  const numstat = new Map<string, string>();
  for (const l of git("diff", "--numstat", "--minimal", "--no-renames", base, to).split("\n").filter(Boolean)) {
    const [a, d, ...rest] = l.split("\t");
    numstat.set(rest.join("\t"), `${a}/${d}`); // binary files show "-/-"
  }

  diffChecks++;
  const ourPaths = ours.files.map((f) => f.path).sort();
  const gitPaths = Array.from(nameStatus.keys()).sort();
  if (JSON.stringify(ourPaths) !== JSON.stringify(gitPaths)) {
    failures.push(`${label}: changed-file set differs. ours=${ourPaths} git=${gitPaths}`);
    return;
  }

  for (const f of ours.files) {
    fileChecks++;
    if (nameStatus.get(f.path) !== f.status) {
      failures.push(`${label}: ${f.path} status ours=${f.status} git=${nameStatus.get(f.path)}`);
    }
    const expected = numstat.get(f.path);
    const got = f.binary ? "-/-" : `${f.additions}/${f.deletions}`;
    if (expected !== got) failures.push(`${label}: ${f.path} +/- ours=${got} git=${expected}`);
  }
}

for (const to of commits) {
  compare(null, to);
  for (const from of commits) {
    if (from !== to) compare(from, to);
  }
}

console.log(`file listings checked : ${treeChecks}`);
console.log(`commit pairs diffed   : ${diffChecks}`);
console.log(`per-file results      : ${fileChecks}`);
if (failures.length) {
  console.log(`\nFAILURES (${failures.length}):`);
  failures.slice(0, 20).forEach((f) => console.log("  - " + f));
  process.exit(1);
}
console.log("PASS: every file listing, status and +/- count matches native git");
