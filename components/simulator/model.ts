/**
 * model.ts
 *
 * A tiny in-memory Git for the simulator: commits, branches, tags and HEAD,
 * plus the commands people reach for most. It models history only (no file
 * contents), so it can show what an operation does to the commit graph but
 * never produces merge conflicts.
 */

export interface SimCommit {
  id: string;
  label: string; // C1, C2'... shown inside the node
  msg: string;
  parents: string[];
  col: number;
  lane: number;
  copiedFrom?: string; // set on commits re-created by rebase / cherry-pick
}

export type SimHead = { kind: "branch"; name: string } | { kind: "detached"; id: string };

export interface SimState {
  commits: Record<string, SimCommit>;
  order: string[]; // creation order (parents always come before children)
  branches: Record<string, string>;
  tags: Record<string, string>;
  head: SimHead;
  counter: number;
}

export interface RunResult {
  state: SimState;
  lines: string[];
  ok: boolean;
  /** A short explanation of what the command did to the graph. */
  note?: string;
}

// ------------------------------- helpers -----------------------------------

function fakeHash(seed: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < seed.length; i++) {
    h1 = Math.imul(h1 ^ seed.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + seed.charCodeAt(i), 2246822519) >>> 0;
  }
  return (h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0")).slice(0, 7);
}

const clone = (s: SimState): SimState => ({
  commits: { ...s.commits },
  order: [...s.order],
  branches: { ...s.branches },
  tags: { ...s.tags },
  head: { ...s.head },
  counter: s.counter,
});

export function headId(s: SimState): string | null {
  return s.head.kind === "branch" ? s.branches[s.head.name] ?? null : s.head.id;
}

export function ancestors(s: SimState, id: string | null): Set<string> {
  const seen = new Set<string>();
  const stack = id ? [id] : [];
  while (stack.length) {
    const c = stack.pop()!;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const p of s.commits[c]?.parents ?? []) stack.push(p);
  }
  return seen;
}

/** Everything a branch, tag or HEAD can still reach; the rest is orphaned. */
export function reachable(s: SimState): Set<string> {
  const out = new Set<string>();
  const roots = [...Object.values(s.branches), ...Object.values(s.tags)];
  if (s.head.kind === "detached") roots.push(s.head.id);
  for (const r of roots) for (const a of ancestors(s, r)) out.add(a);
  return out;
}

function place(s: SimState, parents: string[]): { col: number; lane: number } {
  const col = parents.length ? Math.max(...parents.map((p) => s.commits[p].col)) + 1 : 0;
  const preferred = parents.length ? s.commits[parents[0]].lane : 0;
  const taken = (lane: number) => Object.values(s.commits).some((c) => c.col === col && c.lane === lane);
  for (let d = 0; d < 20; d++) {
    for (const lane of d === 0 ? [preferred] : [preferred + d, preferred - d]) {
      if (lane >= 0 && !taken(lane)) return { col, lane };
    }
  }
  return { col, lane: preferred };
}

function addCommit(s: SimState, msg: string, parents: string[], label?: string, copiedFrom?: string): string {
  s.counter++;
  let id = fakeHash(`${s.counter}|${msg}|${parents.join(",")}`);
  while (s.commits[id]) id = fakeHash(id + "x");
  const { col, lane } = place(s, parents);
  s.commits[id] = { id, label: label ?? `C${s.counter}`, msg, parents, col, lane, copiedFrom };
  s.order.push(id);
  return id;
}

function moveHead(s: SimState, id: string) {
  if (s.head.kind === "branch") s.branches[s.head.name] = id;
  else s.head = { kind: "detached", id };
}

