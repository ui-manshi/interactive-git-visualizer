"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { BlameView, FileHistoryView } from "./FileInsights";

interface FlatFile {
  path: string;
  hash: string;
  mode: string;
  isSubmodule: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  file?: FlatFile;
  children: Map<string, TreeNode>;
}

interface BlobResponse {
  size: number;
  binary: boolean;
  truncated: boolean;
  content: string;
}

const MAX_RENDERED_LINES = 3000;
const TREE_MIN_H = 72;
const VIEWER_MIN_H = 160;

function buildTree(files: FlatFile[]): TreeNode {
  const root: TreeNode = { name: "", path: "", children: new Map() };
  for (const file of files) {
    const parts = file.path.split("/");
    let node = root;
    parts.forEach((part, i) => {
      const isLeaf = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join("/"), children: new Map() };
        node.children.set(part, child);
      }
      if (isLeaf) child.file = file;
      node = child;
    });
  }
  return root;
}

function sortedChildren(node: TreeNode): TreeNode[] {
  return Array.from(node.children.values()).sort((a, b) => {
    const aDir = !a.file ? 0 : 1;
    const bDir = !b.file ? 0 : 1;
    return aDir - bDir || a.name.localeCompare(b.name);
  });
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

interface Props {
  repoPath: string;
  commitHash: string;
  /** Jump to a commit in the graph (used by blame and history). */
  onGoToCommit?: (hash: string) => void;
  /** Called with the commits that changed the open file so the graph can dim the rest; null clears it. */
  onFileHistory?: (file: string | null, hashes: Set<string> | null) => void;
  /** Files this commit (or comparison) changed, by status. Used to mark them in the tree. */
  changes?: Map<string, "added" | "modified" | "deleted"> | null;
  /** Open a changed file in the Changes tab. */
  onViewChanges?: (path: string) => void;
}

type FileView = "content" | "blame" | "history";

const STATUS_BADGE = {
  added: { letter: "A", cls: "bg-add/15 text-add", label: "Added in this commit" },
  modified: { letter: "M", cls: "bg-warn/15 text-warn", label: "Modified in this commit" },
  deleted: { letter: "D", cls: "bg-del/15 text-del", label: "Deleted in this commit" },
} as const;

export default function FileTreeExplorer({ repoPath, commitHash, onGoToCommit, onFileHistory, changes = null, onViewChanges }: Props) {
  const [fileView, setFileView] = useState<FileView>("content");
  const [files, setFiles] = useState<FlatFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openFile, setOpenFile] = useState<FlatFile | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  // Height of the file list, set by dragging the bar under it. null = the default share.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [treeH, setTreeH] = useState<number | null>(() => {
    try {
      const v = Number(localStorage.getItem("gv.treeH"));
      return v >= TREE_MIN_H ? v : null;
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      if (treeH === null) localStorage.removeItem("gv.treeH");
      else localStorage.setItem("gv.treeH", String(Math.round(treeH)));
    } catch {}
  }, [treeH]);

  /** The list keeps TREE_MIN_H; the viewer keeps room for its header and a few lines. */
  function clampTreeH(h: number): number {
    const total = wrapRef.current?.clientHeight ?? 600;
    return Math.round(Math.min(Math.max(h, TREE_MIN_H), Math.max(TREE_MIN_H, total - VIEWER_MIN_H - 56)));
  }

  function startTreeResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const tree = handle.previousElementSibling as HTMLElement | null;
    const startY = e.clientY;
    const startH = tree?.getBoundingClientRect().height ?? TREE_MIN_H;
    const move = (ev: PointerEvent) => setTreeH(clampTreeH(startH + ev.clientY - startY));
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "row-resize";
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  // Opening a file scrolls the panel so its content, blame or history is on screen.
  useEffect(() => {
    if (!openFile) return;
    const t = setTimeout(() => viewerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 50);
    return () => clearTimeout(t);
  }, [openFile]);
  const [blob, setBlob] = useState<BlobResponse | null>(null);
  const [blobError, setBlobError] = useState<string | null>(null);

  // Each newly opened file starts on its plain content.
  useEffect(() => {
    setFileView("content");
  }, [openFile]);

  const insightView =
    openFile && !openFile.isSubmodule && fileView === "blame" ? (
      <BlameView repoPath={repoPath} commitHash={commitHash} file={openFile.path} onGoToCommit={onGoToCommit} />
    ) : openFile && !openFile.isSubmodule && fileView === "history" ? (
      <FileHistoryView
        repoPath={repoPath}
        commitHash={commitHash}
        file={openFile.path}
        onGoToCommit={onGoToCommit}
        onHighlight={(h) => onFileHistory?.(h ? openFile.path : null, h)}
      />
    ) : null;

  // Load the snapshot whenever the selected commit changes.
  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setError(null);
    setOpenFile(null);
    setBlob(null);
    fetch(`/api/repo/tree?path=${encodeURIComponent(repoPath)}&commit=${commitHash}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setFiles(data.files);
        setTruncated(data.truncated);
        // Open top-level folders by default so the structure is visible.
        const top = new Set<string>();
        for (const f of data.files as FlatFile[]) {
          const first = f.path.split("/")[0];
          if (f.path.includes("/")) top.add(first);
        }
        setExpanded(top);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath, commitHash]);

  // Load file content when a file is opened.
  useEffect(() => {
    if (!openFile || openFile.isSubmodule) return;
    let cancelled = false;
    setBlob(null);
    setBlobError(null);
    fetch(`/api/repo/blob?path=${encodeURIComponent(repoPath)}&hash=${openFile.hash}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        setBlob(data);
      })
      .catch((e) => !cancelled && setBlobError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [openFile, repoPath]);

  const root = useMemo(() => (files ? buildTree(files) : null), [files]);

  function toggle(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // Folders that contain at least one changed file get a marker, so changes are visible even when collapsed.
  const dirsWithChanges = new Set<string>();
  if (changes) {
    for (const p of changes.keys()) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) dirsWithChanges.add(parts.slice(0, i).join("/"));
    }
  }

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isDir = !node.file;
    const status = node.file ? changes?.get(node.path) : undefined;
    const isOpen = expanded.has(node.path);
    const isSelected = openFile?.path === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => (isDir ? toggle(node.path) : setOpenFile(node.file!))}
          className={`w-full text-left flex items-center gap-1.5 py-0.5 pr-2 text-body rounded hover:bg-raised transition-colors ${
            isSelected ? "bg-accent/15 text-fg" : "text-fg/90"
          }`}
          style={{ paddingLeft: depth * 14 + 6 }}
          title={node.path}
        >
          <span className="w-3 text-muted text-caption flex-shrink-0">
            {isDir ? (isOpen ? "▾" : "▸") : ""}
          </span>
          <NodeIcon kind={isDir ? (isOpen ? "folder-open" : "folder") : node.file?.isSubmodule ? "link" : "file"} />
          <span className="truncate flex-1 min-w-0">{node.name}</span>
          {isDir && !isOpen && dirsWithChanges.has(node.path) && (
            <span className="w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" title="Contains changed files" aria-label="Contains changed files" />
          )}
          {status && (
            <span
              className={`flex-shrink-0 w-4 h-4 rounded text-caption font-bold flex items-center justify-center ${STATUS_BADGE[status].cls}`}
              title={STATUS_BADGE[status].label}
              aria-label={STATUS_BADGE[status].label}
            >
              {STATUS_BADGE[status].letter}
            </span>
          )}
          {node.file?.mode === "100755" && (
            <span className="text-caption text-muted flex-shrink-0">executable</span>
          )}
        </button>
        {isDir && isOpen && sortedChildren(node).map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (error) return <p className="text-del text-body">{error}</p>;
  if (!root || !files) return <p className="text-muted text-body">Loading file tree…</p>;
  if (files.length === 0) return <p className="text-muted text-body">This commit has no files.</p>;

  const lines = blob && !blob.binary ? blob.content.split("\n") : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return (
    <div ref={wrapRef} className="flex flex-col gap-3 flex-1 min-h-0">
      <p className="text-body text-muted m-0 flex-none">
        {files.length} file{files.length === 1 ? "" : "s"} at this commit
        {truncated && " (listing truncated)"}
        {changes && changes.size > 0 && (
          <>
            {" · "}
            <span className="text-fg">{changes.size} changed</span>
            {[...changes.values()].some((s) => s === "deleted") &&
              ` (${[...changes.values()].filter((s) => s === "deleted").length} deleted, so not listed)`}
          </>
        )}
      </p>

      {/* With a file open the tree keeps the upper part and the file gets the rest, so content,
          blame and history are always on screen with their own scrollbar. */}
      <div
        className={`scroll-visible inset rounded-lg py-1 overflow-y-auto overscroll-contain ${
          openFile ? (treeH === null ? "flex-[0_1_36%] min-h-[8rem]" : "flex-none") : "flex-1 min-h-[8rem]"
        }`}
        style={openFile && treeH !== null ? { height: treeH } : undefined}
      >
        {sortedChildren(root).map((n) => renderNode(n, 0))}
      </div>

      {/* Drag to give the file list or the file viewer more room. Arrow keys work too; double-click resets. */}
      {openFile && (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize file list and file viewer"
          aria-valuemin={TREE_MIN_H}
          aria-valuenow={treeH ?? undefined}
          tabIndex={0}
          onPointerDown={startTreeResize}
          onDoubleClick={() => setTreeH(null)}
          onKeyDown={(e) => {
            const cur = treeH ?? (e.currentTarget.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().height ?? 200;
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setTreeH(clampTreeH(cur - 24));
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              setTreeH(clampTreeH(cur + 24));
            } else if (e.key === "Home") {
              e.preventDefault();
              setTreeH(TREE_MIN_H);
            } else if (e.key === "Enter") {
              setTreeH(null);
            }
          }}
          title="Drag to resize. Double-click to reset."
          className="group/split flex-none -my-1.5 h-4 flex items-center justify-center cursor-row-resize touch-none rounded focus-visible:outline-none"
        >
          <span className="h-1 w-12 rounded-full bg-line group-hover/split:bg-accent/70 group-focus-visible/split:bg-accent group-active/split:bg-accent transition-colors" />
        </div>
      )}

      {openFile && (
        <div ref={viewerRef} className="flex flex-col inset rounded-lg overflow-hidden flex-1 min-h-[14rem] scroll-mt-2">
          <div className="flex-none px-3 py-2 bg-raised flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <span className="text-body font-mono text-fg/90 min-w-0 basis-full [overflow-wrap:anywhere]" title={openFile.path}>
              {openFile.path}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {!openFile.isSubmodule && (
                <div role="group" aria-label="File view" className="flex text-caption rounded segmented overflow-hidden">
                  {(["content", "blame", "history"] as FileView[]).map((v) => (
                    <button
                      key={v}
                      onClick={() => setFileView(v)}
                      aria-pressed={fileView === v}
                      className={`px-2 py-0.5 ${fileView === v ? "bg-accent/20 text-fg" : "text-muted hover:text-fg"}`}
                    >
                      {v === "content" ? "Content" : v === "blame" ? "Blame" : "History"}
                    </button>
                  ))}
                </div>
              )}
              {blob && fileView === "content" && (
                <span className="text-caption text-muted">{formatBytes(blob.size)}</span>
              )}
              {onViewChanges && changes?.has(openFile.path) && (
                <button onClick={() => onViewChanges(openFile.path)} className="text-caption text-accent hover:underline whitespace-nowrap">
                  View changes
                </button>
              )}
            </div>
          </div>

          {insightView && <div className="scroll-visible flex-1 min-h-0 overflow-auto overscroll-contain bg-ground/55">{insightView}</div>}

          <div className={`scroll-visible flex-1 min-h-0 overflow-auto overscroll-contain bg-ground/55 ${insightView ? "hidden" : ""}`}>
            {openFile.isSubmodule && (
              <p className="p-3 text-body text-muted">
                Git submodule — pinned to commit{" "}
                <span className="font-mono">{openFile.hash.slice(0, 10)}</span> in another repository.
              </p>
            )}
            {blobError && <p className="p-3 text-body text-del">{blobError}</p>}
            {!blob && !blobError && !openFile.isSubmodule && (
              <p className="p-3 text-body text-muted">Loading…</p>
            )}
            {blob?.binary && (
              <p className="p-3 text-body text-muted">Binary file ({formatBytes(blob.size)}) — not shown.</p>
            )}
            {blob && !blob.binary && (
              <table className="text-body font-mono w-full border-collapse">
                <tbody>
                  {lines.slice(0, MAX_RENDERED_LINES).map((line, i) => (
                    <tr key={i}>
                      <td className="select-none text-right text-faint pl-3 pr-3 align-top w-10">
                        {i + 1}
                      </td>
                      <td className="whitespace-pre text-fg pr-3">{line.replace(/\r$/, "") || " "}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {blob && !blob.binary && (lines.length > MAX_RENDERED_LINES || blob.truncated) && (
              <p className="p-3 text-body text-muted">
                Showing the first {Math.min(lines.length, MAX_RENDERED_LINES)} lines
                {blob.truncated ? " (file is larger than 1 MB; content truncated)" : ""}.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function NodeIcon({ kind }: { kind: "folder" | "folder-open" | "file" | "link" }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "flex-shrink-0",
    "aria-hidden": true,
  };
  if (kind === "file")
    return (
      <svg {...common} className="flex-shrink-0 text-muted">
        <path d="M4 1.5h5l3 3V14a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 4 14V1.5Z" />
        <path d="M9 1.5V5h3" />
      </svg>
    );
  if (kind === "link")
    return (
      <svg {...common} className="flex-shrink-0 text-warn">
        <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.6.6" />
        <path d="M9.5 6.5a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.6-.6" />
      </svg>
    );
  return (
    <svg {...common} className="flex-shrink-0 text-muted">
      {kind === "folder" ? (
        <path d="M1.5 4a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4Z" />
      ) : (
        <path d="M1.5 12.5V4a1 1 0 0 1 1-1h3.2l1.3 1.5h5.5a1 1 0 0 1 1 1V6M1.5 12.5l1.7-5.3a1 1 0 0 1 .95-.7H14.5a.7.7 0 0 1 .67.9l-1.5 5.1a1 1 0 0 1-.96.7H2.5a1 1 0 0 1-1-.7Z" />
      )}
    </svg>
  );
}
