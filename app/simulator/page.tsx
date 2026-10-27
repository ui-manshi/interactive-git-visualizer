"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import DagView, { DagEdge, DagNode, DagTag } from "@/components/DagView";
import { laneColor } from "@/components/lanes";
import { Brand, Toolbar, ToolbarDivider } from "@/components/shell";
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
    setNote(result.ok && result.note ? { text: result.note, recovery: recoveryFor(state, result.state) } : null);
    setCmdHistory((h) => [...h, text]);
    setHistIdx(null);
    setInput("");
  }

  function undo() {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      setState(u[u.length - 1]);
      setLog((l) => [...l, { kind: "info", text: "Undid the last command." }]);
      setNote(null);
      return u.slice(0, -1);
    });
  }

  function load(id: string) {
    const sc = SCENARIOS.find((s) => s.id === id)!;
    setScenarioId(id);
    setState(sc.build());
    setUndoStack([]);
    setNote(null);
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
        <ToolbarDivider />
        <h1 className="text-[13px] font-medium m-0 flex-none">Simulator</h1>
        <span className="flex-1 min-w-0" />
        <label className="sr-only" htmlFor="scenario">
          Starting scenario
        </label>
        <select
          id="scenario"
          value={scenarioId}
          onChange={(e) => load(e.target.value)}
          className="field rounded-md px-2 h-8 text-xs min-w-0 max-w-[11rem]"
        >
          {SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button onClick={undo} disabled={undoStack.length === 0} className="btn text-xs px-3 h-8 rounded-md flex-none">
          Undo
        </button>
        {confirmReset ? (
          <div role="group" aria-label="Confirm reset" className="flex items-center gap-1 flex-none">
            <span className="hidden md:inline text-xs text-muted mr-1">
              Discard {loggedCommands} change{loggedCommands === 1 ? "" : "s"}?
            </span>
            <button
              onClick={() => load(scenarioId)}
              className="text-xs px-3 h-8 rounded-md border border-del/60 text-del hover:bg-del/10"
              autoFocus
            >
              Reset
            </button>
            <button onClick={() => setConfirmReset(false)} className="btn text-xs px-3 h-8 rounded-md">
              Keep
            </button>
          </div>
        ) : (
          <button
            onClick={() => (undoStack.length > 0 ? setConfirmReset(true) : load(scenarioId))}
            className="btn text-xs px-3 h-8 rounded-md flex-none"
            title="Return to the starting scenario"
          >
            Reset
          </button>
        )}
        <Link href="/" className="btn-ghost hidden md:inline-flex items-center h-8 px-2.5 rounded-md text-[13px] flex-none">
          Open a repository
        </Link>
      </Toolbar>

      <div className="flex-1 min-h-0 grid lg:grid-cols-[minmax(0,1fr)_26rem] max-lg:overflow-y-auto max-lg:grid-rows-[auto_minmax(24rem,1fr)]">
        {/* ---- Left: graph and explanation ---- */}
        <section className="min-w-0 min-h-0 flex flex-col lg:border-r border-line max-lg:min-h-[28rem]" aria-label="Repository state">
          <div className="flex-1 min-h-[16rem] overflow-auto code-surface border-0 border-b p-3">
            {nodes.length === 0 ? (
              <p className="text-muted text-sm p-4 m-0">The repository is empty. Run git commit to create the first commit.</p>
            ) : (
              <DagView nodes={nodes} edges={edges} tags={tags} minLanes={2} ariaLabel="Commit graph of the simulated repository" />
            )}
          </div>

          <div className="flex-none px-4 py-3 space-y-3 max-h-[45%] overflow-y-auto" aria-live="polite">
            <div>
              <h2 className="text-xs font-semibold text-muted m-0 mb-1">What just happened</h2>
              <p className="text-sm text-fg m-0 leading-relaxed max-w-[75ch]">{note?.text ?? scenario.hint}</p>
            </div>
            {note?.recovery && (
              <div className="border-l-2 border-warn pl-3">
                <h2 className="text-xs font-semibold text-warn m-0 mb-1">How to recover</h2>
                <p className="text-sm text-fg/90 m-0 leading-relaxed max-w-[75ch]">{note.recovery}</p>
              </div>
            )}
          </div>

          <div className="flex-none px-4 py-2.5 border-t border-line text-[11px] text-muted space-y-1.5">
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
                orphaned{orphanCount > 0 ? ` (${orphanCount})` : ""}: no branch or tag reaches it
              </span>
              <span className="inline-flex items-center gap-1.5">
                <svg width="24" height="10" aria-hidden>
                  <line x1="1" y1="5" x2="23" y2="5" stroke="rgb(var(--warn))" strokeWidth="1.5" strokeDasharray="4 3" />
                </svg>
                copy made by rebase or cherry-pick
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1.5 rounded text-[10px] font-semibold bg-accent text-ground">HEAD → main</span> where new commits go
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1.5 rounded text-[10px] border border-faint bg-raised text-fg">topic</span> local branch
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="px-1.5 rounded text-[10px] border border-warn text-warn">v1</span> tag
              </span>
            </div>
            <p className="m-0 text-faint">
              The simulator tracks history only: no file contents, so no merge conflicts, and no remote branches. Use the merge and
              rebase previews on a real repository to see conflicts.
            </p>
          </div>
        </section>

        {/* ---- Right: terminal ---- */}
        <section className="min-w-0 min-h-0 flex flex-col bg-surface" aria-label="Terminal">
          <div ref={termRef} className="flex-1 min-h-0 overflow-y-auto p-3 font-mono text-xs leading-relaxed" role="log" aria-label="Command output">
            {log.map((l, i) => (
              <div
                key={i}
                className={`whitespace-pre-wrap break-words ${
                  l.kind === "cmd"
                    ? "text-fg mt-3 first:mt-0"
                    : l.kind === "err"
                    ? "text-del border-l-2 border-del pl-2 my-0.5"
                    : l.kind === "info"
                    ? "text-faint font-sans italic"
                    : "text-muted pl-3"
                }`}
              >
                {l.kind === "cmd" && (
                  <>
                    <span className="text-accent">$ </span>
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
              <div className="text-faint mt-2 whitespace-pre-wrap">{HELP.join("\n")}</div>
            )}
          </div>

          <div className="flex-none border-t border-line p-3 space-y-2.5">
            <div className="flex flex-wrap gap-1.5" aria-label="Suggested commands">
              {suggestions.map((c) => (
                <button key={c} onClick={() => run(c)} className="btn font-mono text-[11px] px-2 h-7 rounded-md hover:text-accent">
                  {c}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(input);
              }}
              className="field flex items-center gap-2 rounded-lg px-3 h-10"
            >
              <span className="font-mono text-accent text-sm" aria-hidden>
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
                className="flex-1 min-w-0 bg-transparent font-mono text-sm text-fg placeholder:text-faint focus:outline-none"
              />
            </form>
          </div>
        </section>
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
