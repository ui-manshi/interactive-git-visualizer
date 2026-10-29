"use client";

import { useEffect, useState } from "react";
import { Lang, TOKEN_CLASS, highlightLine, langFor } from "@/lib/highlight";

// Mirrors NO_EOL in lib/commitDiff.ts (a marker on a last line with no trailing newline).
const NO_EOL = "\u0001";

interface FileChange {
  path: string;
  status: "added" | "deleted" | "modified";
  binary: boolean;
  submodule: boolean;
  modeOnly: boolean;
  additions: number | null;
  deletions: number | null;
}

interface Summary {
  files: FileChange[];
  totalFiles: number;
  additions: number;
  deletions: number;
  statsLimited: boolean;
}

interface DiffOp {
  type: "equal" | "insert" | "delete";
  text: string;
  oldLine?: number;
  newLine?: number;
}

interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  ops: DiffOp[];
}

interface FileDiff {
  path: string;
  binary: boolean;
  submodule: boolean;
  additions: number;
  deletions: number;
  approximate: boolean;
  hunks: Hunk[];
}

const STATUS_STYLE: Record<FileChange["status"], { letter: string; cls: string }> = {
  added: { letter: "A", cls: "bg-add/15 text-add" },
  modified: { letter: "M", cls: "bg-warn/15 text-warn" },
  deleted: { letter: "D", cls: "bg-del/15 text-del" },
};

export type DiffMode = "unified" | "split";

interface Props {
  repoPath: string;
  mode?: DiffMode;
  onModeChange?: (mode: DiffMode) => void;
  /** Base commit hash, or null to diff against the empty tree (root commit). */
  from: string | null;
  to: string;
}

