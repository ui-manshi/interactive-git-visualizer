"use client";

import { Handle, NodeProps, Position, useStore } from "reactflow";
import { isReleaseTag } from "./tags";
import { ROW_H, laneX } from "./lanes";

/** Fixed column widths of the commit table (graph units). Every row uses the same ones, so columns align. */
export const COL = { hash: 60, date: 84, author: 112, gap: 12 } as const;

export interface CommitNodeData {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  timestamp: number;
  isMerge: boolean;
  branchNames: string[];
  tagNames?: string[];
  /** Set by the graph when a search/filter is active and this commit does not match. */
  dimmed?: boolean;
}

/** A branch label shown on a commit. */
export interface RefChip {
  name: string;
  remote: boolean;
  /** This is the checked-out branch. */
  head: boolean;
  color: string;
}

/** What the graph adds to each commit before drawing it as a row. */
export interface RowData extends CommitNodeData {
  lane: number;
  /** Drawn distance between lanes (see laneSpacing). */
  laneW: number;
  color: string;
  /** x where the commit table starts; always to the right of every lane. */
  labelX: number;
  labelW: number;
  /** Width of the refs column: as wide as the widest label set in the loaded history, 0 if none. */
  refsW: number;
  /** The table is wide enough for an author column. */
  showAuthor: boolean;
  /** The table is wide enough for a date column. */
  showDate: boolean;
  chips: RefChip[];
  /** HEAD is detached and points at this commit. */
  detachedHead?: boolean;
  /** A commit is selected and this one is not part of its ancestry. */
  faded?: boolean;
  /** Which side of a two-commit comparison this commit is. */
  side?: "A" | "B" | null;
}

const R = 5;
const handleStyle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, transform: "none" } as const;