/** Resolves branch / tag / HEAD / commit id / label (C3), with ~N and ^ suffixes. */
export function resolve(s: SimState, ref: string): string | null {
  const m = ref.match(/^([^~^]*)((?:[~^]\d*)*)$/);
  if (!m) return null;
  const [, name, suffix] = m;
  let id: string | null = null;
  if (name === "HEAD" || name === "@") id = headId(s);
  else if (s.branches[name]) id = s.branches[name];
  else if (s.tags[name]) id = s.tags[name];
  else {
    const lower = name.toLowerCase();
    const byId = Object.keys(s.commits).filter((k) => lower.length >= 4 && k.startsWith(lower));
    const byLabel = Object.values(s.commits).filter((c) => c.label.toLowerCase() === lower);
    // A label like "C3" is ambiguous after a rebase (C3 and C3'); prefer the exact label.
    id = byId.length === 1 ? byId[0] : byLabel.length ? byLabel[byLabel.length - 1].id : null;
  }
  if (!id) return null;
  for (const [, kind, n] of suffix.matchAll(/([~^])(\d*)/g)) {
    const count = n === "" ? 1 : parseInt(n, 10);
    if (kind === "~") {
      for (let i = 0; i < count && id; i++) id = s.commits[id].parents[0] ?? null;
    } else {
      id = s.commits[id].parents[count - 1] ?? null;
    }
    if (!id) return null;
  }
  return id;
}

const short = (s: SimState, id: string) => `${id} ${s.commits[id].msg}`;

