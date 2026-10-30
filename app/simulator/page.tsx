"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import DagView, { DagEdge, DagNode, DagTag } from "@/components/DagView";
import { laneColor } from "@/components/lanes";
import { Brand, NavTab, Toolbar, ToolbarDivider } from "@/components/shell";
import { Tip } from "@/components/Tooltip";
import { HELP, SCENARIOS, SimState, ancestors, headId, reachable, runCommand } from "@/components/simulator/model";

interface LogLine {
  /** cmd: what you typed. ok / err: the command's output. info: messages from the simulator itself. */
  kind: "cmd" | "ok" | "err" | "info";
  text: string;
  /** For cmd lines: whether the command succeeded. */
  ok?: boolean;
}

interface Explanation {
  text: string;
  /** Present when the command left commits that no branch reaches. */
  recovery?: string;
}

export default function SimulatorPage() {
  const [scenarioId, setScenarioId] = useState(SCENARIOS[0].id);
  const [state, setState] = useState<SimState>(() => SCENARIOS[0].build());
  const [undoStack, setUndoStack] = useState<SimState[]>([]);
  const [log, setLog] = useState<LogLine[]>([{ kind: "info", text: "Type a git command, or click a suggestion. Type help to see what is supported." }]);
  const [note, setNote] = useState<Explanation | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  // Recovery guidance opens by itself when a command orphans commits, and stays out of the way otherwise.
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false); // show the whole explanation instead of two lines
  // What the last command changed, derived from the real before/after state.
  const [change, setChange] = useState<{ chips: ChangeChip[]; highlight: Set<string> } | null>(null);
  const [input, setInput] = useState("");
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const termRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scenario = SCENARIOS.find((s) => s.id === scenarioId)!;

  useEffect(() => {
    termRef.current?.scrollTo({ top: termRef.current.scrollHeight });
  }, [log]);

  function run(cmd: string) {
    const text = cmd.trim();
    if (!text) return;
    if (text === "clear") {
      setLog([]);
      setInput("");
      return;
    }
    const result = runCommand(state, text);
    const lines: LogLine[] = [{ kind: "cmd", text, ok: result.ok }, ...result.lines.map((l) => ({ kind: (result.ok ? "ok" : "err") as LogLine["kind"], text: l }))];
    setLog((l) => [...l, ...lines]);
    if (result.ok && result.state !== state && text.split(/\s+/)[0] === "git") {
      const changed = JSON.stringify(result.state) !== JSON.stringify(state);
      if (changed) setUndoStack((u) => [...u, state]);
      setState(result.state);
    }
    setChange(result.ok && result.state !== state ? describeChange(state, result.state) : null);
    const recovery = result.ok ? recoveryFor(state, result.state) : undefined;
    setNote(result.ok && result.note ? { text: result.note, recovery } : null);
    setRecoveryOpen(!!recovery);
    setNoteOpen(false);
    setCmdHistory((h) => [...h, text]);
    setHistIdx(null);
    setInput("");
  }

  function undo() {
    if (undoStack.length === 0) return;
    setState(undoStack[undoStack.length - 1]);
    setUndoStack((u) => u.slice(0, -1));
    setLog((l) => [...l, { kind: "info", text: "Undid the last command." }]);
    setNote(null);
    setChange(null);
    setRecoveryOpen(false);
  }

  function load(id: string) {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    setScenarioId(id);
    setState(sc.build());
    setUndoStack([]);
    setNote(null);
    setChange(null);
    setRecoveryOpen(false);
    setConfirmReset(false);
    setLog([{ kind: "info", text: sc.hint }]);
  }

  // ---- what to draw ----
  const live = useMemo(() => reachable(state), [state]);
  const { nodes, edges, tags } = useMemo(() => {
    const nodes: DagNode[] = state.order.map((id) => {
      const c = state.commits[id];
      return {
        id,
        col: c.col,
        lane: c.lane,
        label: c.label,
        sub: id.slice(0, 7),
        title: `${c.label}: ${c.msg}${live.has(id) ? "" : " (orphaned: no branch or tag reaches it)"}`,
        color: laneColor(c.lane),
        ghost: !live.has(id),
        merge: c.parents.length > 1,
      };
    });
    const edges: DagEdge[] = [];
    for (const id of state.order) {
      const c = state.commits[id];
      for (const p of c.parents) edges.push({ from: id, to: p });
      if (c.copiedFrom && state.commits[c.copiedFrom]) edges.push({ from: c.copiedFrom, to: id, kind: "copy" });
    }
    const tags: DagTag[] = [];
    const cur = state.head.kind === "branch" ? state.head.name : null;
    for (const [name, id] of Object.entries(state.branches)) {
      tags.push({ nodeId: id, text: name === cur ? `HEAD → ${name}` : name, kind: name === cur ? "head" : "branch" });
    }
    for (const [name, id] of Object.entries(state.tags)) tags.push({ nodeId: id, text: name, kind: "tag" });
    if (state.head.kind === "detached") tags.push({ nodeId: state.head.id, text: "HEAD", kind: "head" });
    return { nodes, edges, tags };
  }, [state, live]);

  // ---- suggestions that make sense right now ----
  const suggestions = useMemo(() => {
    const cur = state.head.kind === "branch" ? state.head.name : null;
    const others = Object.keys(state.branches).filter((b) => b !== cur);
    const H = headId(state);
    const out: string[] = ["git commit"];
    if (!state.branches.topic) out.push("git checkout -b topic");
    for (const o of others.slice(0, 2)) {
      out.push(`git merge ${o}`, `git rebase ${o}`, `git checkout ${o}`);
      const tip = state.branches[o];
      if (H && tip && !ancestors(state, H).has(tip)) out.push(`git cherry-pick ${state.commits[tip].label}`);
    }
    if (H && state.commits[H]?.parents.length) out.push("git reset --hard HEAD~1");
    const orphanTip = newestOrphan(state, live);
    if (orphanTip) out.push(`git branch rescue ${orphanTip.slice(0, 7)}`);
    if (Object.keys(state.commits).some((id) => !live.has(id))) out.push("git gc");
    out.push("git log");
    return [...new Set(out)].slice(0, 12);
  }, [state, live]);

  const orphanCount = Object.keys(state.commits).filter((id) => !live.has(id)).length;

  const loggedCommands = undoStack.length;

  return (
    <main className="h-dvh lg:h-dvh flex flex-col bg-ground text-fg overflow-hidden">
      <Toolbar label="Simulator">
        <Brand compact />
        <span className="hidden sm:block">
          <ToolbarDivider />
        </span>
        <nav aria-label="Sections" className="flex items-center h-12 flex-none">
          <NavTab label="Simulator" href="/simulator" active />
        </nav>
        <span className="flex-1 min-w-0" />
        <label className="sr-only" htmlFor="scenario">
          Scenario
        </label>
        <select
          id="scenario"
          value={scenarioId}
          onChange={(e) => load(e.target.value)}
          className="field rounded-md px-2 h-8 text-body min-w-0 max-w-[14rem] lg:max-w-[22rem]"
          title={scenario.name}
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Tip label={undoStack.length ? `Undo the last command (${undoStack.length} available)` : "Nothing to undo yet"}>
          <button onClick={undo} disabled={undoStack.length === 0} className="btn text-body px-3 h-8 rounded-md flex-none">
            Undo
          </button>
        </Tip>
        {confirmReset ? (
          <div role="group" aria-label="Confirm reset" className="flex items-center gap-1 flex-none">
            <span className="hidden md:inline text-body text-muted mr-1">
              Discard {loggedCommands} change{loggedCommands === 1 ? "" : "s"}?
            </span>
            <button onClick={() => load(scenarioId)} className="text-body px-3 h-8 rounded-md ring-1 ring-inset ring-del/70 text-del hover:bg-del/10" autoFocus>
              Reset
            </button>
            <button onClick={() => setConfirmReset(false)} className="btn text-body px-3 h-8 rounded-md">
              Keep
            </button>
          </div>
        ) : (
          <Tip label="Return to this scenario's starting point">
            <button
              onClick={() => (undoStack.length > 0 ? setConfirmReset(true) : load(scenarioId))}
              className="btn text-body px-3 h-8 rounded-md flex-none"
            >
              Reset
            </button>
          </Tip>
        )}
        <span className="hidden md:inline-flex">
          <Tip label="Visualise a real repository" align="end">
            <Link href="/" className="btn-ghost inline-flex items-center h-8 px-2.5 rounded-md text-body flex-none">
              Open a repository
            </Link>
          </Tip>
        </span>
      </Toolbar>

      {/* One workbench: the graph and the terminal share a height; the status line and the prompt
          share the bottom band, so a command and its explanation sit on the same level. */}
      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_28rem] lg:grid-rows-[minmax(0,1fr)_auto] max-lg:overflow-y-auto max-lg:grid-rows-none">
        <section className="relative min-w-0 min-h-[18rem] lg:min-h-0 p-6" aria-label="Repository state">
          {nodes.length === 0 ? (
            <p className="text-muted text-body m-0">The repository is empty. Run git commit to create the first commit.</p>
          ) : (
            <DagView nodes={nodes} edges={edges} tags={tags} minLanes={2} fit highlight={change?.highlight} ariaLabel="Commit graph of the simulated repository" />
          )}
        </section>

        <section className="bg-surface min-w-0 min-h-[16rem] lg:min-h-0 flex flex-col max-lg:order-3" aria-label="Terminal">
          <div ref={termRef} className="flex-1 min-h-0 overflow-y-auto px-4 pt-4 font-mono text-caption leading-5" role="log" aria-label="Command output">
            {log.map((l, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words ${
                  l.kind === "cmd"
                    ? "text-fg mt-3 first:mt-0"
                    : l.kind === "err"
                    ? "text-del border-l-2 border-del pl-2 my-0.5"
                    : l.kind === "info"
                    ? "text-faint font-sans italic text-body"
                    : "text-muted pl-3"
                }`}
              >
                {l.kind === "cmd" && (
                  <>
                    <span className="text-faint">$ </span>
                    {l.text}
                    <span className={`ml-2 ${l.ok ? "text-add" : "text-del"}`} aria-label={l.ok ? "succeeded" : "failed"}>
                      {l.ok ? "✓" : "✕"}
                    </span>
                  </>
                )}
                {l.kind !== "cmd" && l.text}
              </div>
            ))}
            {log.length > 0 && log[log.length - 1].text.startsWith("Type a git") && (
              <div className="text-faint mt-2 whitespace-pre overflow-x-auto">{HELP.join("\n")}</div>
            )}
          </div>
          <div className="flex-none px-4 pt-2 pb-3 space-y-2 max-h-[40%] overflow-y-auto" aria-label="Suggested commands">
            {CATEGORIES.map((cat) => {
              const cmds = suggestions.filter((c) => categoryOf(c) === cat);
              if (cmds.length === 0) return null;
              return (
                <div key={cat} className="flex items-start gap-2">
                  <span className="w-[4.6rem] flex-none pt-1 text-caption text-faint leading-4">{cat}</span>
                  <div className="flex flex-wrap gap-1.5 min-w-0">
                    {cmds.map((c) => (
                      <button key={c} onClick={() => run(c)} className="btn font-mono text-caption px-2 h-7 rounded-md hover:text-accent">
                        {c}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Status line: one or two lines, written like a terminal comment. */}
        <div className="relative min-w-0 px-6 py-3 max-lg:order-2" aria-live="polite">
          <div className="flex items-start gap-2 min-h-[2.5rem]">
            <span className="font-mono text-caption text-faint leading-5 flex-none select-none" aria-hidden>
              #
            </span>
            <p className={`text-body text-fg m-0 min-w-0 flex-1 ${noteOpen ? "" : "line-clamp-2"}`}>
              {note?.text ?? scenario.hint}
            </p>
            <div className="flex-none flex items-center gap-1 -mr-2">
              {(note?.text ?? scenario.hint).length > 150 && (
                <button onClick={() => setNoteOpen((v) => !v)} aria-expanded={noteOpen} className="btn-ghost h-6 px-2 rounded-md text-caption">
                  {noteOpen ? "less" : "more"}
                </button>
              )}
              {note?.recovery && (
                <button
                  onClick={() => setRecoveryOpen((v) => !v)}
                  aria-expanded={recoveryOpen}
                  className="btn-ghost h-6 px-2 rounded-md text-caption text-warn hover:text-warn"
                >
                  {orphanCount > 0 ? `${orphanCount} orphaned` : "recovery"} · {recoveryOpen ? "hide" : "how to recover"}
                </button>
              )}
              <button onClick={() => setKeyOpen((v) => !v)} aria-expanded={keyOpen} className="btn-ghost h-6 px-2 rounded-md text-caption">
                key
              </button>
            </div>
          </div>
          {change && change.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1.5 pl-4" aria-label="What changed">
              {change.chips.slice(0, 6).map((c, i) => (
                <span
                  key={i}
                  className={`font-mono text-caption px-1.5 py-0.5 rounded ${
                    c.kind === "new" ? "bg-add/10 text-add" : c.kind === "rewrite" ? "bg-warn/10 text-warn" : c.kind === "remove" ? "bg-del/10 text-del" : "bg-raised text-muted"
                  }`}
                  title={c.title}
                >
                  {c.text}
                </span>
              ))}
              {change.chips.length > 6 && <span className="font-mono text-caption text-faint py-0.5">+{change.chips.length - 6} more</span>}
            </div>
          )}
          {recoveryOpen && note?.recovery && (
            <p className="text-body text-muted m-0 mt-1 pl-4 max-w-[80ch] max-h-28 overflow-y-auto">{note.recovery}</p>
          )}
          {keyOpen && (
            <div className="popover rounded-lg absolute right-4 bottom-full mb-1 z-20 w-[min(26rem,calc(100%-2rem))] p-3 space-y-2 text-caption text-muted">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <svg width="16" height="16" aria-hidden>
                    <circle cx="8" cy="8" r="5.5" fill="none" stroke="rgb(var(--muted))" strokeWidth="2" />
                  </svg>
                  commit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="16" height="16" aria-hidden>
                    <circle cx="8" cy="8" r="5.5" fill="none" stroke="rgb(var(--muted))" strokeWidth="2" strokeDasharray="3 3" opacity="0.5" />
                  </svg>
                  orphaned: no branch or tag reaches it
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg width="24" height="10" aria-hidden>
                    <line x1="1" y1="5" x2="23" y2="5" stroke="rgb(var(--warn))" strokeWidth="1.5" strokeDasharray="4 3" />
                  </svg>
                  copy (rebase, cherry-pick)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="px-1.5 rounded font-semibold bg-fg text-ground">HEAD → main</span>
                <span className="px-1.5 rounded bg-raised text-fg">topic</span>
                <span className="px-1.5 rounded border border-warn text-warn">v1</span>
                <span>HEAD · local branch · tag</span>
              </div>
              <p className="m-0 text-faint">
                History only: no file contents, so no merge conflicts, and no remote branches. Use the merge and rebase previews on a real repository to see conflicts.
              </p>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(input);
          }}
          className="bg-surface px-4 pb-4 pt-0 max-lg:order-4"
        >
          <div className="field flex items-center gap-2 rounded-lg px-3 h-10">
            <span className="font-mono text-body text-accent" aria-hidden>
              $
            </span>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp" && cmdHistory.length) {
                  e.preventDefault();
                  const i = histIdx === null ? cmdHistory.length - 1 : Math.max(0, histIdx - 1);
                  setHistIdx(i);
                  setInput(cmdHistory[i]);
                } else if (e.key === "ArrowDown" && histIdx !== null) {
                  e.preventDefault();
                  const i = histIdx + 1;
                  if (i >= cmdHistory.length) {
                    setHistIdx(null);
                    setInput("");
                  } else {
                    setHistIdx(i);
                    setInput(cmdHistory[i]);
                  }
                }
              }}
              aria-label="Git command"
              placeholder='git commit -m "message"'
              autoComplete="off"
              spellCheck={false}
              className="flex-1 min-w-0 bg-transparent font-mono text-body text-fg placeholder:text-faint focus:outline-none"
            />
          </div>
        </form>
      </div>
    </main>
  );
}

/** Orphaned commits that no other orphan builds on: the ends of the lost lines of history. */
function newestOrphan(state: SimState, live: Set<string>): string | null {
  const orphans = state.order.filter((id) => !live.has(id));
  const hasOrphanChild = new Set<string>();
  for (const id of orphans) for (const p of state.commits[id].parents) hasOrphanChild.add(p);
  const tips = orphans.filter((id) => !hasOrphanChild.has(id));
  return tips.length ? tips[tips.length - 1] : null;
}

/**
 * How to get back what a command just left unreachable. Only mentions things the simulator
 * really supports: Undo, creating a branch at a commit, and git gc (which makes the loss permanent).
 */
function recoveryFor(before: SimState, after: SimState): string | undefined {
  const liveBefore = reachable(before);
  const liveAfter = reachable(after);
  const newlyLost = after.order.filter((id) => liveBefore.has(id) && !liveAfter.has(id));
  if (newlyLost.length === 0) return undefined;
  const tip = newestOrphan(after, liveAfter);
  const where = tip ? ` Run git branch rescue ${tip.slice(0, 7)} to point a new branch at the newest one.` : "";
  return `${newlyLost.length} commit${newlyLost.length === 1 ? " is" : "s are"} now orphaned. They are still stored, drawn faded with dashed rings.${where} Undo also brings them back. git gc deletes them for good. Real Git can also find them with git reflog; the simulator does not implement the reflog.`;
}

// ---- command categories (only commands the simulator really runs) ----
const CATEGORIES = ["Commits", "Branching", "Merging", "Rebasing", "Undo & recovery", "Inspect"] as const;
type Category = (typeof CATEGORIES)[number];

function categoryOf(cmd: string): Category {
  const verb = cmd.split(/\s+/)[1] ?? "";
  if (verb === "commit") return "Commits";
  if (verb === "merge") return "Merging";
  if (verb === "rebase" || verb === "cherry-pick") return "Rebasing";
  if (verb === "reset" || verb === "revert" || verb === "gc") return "Undo & recovery";
  if (verb === "branch" && /\brescue\b/.test(cmd)) return "Undo & recovery";
  if (verb === "log" || verb === "status") return "Inspect";
  return "Branching"; // branch, checkout, switch, tag
}

interface ChangeChip {
  kind: "new" | "rewrite" | "move" | "remove";
  text: string;
  title?: string;
}

/**
 * Describes what a command did by comparing the real before and after states: commits created,
 * commits re-created (with their old and new hashes), and branch/tag/HEAD movement.
 */
function describeChange(before: SimState, after: SimState): { chips: ChangeChip[]; highlight: Set<string> } {
  const chips: ChangeChip[] = [];
  const highlight = new Set<string>();
  const label = (st: SimState, id: string) => st.commits[id]?.label ?? id.slice(0, 7);
  const liveAfter = reachable(after);

  for (const id of after.order.filter((x) => !before.commits[x])) {
    const c = after.commits[id];
    highlight.add(id);
    const orig = c.copiedFrom;
    if (orig && after.commits[orig]) {
      const rewritten = !liveAfter.has(orig);
      chips.push({
        kind: "rewrite",
        text: `${label(after, orig)} → ${c.label}  ${orig.slice(0, 7)} → ${id.slice(0, 7)}`,
        title: `${rewritten ? "Rewritten" : "Copied"}: the commit was re-created with a new hash (${orig.slice(0, 7)} became ${id.slice(0, 7)})`,
      });
    } else {
      chips.push({ kind: "new", text: `+ ${c.label} ${id.slice(0, 7)}`, title: `New commit ${id.slice(0, 7)}` });
    }
  }
  for (const [name, id] of Object.entries(after.branches)) {
    const was = before.branches[name];
    if (was === id) continue;
    highlight.add(id);
    chips.push({ kind: "move", text: was ? `${name}: ${label(before, was)} → ${label(after, id)}` : `branch ${name} → ${label(after, id)}` });
  }
  for (const name of Object.keys(before.branches)) {
    if (!(name in after.branches)) chips.push({ kind: "remove", text: `deleted branch ${name}` });
  }
  for (const [name, id] of Object.entries(after.tags)) {
    if (before.tags[name] !== id) {
      highlight.add(id);
      chips.push({ kind: "move", text: `tag ${name} → ${label(after, id)}` });
    }
  }
  const h0 = JSON.stringify(before.head);
  const h1 = JSON.stringify(after.head);
  if (h0 !== h1) {
    const where = after.head.kind === "branch" ? after.head.name : `detached at ${label(after, after.head.id)}`;
    chips.push({ kind: "move", text: `HEAD → ${where}` });
    if (after.head.kind === "detached") highlight.add(after.head.id);
    else if (after.branches[after.head.name]) highlight.add(after.branches[after.head.name]);
  }
  return { chips, highlight };
}
