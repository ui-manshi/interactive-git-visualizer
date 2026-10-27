# Git Version Control Visualizer

An interactive, web-based tool that reads a repository's raw `.git/objects`
directory directly, reconstructs its commit history as a navigable graph,
and renders it in the browser — without relying on the native Git CLI.

## Status

- ✅ **Milestone 2 — Object Parsing & Repo Reading**: implemented and tested.
  Reads objects from **both** loose storage and packfiles natively
  (`lib/gitObjectParser.ts`, `lib/packParser.ts`), plus a `repoResolver.ts`
  that accepts local paths or remote GitHub URLs (cloning as needed).
- ✅ **Milestone 3 — DAG Construction & Graph Rendering**: implemented.
  `lib/graphBuilder.ts` walks every branch tip back through parent
  pointers, topologically sorts the resulting DAG, and assigns each commit
  a lane/row position. `components/CommitGraph.tsx` renders it with React
  Flow — pan, zoom, minimap, click a commit to see its full details in a
  side panel.
- ✅ **Milestone 4 — File Explorer & Diff Viewer**: implemented. Click a commit
  to browse the repository exactly as it was at that point (**Files** tab) or
  see what that commit changed (**Changes** tab). Use **Compare two commits** to
  diff any two commits. Line diffs come from a from-scratch Myers algorithm
  (`lib/myersDiff.ts`).
- ⏳ **Milestone 5 — Object Inspector, Polish & Deployment**: not yet started.

## Getting Started

```bash
npm install
npm run dev
```

Then open http://localhost:3000, paste either the **absolute path** to a
local Git repository, or a **GitHub URL** (e.g.
`https://github.com/octocat/Hello-World`), and submit. Remote URLs are
cloned into a cached temp directory on first use.

## Testing the Object Parser Directly

You can exercise `lib/gitObjectParser.ts` without the web UI:

```bash
npm run test:parser -- /absolute/path/to/some/repo
```

This walks the commit history from the repo's branches, prints each parsed
commit, verifies every object's SHA-1 hash, and prints the file tree of the
tip commit.

