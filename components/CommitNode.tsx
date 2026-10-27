"use client";

import { Handle, NodeProps, Position, useStore } from "reactflow";
import { isReleaseTag } from "./tags";
import { ROW_H, laneX } from "./lanes";

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
  color: string;
  /** x where the commit table starts; always to the right of every lane. */
  labelX: number;
  labelW: number;
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function shortDate(ts: number): string {
  const d = new Date(ts * 1000);
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base}, ${d.getFullYear()}`;
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
  const cx = laneX(data.lane);
  const faded = data.dimmed ? 0.22 : data.faded ? 0.5 : 1;

  return (
    <div
      className={`relative w-full h-full ${selected ? "" : "hover:bg-raised/40"}`}
      style={{ opacity: faded }}
    >
      <Handle type="target" position={Position.Top} style={{ ...handleStyle, left: cx, top: ROW_H / 2 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle, left: cx, top: ROW_H / 2, bottom: "auto" }} />

      {/* The commit. Merge commits are hollow rings; ordinary commits are solid dots. */}
      {selected && (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{ left: cx - 10, top: ROW_H / 2 - 10, width: 20, height: 20, border: "1.5px solid rgb(var(--fg))" }}
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

      {/* The commit table: starts right of the last lane, so text never meets an edge. */}
      <div
        className={`absolute flex items-center gap-2 pr-3 pl-2 rounded-md ${selected ? "bg-raised" : ""}`}
        style={{
          left: data.labelX - 8,
          width: (data.labelW + 8) / scale,
          height: ROW_H / scale,
          top: (ROW_H - ROW_H / scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "0 50%",
        }}
      >
        {data.side && (
          <span className="flex-none text-[10px] font-semibold w-4 h-4 rounded flex items-center justify-center bg-accent text-ground">
            {data.side}
          </span>
        )}
        {showText && (
          <span className="flex-none font-mono text-[11px] w-[3.6rem] text-muted tabular-nums">{data.shortHash}</span>
        )}

        {data.detachedHead && <Chip label="HEAD" color={data.color} variant="head" />}
        {data.chips.slice(0, 3).map((c) => (
          <Chip key={c.name} label={c.name} color={c.color} variant={c.head ? "head" : c.remote ? "remote" : "local"} />
        ))}
        {data.chips.length > 3 && <span className="flex-none text-[11px] text-faint">+{data.chips.length - 3}</span>}
        {tags.slice(0, 2).map((t) => (
          <span
            key={t}
            className={`flex-none inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-[11px] border ${
              isReleaseTag(t) ? "border-warn/70 text-warn" : "border-line text-muted"
            }`}
            title={`${isReleaseTag(t) ? "Release" : "Tag"} ${t}`}
          >
            <FlagIcon size={9} />
            <span className="max-w-[7rem] truncate">{t}</span>
          </span>
        ))}
        {tags.length > 2 && <span className="flex-none text-[11px] text-faint">+{tags.length - 2}</span>}

        {showText ? (
          <span
            className={`flex-1 min-w-0 truncate text-[13px] ${selected ? "text-fg font-medium" : "text-fg/90"}`}
            title={data.message}
          >
            {data.message || <span className="text-faint">(no message)</span>}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {showText && showMeta && (
          <>
            {data.labelW >= 600 && (
              <span className="flex-none w-[7.5rem] truncate text-[12px] text-muted text-right" title={data.author}>
                {data.author}
              </span>
            )}
            <span className="flex-none w-[6.25rem] whitespace-nowrap text-[12px] text-faint text-right tabular-nums">{shortDate(data.timestamp)}</span>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Branch label. Three states, readable without colour alone:
 * checked-out (filled), local (tinted outline), remote-tracking (dashed outline, dim remote prefix).
 */
function Chip({ label, color, variant }: { label: string; color: string; variant: "head" | "local" | "remote" }) {
  const slash = variant === "remote" ? label.indexOf("/") : -1;
  const remotePart = slash > 0 ? label.slice(0, slash + 1) : "";
  const rest = slash > 0 ? label.slice(slash + 1) : label;
  const style =
    variant === "head"
      ? { background: color, color: "rgb(var(--ground))", border: `1px solid ${color}` }
      : variant === "local"
      ? { background: `${color}22`, color, border: `1px solid ${color}66` }
      : { background: "transparent", color, border: `1px dashed ${color}88` };
  return (
    <span
      className={`flex-none inline-flex items-center h-[18px] px-1.5 rounded text-[11px] max-w-[11rem] ${variant === "head" ? "font-semibold" : "font-medium"}`}
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

export function FlagIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden className="flex-shrink-0">
      <path d="M3 1.5a.75.75 0 0 1 .75.75v.4c1.2-.5 2.3-.4 3.5 0 1.3.45 2.4.5 4.1-.2a.5.5 0 0 1 .7.46v5.6a.5.5 0 0 1-.3.46c-1.9.85-3.3.8-4.8.3-1.1-.37-2-.45-3.2.1v4.1a.75.75 0 0 1-1.5 0V2.25A.75.75 0 0 1 3 1.5Z" />
    </svg>
  );
}