function tokenize(input: string): string[] {
  return [...input.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

// ------------------------------ scenarios ----------------------------------

export function emptyState(): SimState {
  return { commits: {}, order: [], branches: {}, tags: {}, head: { kind: "branch", name: "main" }, counter: 0 };
}

function script(commands: string[]): SimState {
  let s = emptyState();
  for (const c of commands) s = runCommand(s, c).state;
  return s;
}

export const SCENARIOS: { id: string; name: string; hint: string; build: () => SimState }[] = [
  {
    id: "diverged",
    name: "Merge vs rebase: diverged branches",
    hint: "main and feature both moved on. Try git merge main, then Undo and try git rebase main. Compare the two graphs.",
    build: () =>
      script([
        "git commit",
        "git commit",
        "git branch feature",
        "git commit",
        "git checkout feature",
        "git commit",
        "git commit",
      ]),
  },
  {
    id: "cherry",
    name: "Pick one commit",
    hint: "feature has three commits and you only want one. Try git cherry-pick C4.",
    build: () =>
      script([
        "git commit",
        "git commit",
        "git checkout -b feature",
        "git commit",
        "git commit",
        "git commit",
        "git checkout main",
      ]),
  },
  {
    id: "detached",
    name: "Detached HEAD",
    hint: "HEAD points at C2, a commit, not a branch. Try git commit here, then git checkout main: the new commit is no longer reachable. Recover it with git branch rescue <hash>.",
    build: () => script(["git commit", "git commit", "git commit", "git checkout C2"]),
  },
  {
    id: "lost",
    name: "Recover a lost commit",
    hint: "A reset just moved main back and left C4 orphaned (faded). Run git branch rescue followed by the hash shown under C4 to point a branch at it again.",
    build: () => script(["git commit", "git commit", "git commit", "git commit", "git reset --hard HEAD~1"]),
  },
  {
    id: "undo-ways",
    name: "Reset, revert or checkout",
    hint: "Four commits on main. Try git reset --hard HEAD~1 (moves the branch back), Undo, then git revert HEAD (adds a commit that undoes the last one), Undo, then git checkout C2 (moves only HEAD).",
    build: () => script(["git commit", "git commit", "git commit", "git commit"]),
  },
  { id: "empty", name: "Empty repository", hint: "Start from nothing: git commit, git branch, git checkout...", build: emptyState },
];

// ------------------------------- commands ----------------------------------

const fail = (s: SimState, ...lines: string[]): RunResult => ({ state: s, lines, ok: false });

export const HELP = [
  "git commit [-m \"msg\"]          add a commit",
  "git branch [name] [start]       list or create a branch (-d name deletes)",
  "git checkout [-b] <ref>         switch branch or detach HEAD (git switch [-c])",
  "git merge <ref> [--no-ff]       merge a branch into the current one",
  "git rebase <onto>               replay the current branch on top of <onto>",
  "git cherry-pick <ref>...        copy commits onto the current branch",
  "git reset [--hard] <ref>        move the current branch to <ref>",
  "git revert <ref>                add a commit that undoes <ref>",
  "git tag <name> [ref]            label a commit",
  "git log, git status             look around",
  "git gc                          delete orphaned commits",
];

export function runCommand(prev: SimState, input: string): RunResult {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) return { state: prev, lines: [], ok: true };
  if (tokens[0] === "help") return { state: prev, lines: HELP, ok: true };
  if (tokens[0] !== "git") return fail(prev, `Commands start with "git". Type help to see what is supported.`);

  const s = clone(prev);
  const [, cmd, ...args] = tokens;
  const flags = args.filter((a) => a.startsWith("-"));
  const rest = args.filter((a) => !a.startsWith("-"));

  switch (cmd) {
    case "commit": {
      const mi = args.indexOf("-m");
      const msg = mi >= 0 && args[mi + 1] ? args[mi + 1] : `Commit ${s.counter + 1}`;
      const parent = headId(s);
      const id = addCommit(s, msg, parent ? [parent] : []);
      moveHead(s, id);
      return {
        state: s,
        ok: true,
        lines: [`[${s.head.kind === "branch" ? s.head.name : "detached HEAD"} ${id}] ${msg}`],
        note: `A new commit ${s.commits[id].label} was added on top of ${parent ? s.commits[parent].label : "nothing (this is the root commit)"}, and ${
          s.head.kind === "branch" ? `the branch "${s.head.name}"` : "HEAD"
        } moved forward to it.`,
      };
    }

    case "branch": {
      if (rest.length === 0) {
        const cur = s.head.kind === "branch" ? s.head.name : null;
        return { state: s, ok: true, lines: Object.keys(s.branches).sort().map((b) => `${b === cur ? "*" : " "} ${b}`) };
      }
      if (flags.includes("-d") || flags.includes("-D")) {
        const name = rest[0];
        if (!s.branches[name]) return fail(s, `error: branch '${name}' not found.`);
        if (s.head.kind === "branch" && s.head.name === name) return fail(s, `error: cannot delete branch '${name}' checked out here.`);
        if (flags.includes("-d") && !ancestors(s, headId(s)).has(s.branches[name])) {
          return fail(s, `error: the branch '${name}' is not fully merged.`, `If you are sure, run: git branch -D ${name}`);
        }
        delete s.branches[name];
        return {
          state: s,
          ok: true,
          lines: [`Deleted branch ${name}.`],
          note: "Only the label was removed. Commits stay until nothing points to them and git gc runs.",
        };
      }
      const [name, start] = rest;
      if (s.branches[name]) return fail(s, `fatal: a branch named '${name}' already exists.`);
      const at = start ? resolve(s, start) : headId(s);
      if (!at) return fail(s, start ? `fatal: not a valid object name: '${start}'.` : "fatal: no commits yet.");
      s.branches[name] = at;
      return { state: s, ok: true, lines: [], note: `A new label "${name}" now points at ${s.commits[at].label}. No commits were copied; a branch is just a pointer.` };
    }

    case "checkout":
    case "switch": {
      const create = flags.includes("-b") || flags.includes("-c");
      if (create) {
        const [name, start] = rest;
        if (!name) return fail(s, "fatal: branch name required.");
        if (s.branches[name]) return fail(s, `fatal: a branch named '${name}' already exists.`);
        const at = start ? resolve(s, start) : headId(s);
        if (!at && s.order.length > 0) return fail(s, `fatal: not a valid object name: '${start}'.`);
        if (at) s.branches[name] = at;
        s.head = { kind: "branch", name };
        return { state: s, ok: true, lines: [`Switched to a new branch '${name}'`], note: `Created "${name}" at the current commit and moved HEAD onto it, so new commits will go there.` };
      }
      const target = rest[0];
      if (!target) return fail(s, "fatal: which branch?");
      if (s.branches[target]) {
        s.head = { kind: "branch", name: target };
        return { state: s, ok: true, lines: [`Switched to branch '${target}'`], note: `HEAD now follows "${target}". New commits will move that branch.` };
      }
      if (cmd === "switch") return fail(s, `fatal: invalid reference: ${target}`);
      const id = resolve(s, target);
      if (!id) return fail(s, `error: pathspec '${target}' did not match any branch or commit.`);
      s.head = { kind: "detached", id };
      return { state: s, ok: true, lines: [`HEAD is now at ${short(s, id)}`, "You are in 'detached HEAD' state."], note: "HEAD points straight at a commit, not a branch. A new commit here would not belong to any branch." };
    }

    case "merge": {
      const target = rest[0];
      if (!target) return fail(s, "fatal: which branch should be merged?");
      const T = resolve(s, target);
      const H = headId(s);
      if (!T) return fail(s, `merge: ${target} - not something we can merge`);
      if (!H) return fail(s, "fatal: nothing to merge into (no commits yet).");
      if (ancestors(s, H).has(T)) return { state: s, ok: true, lines: ["Already up to date."], note: `${target} is already part of the current history, so nothing changes.` };
      if (ancestors(s, T).has(H) && !flags.includes("--no-ff")) {
        moveHead(s, T);
        return {
          state: s,
          ok: true,
          lines: [`Updating ${H}..${T}`, "Fast-forward"],
          note: `The current branch had no commits of its own, so Git just slid its label forward to ${s.commits[T].label}. No merge commit was needed.`,
        };
      }
      if (flags.includes("--ff-only")) return fail(s, "fatal: Not possible to fast-forward, aborting.");
      const id = addCommit(s, `Merge ${target}`, [H, T]);
      moveHead(s, id);
      return {
        state: s,
        ok: true,
        lines: ["Merge made by the 'ort' strategy."],
        note: `A merge commit with two parents (${s.commits[H].label} and ${s.commits[T].label}) joins both lines of history. Nothing was rewritten.`,
      };
    }

    case "rebase": {
      const onto = rest[0];
      if (!onto) return fail(s, "fatal: rebase onto what?");
      if (s.head.kind !== "branch") return fail(s, "fatal: you are not on a branch; the simulator can only rebase a branch.");
      const O = resolve(s, onto);
      const H = headId(s);
      if (!O || !H) return fail(s, `fatal: invalid upstream '${onto}'`);
      const branch = s.head.name;
      if (ancestors(s, O).has(H) || ancestors(s, H).has(O)) {
        if (ancestors(s, O).has(H) && H !== O) {
          s.branches[branch] = O;
          return { state: s, ok: true, lines: [`Fast-forwarded ${branch} to ${onto}.`], note: "The branch had nothing of its own, so it simply moved to the target." };
        }
        return { state: s, ok: true, lines: [`Current branch ${branch} is up to date.`], note: "The branch already sits on top of the target." };
      }
      const keep = ancestors(s, O);
      const toReplay = s.order.filter((id) => ancestors(s, H).has(id) && !keep.has(id) && s.commits[id].parents.length <= 1);
      let parent = O;
      const copies: string[] = [];
      for (const id of toReplay) {
        const c = s.commits[id];
        parent = addCommit(s, c.msg, [parent], `${c.label}'`, id);
        copies.push(parent);
      }
      s.branches[branch] = parent;
      return {
        state: s,
        ok: true,
        lines: [`Successfully rebased and updated refs/heads/${branch}.`],
        note: `Each of ${toReplay.length} commit${toReplay.length === 1 ? "" : "s"} was copied on top of ${onto} (the primed copies, with new hashes). The originals are now orphaned: nothing points at them, though Git's reflog could still recover them. History looks linear, which is also why rebasing shared branches is risky.`,
      };
    }

    case "cherry-pick": {
      if (rest.length === 0) return fail(s, "fatal: cherry-pick what?");
      if (!headId(s)) return fail(s, "fatal: you have no commit to cherry-pick onto.");
      const notes: string[] = [];
      for (const ref of rest) {
        const id = resolve(s, ref);
        if (!id) return fail(s, `fatal: bad revision '${ref}'`);
        const c = s.commits[id];
        if (c.parents.length > 1) return fail(s, `error: commit ${id} is a merge but no -m option was given.`);
        if (ancestors(s, headId(s)).has(id)) return fail(s, `error: ${c.label} is already part of this branch's history (git would report an empty cherry-pick).`);
        const copy = addCommit(s, c.msg, [headId(s)!], `${c.label}'`, id);
        moveHead(s, copy);
        notes.push(`${c.label} → ${s.commits[copy].label}`);
      }
      return {
        state: s,
        ok: true,
        lines: [`[${s.head.kind === "branch" ? s.head.name : "detached HEAD"}] cherry-picked ${rest.length} commit${rest.length === 1 ? "" : "s"}`],
        note: `Copied ${notes.join(", ")}. A cherry-pick creates a new commit with the same change but a new hash and parent; the original stays where it was (dashed arrow).`,
      };
    }

    case "reset": {
      const target = rest[0] ?? "HEAD";
      const id = resolve(s, target);
      if (!id) return fail(s, `fatal: ambiguous argument '${target}': unknown revision.`);
      if (s.head.kind === "branch" && !s.branches[s.head.name]) return fail(s, "fatal: nothing to reset.");
      const before = headId(s);
      moveHead(s, id);
      const mode = flags.includes("--hard") ? "--hard" : flags.includes("--soft") ? "--soft" : "--mixed";
      return {
        state: s,
        ok: true,
        lines: [`HEAD is now at ${short(s, id)}`],
        note: `The branch label moved from ${before ? s.commits[before].label : "nothing"} to ${s.commits[id].label}. Commits that are no longer reachable become orphans (dashed). The simulator does not model files, so ${mode} behaves the same here.`,
      };
    }

    case "revert": {
      const target = rest[0];
      const id = target ? resolve(s, target) : null;
      if (!id) return fail(s, `fatal: bad revision '${target ?? ""}'`);
      const H = headId(s);
      if (!H) return fail(s, "fatal: nothing to revert onto.");
      const label = `rev ${s.commits[id].label}`;
      const nid = addCommit(s, `Revert "${s.commits[id].msg}"`, [H], label);
      moveHead(s, nid);
      return { state: s, ok: true, lines: [`[${s.head.kind === "branch" ? s.head.name : "detached HEAD"} ${nid}] Revert "${s.commits[id].msg}"`], note: "Revert adds a new commit that undoes an old one, so nothing is rewritten. That makes it safe on shared branches." };
    }

    case "tag": {
      if (rest.length === 0) return { state: s, ok: true, lines: Object.keys(s.tags).sort() };
      const [name, ref] = rest;
      const id = ref ? resolve(s, ref) : headId(s);
      if (!id) return fail(s, "fatal: no commit to tag.");
      if (s.tags[name]) return fail(s, `fatal: tag '${name}' already exists`);
      s.tags[name] = id;
      return { state: s, ok: true, lines: [], note: `Tag "${name}" is a fixed label on ${s.commits[id].label}. Unlike a branch it does not move when you commit.` };
    }

    case "gc": {
      const keep = reachable(s);
      const gone = s.order.filter((id) => !keep.has(id));
      for (const id of gone) delete s.commits[id];
      s.order = s.order.filter((id) => keep.has(id));
      return {
        state: s,
        ok: true,
        lines: [`Removed ${gone.length} unreachable commit${gone.length === 1 ? "" : "s"}.`],
        note: gone.length ? "Orphaned commits are gone for good (real Git also keeps them for a while via the reflog)." : "There was nothing orphaned to clean up.",
      };
    }

    case "log": {
      const H = headId(s);
      if (!H) return fail(s, "fatal: your current branch has no commits yet");
      const set = ancestors(s, H);
      const lines = s.order
        .filter((id) => set.has(id))
        .reverse()
        .slice(0, 20)
        .map((id) => {
          const deco = [
            ...(id === H && s.head.kind === "branch" ? [`HEAD -> ${(s.head as { name: string }).name}`] : id === H ? ["HEAD"] : []),
            ...Object.entries(s.branches).filter(([n, b]) => b === id && !(s.head.kind === "branch" && s.head.name === n)).map(([n]) => n),
            ...Object.entries(s.tags).filter(([, t]) => t === id).map(([n]) => `tag: ${n}`),
          ];
          return `* ${id}${deco.length ? ` (${deco.join(", ")})` : ""} ${s.commits[id].msg}`;
        });
      return { state: s, ok: true, lines };
    }

    case "status":
      return {
        state: s,
        ok: true,
        lines: [s.head.kind === "branch" ? `On branch ${s.head.name}` : `HEAD detached at ${s.head.id}`, "nothing to commit, working tree clean"],
      };

    default:
      return fail(s, `git: '${cmd}' is not supported here. Type help to see what is.`);
  }
}