export default function DiffViewer({ repoPath, from, to, mode = "unified", onModeChange }: Props) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  const base = `/api/repo/diff?path=${encodeURIComponent(repoPath)}&from=${from ?? ""}&to=${to}`;

  useEffect(() => {
    let cancelled = false;
    setSummary(null);
    setError(null);
    setOpenPath(null);
    setDiff(null);
    fetch(base)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setSummary(data);
        // Auto-open the first file when the change set is small and reviewable.
        const first = (data as Summary).files.find((f) => !f.binary && !f.submodule && !f.modeOnly);
        if (first && data.files.length <= 3) setOpenPath(first.path);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [base]);

  useEffect(() => {
    if (!openPath) return;
    let cancelled = false;
    setDiff(null);
    setDiffError(null);
    fetch(`${base}&file=${encodeURIComponent(openPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setDiff(data);
      })
      .catch((e) => !cancelled && setDiffError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [openPath, base]);

  if (error) return <p className="text-del text-body m-0">{error}</p>;
  if (!summary) return <p className="text-muted text-body m-0">Computing diff…</p>;

  if (summary.files.length === 0) {
    return <p className="text-muted text-body m-0">No file changes between these commits.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-body text-fg m-0">
          {summary.totalFiles} file{summary.totalFiles === 1 ? "" : "s"} changed{" "}
          <span className="font-mono text-body text-add">+{summary.additions}</span>{" "}
          <span className="font-mono text-body text-del">−{summary.deletions}</span>
          {summary.statsLimited && <span className="text-muted"> (line counts skipped for some files)</span>}
        </p>
        {onModeChange && (
          <div role="group" aria-label="Diff layout" className="segmented flex text-body rounded-md overflow-hidden">
            {(["unified", "split"] as DiffMode[]).map((m) => (
              <button
                key={m}
                onClick={() => onModeChange(m)}
                aria-pressed={mode === m}
                title={m === "split" ? "Side by side (d)" : "Unified (d)"}
                className={`px-2.5 h-7 transition-colors ${mode === m ? "" : "text-muted hover:text-fg"}`}
              >
                {m === "split" ? "Side by side" : "Unified"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {summary.files.map((f) => {
          const st = STATUS_STYLE[f.status];
          const isOpen = openPath === f.path;
          const expandable = !f.binary && !f.submodule && !f.modeOnly;
          const slash = f.path.lastIndexOf("/");
          const dir = slash >= 0 ? f.path.slice(0, slash + 1) : "";
          const name = slash >= 0 ? f.path.slice(slash + 1) : f.path;

          return (
            <section key={f.path} className="border border-line rounded-md">
              <button
                onClick={() => expandable && setOpenPath(isOpen ? null : f.path)}
                aria-expanded={expandable ? isOpen : undefined}
                className={`w-full flex items-start gap-2 px-2.5 py-1.5 bg-raised text-left sticky top-0 z-[1] ${
                  isOpen ? "border-b border-line rounded-t-md" : "rounded-md"
                } ${expandable ? "hover:brightness-110 cursor-pointer" : "cursor-default"}`}
              >
                <span
                  className={`text-caption font-bold w-[18px] h-[18px] mt-px flex items-center justify-center rounded flex-none ${st.cls}`}
                  title={f.status}
                  aria-label={f.status}
                >
                  {st.letter}
                </span>
                <span className="font-mono text-body leading-5 min-w-0 flex-1 [overflow-wrap:anywhere]" title={f.path}>
                  <span className="text-faint">{dir}</span>
                  <span className="text-fg font-medium">{name}</span>
                </span>
                <span className="text-caption leading-5 flex-none font-mono">
                  {f.binary && <span className="text-muted">binary</span>}
                  {f.submodule && <span className="text-muted">submodule</span>}
                  {f.modeOnly && <span className="text-muted">mode change</span>}
                  {f.additions !== null && !f.binary && !f.modeOnly && (
                    <>
                      <span className="text-add">+{f.additions}</span> <span className="text-del">−{f.deletions}</span>
                    </>
                  )}
                </span>
                {expandable && (
                  <svg
                    className={`flex-none mt-1.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="rgb(var(--muted))"
                    aria-hidden
                  >
                    <path d="M3 1.5 7 5 3 8.5z" />
                  </svg>
                )}
              </button>

              {isOpen && (
                <div className="bg-ground overflow-x-auto rounded-b-md">
                  {diffError && <p className="p-3 text-body text-del m-0">{diffError}</p>}
                  {!diff && !diffError && <p className="p-3 text-body text-muted m-0">Loading…</p>}
                  {diff && diff.path === f.path && <HunkTable diff={diff} mode={mode} lang={langFor(f.path)} />}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** Code text for one line, with syntax colour when the file type is known. */
function Code({ text, lang }: { text: string; lang: Lang | null }) {
  return (
    <>
      {highlightLine(text || " ", lang).map((t, i) =>
        t.kind ? (
          <span key={i} className={TOKEN_CLASS[t.kind]}>
            {t.text}
          </span>
        ) : (
          t.text
        )
      )}
    </>
  );
}

const GUTTER = "select-none text-right text-faint tabular-nums align-top px-2 min-w-[3rem] border-r border-line/60";
const HUNK_ROW = "bg-raised";
const HUNK_CELL = "px-3 py-0.5 text-faint select-none";

function HunkTable({ diff, mode, lang }: { diff: FileDiff; mode: DiffMode; lang: Lang | null }) {
  if (diff.hunks.length === 0) {
    return <p className="p-3 text-body text-muted m-0">No line changes.</p>;
  }

  return (
    <div>
      {diff.approximate && (
        <p className="px-3 py-1.5 text-caption text-warn bg-warn/10 m-0">
          This change is very large, so the whole changed region is shown as replaced rather than
          minimally diffed.
        </p>
      )}
      {mode === "split" ? (
        <table className="text-body leading-5 font-mono w-full border-collapse table-fixed">
          <colgroup>
            <col style={{ width: "3.25rem" }} />
            <col />
            <col style={{ width: "3.25rem" }} />
            <col />
          </colgroup>
          <tbody>
            {diff.hunks.map((h, hi) => (
              <SplitHunkRows key={hi} hunk={h} lang={lang} />
            ))}
          </tbody>
        </table>
      ) : (
        <table className="text-body leading-5 font-mono w-full border-collapse">
          <tbody>
            {diff.hunks.map((h, hi) => (
              <HunkRows key={hi} hunk={h} lang={lang} />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function HunkRows({ hunk, lang }: { hunk: Hunk; lang: Lang | null }) {
  return (
    <>
      <tr className={HUNK_ROW}>
        <td colSpan={4} className={HUNK_CELL}>
          @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </td>
      </tr>
      {hunk.ops.map((op, i) => {
        const noEol = op.text.includes(NO_EOL);
        const text = op.text.replace(NO_EOL, "").replace(/\r$/, "");
        const rowCls = op.type === "insert" ? "bg-add/10" : op.type === "delete" ? "bg-del/10" : "";
        const gutterBg = op.type === "insert" ? "bg-add/15" : op.type === "delete" ? "bg-del/15" : "";
        const signCls = op.type === "insert" ? "text-add" : op.type === "delete" ? "text-del" : "text-faint";
        return (
          <tr key={i} className={rowCls}>
            <td className={`${GUTTER} ${gutterBg}`}>{op.oldLine ?? ""}</td>
            <td className={`${GUTTER} ${gutterBg}`}>{op.newLine ?? ""}</td>
            <td className={`select-none w-4 text-center align-top ${signCls}`}>
              {op.type === "insert" ? "+" : op.type === "delete" ? "−" : ""}
            </td>
            <td className="whitespace-pre text-fg pr-3">
              <Code text={text} lang={lang} />
              {noEol && <span className="ml-2 text-caption text-warn select-none">⏎ no newline at end of file</span>}
            </td>
          </tr>
        );
      })}
    </>
  );
}

/** Lines of a change run are paired up: the n-th removed line sits beside the n-th added line. */
function pairOps(ops: DiffOp[]): { l?: DiffOp; r?: DiffOp }[] {
  const rows: { l?: DiffOp; r?: DiffOp }[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].type === "equal") {
      rows.push({ l: ops[i], r: ops[i] });
      i++;
      continue;
    }
    const dels: DiffOp[] = [];
    const ins: DiffOp[] = [];
    while (i < ops.length && ops[i].type !== "equal") {
      (ops[i].type === "delete" ? dels : ins).push(ops[i]);
      i++;
    }
    const n = Math.max(dels.length, ins.length);
    for (let k = 0; k < n; k++) rows.push({ l: dels[k], r: ins[k] });
  }
  return rows;
}

function SplitHunkRows({ hunk, lang }: { hunk: Hunk; lang: Lang | null }) {
  const rows = pairOps(hunk.ops);

  const cell = (op: DiffOp | undefined, side: "l" | "r") => {
    if (!op) {
      return (
        <>
          <td className={`bg-raised/60 ${side === "l" ? "" : ""} border-r border-line/60`} />
          <td className="bg-raised/60" />
        </>
      );
    }
    const noEol = op.text.includes(NO_EOL);
    const text = op.text.replace(NO_EOL, "").replace(/\r$/, "");
    const bg = op.type === "insert" ? "bg-add/10" : op.type === "delete" ? "bg-del/10" : "";
    const gutterBg = op.type === "insert" ? "bg-add/15" : op.type === "delete" ? "bg-del/15" : "";
    const sign = op.type === "insert" ? "+" : op.type === "delete" ? "−" : "";
    const signCls = op.type === "insert" ? "text-add" : "text-del";
    const lineNo = side === "l" ? op.oldLine : op.newLine;
    return (
      <>
        <td className={`${GUTTER} ${gutterBg}`}>{lineNo ?? ""}</td>
        <td className={`whitespace-pre-wrap break-all text-fg pr-2 align-top ${bg} ${side === "l" ? "border-r border-line" : ""}`}>
          <span className={`select-none inline-block w-3 ${signCls}`}>{sign}</span>
          <Code text={text} lang={lang} />
          {noEol && <span className="ml-2 text-caption text-warn select-none">⏎ no newline at end of file</span>}
        </td>
      </>
    );
  };

  return (
    <>
      <tr className={HUNK_ROW}>
        <td colSpan={4} className={HUNK_CELL}>
          @@ −{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </td>
      </tr>
      {rows.map((r, i) => (
        <tr key={i}>
          {cell(r.l, "l")}
          {cell(r.r, "r")}
        </tr>
      ))}
    </>
  );
}