## API Routes

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/repo/refs?path=<repo>` | GET | List local branch refs and their tip commit hash |
| `/api/repo/graph?path=<repo>&max=500` | GET | Build the full commit DAG as `{nodes, edges}` for React Flow |
| `/api/repo/tree?path=<repo>&commit=<hash>` | GET | Every file in the repo as of that commit |
| `/api/repo/blob?path=<repo>&hash=<blob>` | GET | A file's text content (binary files are flagged, not sent) |
| `/api/repo/diff?path=<repo>&from=<hash>&to=<hash>` | GET | Changed-file summary with +/- counts (empty `from` = diff against empty tree) |
| `/api/repo/diff?...&file=<path>` | GET | Line-by-line hunks for one file |
| `/api/repo/object/:hash?path=<repo>` | GET | Return parsed type/size/content for one object |
| `/api/repo/verify/:hash?path=<repo>` | GET | Recompute and confirm an object's SHA-1 hash |

All routes take the repo path as a query parameter since this tool reads a
**local filesystem path** to a repo (not a URL) — the server process needs
filesystem access to `.git/objects`.

## Project Structure

```
git-visualizer/
├── app/
│   ├── page.tsx                  # Landing page (repo path/URL input)
│   ├── visualizer/page.tsx       # Main visualizer view
│   └── api/repo/
│       ├── refs/route.ts
│       ├── object/[hash]/route.ts
│       └── verify/[hash]/route.ts
├── lib/
│   ├── gitObjectParser.ts        # Core object parsing (Milestone 2)
│   ├── packParser.ts             # Native packfile reader + delta resolution
│   └── repoResolver.ts           # Local path vs. remote URL, clone caching
├── scripts/
│   └── test-parser.ts            # Standalone test harness
└── components/                   # (CommitGraph, FileTreeExplorer, DiffViewer — Milestone 3/4)
```

## How Object Reading Works

Git stores objects two ways, and both are supported natively (no `git cat-file`
or `git unpack-objects` involved):

- **Loose objects** (`.git/objects/xx/yyyy...`): a single zlib-deflated
  blob per object. Read directly by `gitObjectParser.ts`.
- **Packed objects** (`.git/objects/pack/*.pack` + matching `.idx`): the
  format every real clone/fetch produces. `packParser.ts` parses the `.idx`
  file's fan-out table for O(log n) hash lookup, seeks to the object's byte
  offset in the `.pack` file, and decompresses it — resolving `OFS_DELTA`
  and `REF_DELTA` chains (git's delta-compression scheme) by walking back to
  each base object and reapplying git's copy/insert delta instructions.

`gitObjectParser.ts` tries loose storage first and transparently falls back
to `packParser.ts`, so callers never need to know which form an object is
stored in. This was verified against real cloned repositories, including a
synthetic repo with a depth-4 delta chain, whose resolved output was
byte-for-byte diffed against `git cat-file -p`'s own output.

`git` itself is only ever invoked for the network transfer (`git clone` /
`git fetch`) in `repoResolver.ts` — never for reading or decoding object
content.

## How the Commit Graph Is Built (Milestone 3)

`lib/graphBuilder.ts`:

1. Reads every branch ref (`lib/gitObjectParser.ts` → `listBranchRefs`) and
   walks parent pointers backward (BFS) to collect every reachable commit.
2. **Topologically sorts** the commits so a commit always appears before
   (above) every one of its ancestors — this can't be done with a plain
   timestamp sort, since Git's 1-second timestamp resolution means rapid
   or scripted commits often share an identical timestamp, which would
   otherwise put a commit above its own child in the graph.
3. Assigns each commit a **lane** (horizontal column) using the same idea
   `git log --graph` uses: a lane "waits" for a specific next commit hash;
   a commit reuses the lane waiting for it, or opens a new one. Merge
   commits open additional lanes for their non-first parents, so branches
   visibly fan out and rejoin.
4. Returns `{ nodes, edges, truncated }`, ready to hand straight to React
   Flow — `components/CommitGraph.tsx` renders it with pan/zoom, a minimap,
   and a custom node (`components/CommitNode.tsx`) showing the short hash,
   message, author, merge badge, and any branch tip labels. Clicking a
   node calls `/api/repo/object/:hash` and shows full details in a side
   panel.

Verified against: a local repo with a real merge commit (feature branch
forking and rejoining), and a cloned repo with a packed merge commit —
both produce a correctly ordered, correctly laned graph.

## How Diffs Work (Milestone 4)

1. **Snapshots** (`lib/fileTree.ts`): a commit points at a root *tree*; walking
   trees recursively yields every file's path, mode and blob hash.
2. **Which files changed** (`lib/commitDiff.ts`): two commits' snapshots are
   compared by blob hash. Git is content-addressed, so an identical hash means
   identical content — unchanged files are never even read. That is what makes
   diffing fast on large repos.
3. **Which lines changed** (`lib/myersDiff.ts`): only for files whose hash
   differs, lines are diffed with Myers' O(ND) algorithm, which returns a
   *minimal* edit script. Common prefix/suffix lines are trimmed first, and
   memory is bounded: past an edit distance of 4,000 the changed region is
   shown as replaced and flagged "approximate" in the UI.
4. **Hunks**: changes are grouped with 3 lines of context, like `git diff`.

Edge cases handled: binary files (NUL-byte heuristic, same as Git), submodules,
mode-only changes (chmod), root commits (diffed against the empty tree),
missing trailing newline at end of file, and merge commits (diffed against
their first parent). Renames are shown as a delete plus an add (no rename
detection).

## Tests

```bash
npm run test:diff                      # Myers: 4,000 random cases, checked for
                                       # correctness AND minimality vs an LCS oracle
npm run test:vs-git -- /path/to/repo   # every file listing, status and +/- count,
                                       # for every pair of commits, vs native git
npm run test:parser -- /path/to/repo   # object parser walk + SHA-1 verification
```

(`git` is used only as a test oracle; the app never shells out to it to read objects.)

## Troubleshooting

- **"0 commits loaded" / empty graph for a GitHub URL**: usually a leftover
  from an interrupted clone. Clones are cached in your OS temp folder under
  `git-visualizer-clones` (Windows: `%TEMP%\\git-visualizer-clones`). The app
  now detects incomplete clones and redoes them automatically; deleting that
  folder also forces a fresh clone.
- Branches shown include remote-tracking ones (`origin/...`), since a fresh
  clone only has one local branch.

## Known Limitations (to address in later milestones)

- No pagination/virtualization for very large histories yet.
- Annotated tag objects (`type: "tag"`) are recognized by the pack reader
  but not yet given a dedicated parser in `gitObjectParser.ts`.
