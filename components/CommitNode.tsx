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
  /** Width of the fixed refs column. Every row shares it, so messages start at the same x. */
  refW: number;
  chips: RefChip[];
  /** HEAD is detached and points at this commit. */
  detachedHead?: boolean;
  /** A commit is selected and this one is not part of its ancestry. */
  faded?: boolean;
  /** Which side of a two-commit comparison this commit is. */
  side?: "A" | "B" | null;
}

const R = 6;
const handleStyle = { opacity: 0, width: 1, height: 1, minWidth: 0, minHeight: 0, border: 0, transform: "none" } as const;

/** ISO date in local time: fixed width, unambiguous, and it lines up in a column. */
function isoDate(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type RefItem = { kind: "branch"; chip: RefChip } | { kind: "tag"; name: string };

/** Branches first (checked-out, local, remote), then tags. */
export function refItems(chips: RefChip[], tags: string[] | undefined): RefItem[] {
  return [...chips.map((chip) => ({ kind: "branch" as const, chip })), ...(tags ?? []).map((name) => ({ kind: "tag" as const, name }))];
}

/** Approximate rendered width of a ref label, used to size the shared refs column. */
export function refItemWidth(it: RefItem): number {
  return it.kind === "branch" ? Math.min(176, it.chip.name.length * 6.3 + 18) : Math.min(150, it.name.length * 6.3 + 32);
}

export function refsWidth(items: RefItem[]): number {
  return items.reduce((w, it) => w + refItemWidth(it), 0) + Math.max(0, items.length - 1) * 4;
}

export default function CommitNode({ data, selected }: NodeProps<RowData>) {
  // Quantised zoom (tenths) so nodes re-render only when the reading size changes.
  const zoomTenths = useStore((s) => Math.round(s.transform[2] * 10));
  const z = Math.max(zoomTenths, 1) / 10;
  // Text keeps a readable on-screen size as you zoom out, until rows are too short to hold it.
  const scale = z >= 0.85 ? 1 : Math.min(0.85 / z, 2.6);
  const showText = zoomTenths >= 4;
  const showMeta = scale <= 1.35;
  const cx = laneX(data.lane);
  const faded = data.dimmed ? 0.22 : data.faded ? 0.5 : 1;

  // Fit as many ref labels as the shared column allows; the rest collapse into "+n".
  const items = refItems(data.chips, data.tagNames);
  const shown: RefItem[] = [];
  let used = 0;
  for (let i = 0; i < items.length; i++) {
    const w = refItemWidth(items[i]) + (shown.length ? 4 : 0);
    const reserve = i < items.length - 1 ? 30 : 0;
    if (used + w + reserve > data.refW && shown.length > 0) break;
    shown.push(items[i]);
    used += w;
  }
  const hidden = items.slice(shown.length);
  const tableLeft = data.labelX - 8;

  return (
    <div className="group relative w-full h-full" style={{ opacity: faded }}>
      <Handle type="target" position={Position.Top} style={{ ...handleStyle, left: cx, top: ROW_H / 2 }} />
      <Handle type="source" position={Position.Bottom} style={{ ...handleStyle, left: cx, top: ROW_H / 2, bottom: "auto" }} />

      {/* Leader line: carries the eye from a commit's dot across the lanes to its row of text. */}
      <span
        aria-hidden
        className={`absolute transition-opacity ${selected ? "opacity-70" : "opacity-0 group-hover:opacity-50"}`}
        style={{
          left: cx + R + 8,
          width: Math.max(0, tableLeft - cx - R - 12),
          top: ROW_H / 2,
          borderTop: `1px dotted ${data.color}`,
        }}
      />

      {/* The commit. Merge commits are hollow rings; ordinary commits are solid dots. */}
      {selected && (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{ left: cx - 11, top: ROW_H / 2 - 11, width: 22, height: 22, border: "1.5px solid rgb(var(--fg))" }}
        />
      )}
      <span
        aria-hidden
        className="absolute rounded-full"
        style={
          data.isMerge
            ? { left: cx - R - 1, top: ROW_H / 2 - R - 1, width: 2 * R + 2, height: 2 * R + 2, background: "rgb(var(--ground))", border: `2.5px solid ${data.color}` }
            : { left: cx - R, top: ROW_H / 2 - R, width: 2 * R, height: 2 * R, background: data.color }
        }
      />

      {/* The commit table. Fixed columns: hash | refs | message | author | date. */}
      <div
        className={`absolute flex items-center gap-3 pr-3 pl-2 rounded-md ${selected ? "bg-raised" : "group-hover:bg-raised/50"}`}
        style={{
          left: tableLeft,
          width: (data.labelW + 8) / scale,
          height: ROW_H / scale,
          top: (ROW_H - ROW_H / scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "0 50%",
        }}
      >
        {data.side && (
          <span className="flex-none text-caption font-semibold w-4 h-4 rounded flex items-center justify-center bg-accent text-ground">
            {data.side}
          </span>
        )}
        {showText && <span className="flex-none font-mono text-caption w-[3.5rem] text-muted tabular-nums">{data.shortHash}</span>}

        {data.refW > 0 && (
          <div className="flex-none flex items-center gap-1 overflow-hidden" style={{ width: data.refW }} title={items.map((i) => (i.kind === "branch" ? i.chip.name : `tag ${i.name}`)).join(", ") || undefined}>
            {data.detachedHead && <Chip label="HEAD" color={data.color} variant="head" />}
            {shown.map((it) =>
              it.kind === "branch" ? (
                <Chip key={it.chip.name} label={it.chip.name} color={it.chip.color} variant={it.chip.head ? "head" : it.chip.remote ? "remote" : "local"} />
              ) : (
                <span
                  key={`tag-${it.name}`}
                  className={`flex-none inline-flex items-center gap-1 h-[18px] px-1.5 rounded text-caption ${isReleaseTag(it.name) ? "text-warn bg-warn/10" : "text-muted bg-raised"}`}
                  title={`${isReleaseTag(it.name) ? "Release" : "Tag"} ${it.name}`}
                >
                  <FlagIcon size={9} />
                  <span className="max-w-[7rem] truncate">{it.name}</span>
                </span>
              )
            )}
            {hidden.length > 0 && <span className="flex-none font-mono text-caption text-faint">+{hidden.length}</span>}
          </div>
        )}

        {showText ? (
          <span className={`flex-1 min-w-0 truncate text-body ${selected ? "text-fg font-medium" : "text-fg/90"}`} title={data.message}>
            {data.message || <span className="text-faint">(no message)</span>}
          </span>
        ) : (
          <span className="flex-1" />
        )}

        {showText && showMeta && (
          <>
            {data.labelW >= 600 && (
              <span className="flex-none w-[6.5rem] truncate text-body text-muted" title={data.author}>
                {data.author}
              </span>
            )}
            {data.labelW >= 520 && (
              <span className="flex-none w-[5.5rem] font-mono text-caption text-faint text-right tabular-nums">{isoDate(data.timestamp)}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Branch label. Three states, readable without colour alone:
 * checked-out (filled), local (tinted), remote-tracking (dashed outline, dim remote prefix).
 */
function Chip({ label, color, variant }: { label: string; color: string; variant: "head" | "local" | "remote" }) {
  const slash = variant === "remote" ? label.indexOf("/") : -1;
  const remotePart = slash > 0 ? label.slice(0, slash + 1) : "";
  const rest = slash > 0 ? label.slice(slash + 1) : label;
  const style =
    variant === "head"
      ? { background: color, color: "rgb(var(--ground))" }
      : variant === "local"
      ? { background: `${color}26`, color }
      : { background: "transparent", color, border: `1px dashed ${color}88` };
  return (
    <span
      className={`flex-none inline-flex items-center h-[18px] px-1.5 rounded text-caption max-w-[11rem] ${variant === "head" ? "font-semibold" : "font-medium"}`}
      style={style}
      title={variant === "head" ? `${label} (checked out)` : variant === "remote" ? `${label} (remote-tracking branch)` : `${label} (local branch)`}
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