/** 2025-10-31: fixed width, sortable, and the way a terminal would print it. */
function shortDate(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Approximate rendered width of a ref label, so the refs column can be sized and filled without measuring the DOM. */
export function refLabelWidth(label: string, isTag = false): number {
  return Math.min(176, Math.ceil(label.length * 6.4) + 14 + (isTag ? 13 : 0)) + 4;
}

export default function CommitNode({ data, selected }: NodeProps<RowData>) {
  // Quantised zoom (tenths) so nodes re-render only when the reading size changes.
  const zoomTenths = useStore((s) => Math.round(s.transform[2] * 10));
  const z = Math.max(zoomTenths, 1) / 10;
  // Text keeps a readable on-screen size as you zoom out, until rows are too short to hold it.
  const scale = z >= 0.85 ? 1 : Math.min(0.85 / z, 2.6);
  const showText = zoomTenths >= 4;
  const showMeta = scale <= 1.35;
  const tags = data.tagNames ?? [];
  const cx = laneX(data.lane, data.laneW);
  const faded = data.dimmed ? 0.22 : data.faded ? 0.5 : 1;

  // Fill the refs column in order (HEAD, branches, tags) and fold what does not fit into "+N".
  const refItems: { key: string; node: React.ReactNode; w: number; label: string }[] = [];
  if (data.detachedHead) refItems.push({ key: "detached", node: <Chip label="HEAD" color={data.color} variant="head" />, w: refLabelWidth("HEAD"), label: "HEAD" });
  for (const c of data.chips) {
    refItems.push({
      key: c.name,
      node: <Chip label={c.name} color={c.color} variant={c.head ? "head" : c.remote ? "remote" : "local"} />,
      w: refLabelWidth(c.name),
      label: c.name,
    });
  }
  for (const t of tags) {
    refItems.push({ key: `tag:${t}`, node: <TagChip name={t} />, w: refLabelWidth(t, true), label: t });
  }
  const moreW = 22;
  let used = 0;
  let shown = 0;
  for (const it of refItems) {
    const room = shown === refItems.length - 1 ? data.refsW : data.refsW - moreW;
    if (used + it.w > room && shown > 0) break;
    used += it.w;
    shown++;
  }
  const visibleRefs = refItems.slice(0, shown);
  const hiddenRefs = refItems.slice(shown);

  return (
    <div className="group relative w-full h-full" style={{ opacity: faded }}>
      <Handle type="target" position={Position.Top} style={{ ...handleStyle, left: cx, top: ROW_H / 2 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle, left: cx, top: ROW_H / 2, bottom: "auto" }} />

      {/* The commit. Merge commits are hollow rings; ordinary commits are solid dots. The selection
          ring is the interface accent: it is the one thing on the graph that is not about branches. */}
      {selected && (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{ left: cx - 10, top: ROW_H / 2 - 10, width: 20, height: 20, border: "1.5px solid rgb(var(--accent))" }}
        />
      )}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={
          data.isMerge
            ? { left: cx - R - 1, top: ROW_H / 2 - R - 1, width: 2 * R + 2, height: 2 * R + 2, background: "rgb(var(--ground))", border: `2.25px solid ${data.color}` }
            : { left: cx - R, top: ROW_H / 2 - R, width: 2 * R, height: 2 * R, background: data.color }
        }
      />

      {/* The commit table: starts right of the last lane, so text never meets an edge.
          Columns: hash | refs | message | author | date. */}
      <div
        className={`absolute flex items-center pr-3 pl-2 rounded-md ${selected ? "bg-raised" : "group-hover:bg-raised/40"}`}
        style={{
          left: data.labelX - 8,
          width: (data.labelW + 8) / scale,
          height: ROW_H / scale,
          top: (ROW_H - ROW_H / scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "0 50%",
          columnGap: COL.gap,
        }}
      >
        {data.side && (
          <span className="flex-none text-2xs font-semibold w-4 h-4 rounded flex items-center justify-center bg-accent text-ground">
            {data.side}
          </span>
        )}
        {showText && (
          <span className="flex-none font-mono text-2xs text-muted tabular-nums" style={{ width: COL.hash }}>
            {data.shortHash}
          </span>
        )}

        {showText && data.refsW > 0 && (
          <span className="flex-none flex items-center gap-1 overflow-hidden" style={{ width: data.refsW }}>
            {visibleRefs.map((r) => (
              <span key={r.key} className="flex-none flex">
                {r.node}
              </span>
            ))}
            {hiddenRefs.length > 0 && (
              <span className="flex-none text-2xs text-faint" title={hiddenRefs.map((r) => r.label).join(", ")}>
                +{hiddenRefs.length}
              </span>
            )}
          </span>
        )}

        {showText ? (
          <span
            className={`flex-1 min-w-0 truncate text-sm ${selected ? "text-fg font-medium" : "text-fg/90"}`}
            title={data.message}
          >
            {data.message || <span className="text-faint">(no message)</span>}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {showText && showMeta && (
          <>
            {data.showAuthor && (
              <span className="flex-none truncate text-xs text-muted" style={{ width: COL.author }} title={data.author}>
                {data.author}
              </span>
            )}
            {data.showDate && (
              <span className="flex-none whitespace-nowrap font-mono text-2xs text-faint tabular-nums" style={{ width: COL.date }}>
                {shortDate(data.timestamp)}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Branch label. Three states, readable without colour alone:
 * checked-out (filled), local (outlined), remote-tracking (dashed outline, dim remote prefix).
 */
function Chip({ label, color, variant }: { label: string; color: string; variant: "head" | "local" | "remote" }) {
  const slash = variant === "remote" ? label.indexOf("/") : -1;
  const remotePart = slash > 0 ? label.slice(0, slash + 1) : "";
  const rest = slash > 0 ? label.slice(slash + 1) : label;
  const style =
    variant === "head"
      ? { background: color, color: "rgb(var(--ground))", border: `1px solid ${color}` }
      : variant === "local"
      ? { background: "transparent", color, border: `1px solid ${color}80` }
      : { background: "transparent", color, border: `1px dashed ${color}80` };
  return (
    <span
      className={`flex-none inline-flex items-center h-[18px] px-1.5 rounded text-2xs max-w-[11rem] ${variant === "head" ? "font-semibold" : "font-medium"}`}
      style={style}
      title={
        variant === "head" ? `${label} (checked out)` : variant === "remote" ? `${label} (remote-tracking branch)` : `${label} (local branch)`
      }
    >
      {remotePart && <span className="opacity-60">{remotePart}</span>}
      <span className="truncate">{rest}</span>
    </span>
  );
}

/** Tag label: a flag and the name; release tags (v1.0) are amber, other tags stay neutral. */
function TagChip({ name }: { name: string }) {
  const release = isReleaseTag(name);
  return (
    <span
      className={`flex-none inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-2xs border ${
        release ? "border-warn/60 text-warn" : "border-line text-muted"
      }`}
      title={`${release ? "Release" : "Tag"} ${name}`}
    >
      <FlagIcon size={9} />
      <span className="max-w-[7rem] truncate">{name}</span>
    </span>
  );
}

export function FlagIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden className="flex-shrink-0">
      <path d="M3 1.5a.75.75 0 0 1 .75.75v.4c1.2-.5 2.3-.4 3.5 0 1.3.45 2.4.5 4.1-.2a.5.5 0 0 1 .7.46v5.6a.5.5 0 0 1-.3.46c-1.9.85-3.3.8-4.8.3-1.1-.37-2-.45-3.2.1v4.1a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 3 1.5Z" />
    </svg>
  );
}
