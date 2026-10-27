"use client";

import { useEffect, useMemo, useState } from "react";
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
}

type FileView = "content" | "blame" | "history";

export default function FileTreeExplorer({ repoPath, commitHash, onGoToCommit, onFileHistory }: Props) {
  const [fileView, setFileView] = useState<FileView>("content");
  const [files, setFiles] = useState<FlatFile[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [openFile, setOpenFile] = useState<FlatFile | null>(null);
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

  function renderNode(node: TreeNode, depth: number): React.ReactNode {
    const isDir = !node.file;
    const isOpen = expanded.has(node.path);
    const isSelected = openFile?.path === node.path;

    return (
      <div key={node.path}>
        <button
          onClick={() => (isDir ? toggle(node.path) : setOpenFile(node.file!))}
          className={`w-full text-left flex items-center gap-1.5 py-0.5 pr-2 text-[13px] rounded hover:bg-raised transition-colors ${
            isSelected ? "bg-accent/15 text-fg" : "text-fg/90"
          }`}
          style={{ paddingLeft: depth * 14 + 6 }}
          title={node.path}
        >
          <span className="w-3 text-muted text-[10px] flex-shrink-0">
            {isDir ? (isOpen ? "▾" : "▸") : ""}
          </span>
          <NodeIcon kind={isDir ? (isOpen ? "folder-open" : "folder") : node.file?.isSubmodule ? "link" : "file"} />
          <span className="truncate">{node.name}</span>
          {node.file?.mode === "100755" && (
            <span className="text-[10px] text-muted flex-shrink-0">executable</span>
          )}
        </button>
        {isDir && isOpen && sortedChildren(node).map((c) => renderNode(c, depth + 1))}
      </div>
    );
  }

  if (error) return <p className="text-del text-sm">{error}</p>;
  if (!root || !files) return <p className="text-muted text-sm">Loading file tree…</p>;
  if (files.length === 0) return <p className="text-muted text-sm">This commit has no files.</p>;

  const lines = blob && !blob.binary ? blob.content.split("\n") : [];
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  return (
    <div className="flex flex-col gap-3 h-full min-h-0">
      <p className="text-xs text-muted">
        {files.length} file{files.length === 1 ? "" : "s"} at this commit
        {truncated && " (listing truncated)"}
      </p>

      <div className="inset rounded-lg py-1 max-h-64 overflow-y-auto flex-shrink-0">
        {sortedChildren(root).map((n) => renderNode(n, 0))}
      </div>

      {openFile && (
        <div className="flex-1 min-h-0 flex flex-col inset rounded-lg overflow-hidden">
          <div className="px-3 py-1.5 bg-raised border-b border-line flex items-center justify-between gap-2">
            <span className="text-xs font-mono text-fg/90 truncate" title={openFile.path}>
              {openFile.path}
            </span>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!openFile.isSubmodule && (
                <div role="group" aria-label="File view" className="flex text-[11px] rounded segmented overflow-hidden">
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
                <span className="text-[11px] text-muted">{formatBytes(blob.size)}</span>
              )}
            </div>
          </div>

          {insightView && <div className="flex-1 overflow-auto bg-ground/55">{insightView}</div>}

          <div className={`flex-1 overflow-auto bg-ground/55 ${insightView ? "hidden" : ""}`}>
            {openFile.isSubmodule && (
              <p className="p-3 text-sm text-muted">
                Git submodule — pinned to commit{" "}
                <span className="font-mono">{openFile.hash.slice(0, 10)}</span> in another repository.
              </p>
            )}
            {blobError && <p className="p-3 text-sm text-del">{blobError}</p>}
            {!blob && !blobError && !openFile.isSubmodule && (
              <p className="p-3 text-sm text-muted">Loading…</p>
            )}
            {blob?.binary && (
              <p className="p-3 text-sm text-muted">Binary file ({formatBytes(blob.size)}) — not shown.</p>
            )}
            {blob && !blob.binary && (
              <table className="text-xs font-mono w-full border-collapse">
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
              <p className="p-3 text-xs text-muted">
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
    <svg {...common} className="flex-shrink-0 text-accent">
      {kind === "folder" ? (
        <path d="M1.5 4a1 1 0 0 1 1-1h3.2l1.3 1.5h6.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4Z" />
      ) : (
        <path d="M1.5 12.5V4a1 1 0 0 1 1-1h3.2l1.3 1.5h5.5a1 1 0 0 1 1 1V6M1.5 12.5l1.7-5.3a1 1 0 0 1 .95-.7H14.5a.7.7 0 0 1 .67.9l-1.5 5.1a1 1 0 0 1-.96.7H2.5a1 1 0 0 1-1-.7Z" />
      )}
    </svg>
  );
}
