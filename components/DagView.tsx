"use client";

import { useEffect, useRef, useState } from "react";
import { laneColor } from "./lanes";

/**
 * A small, animated commit diagram for before/after pictures and the simulator.
 * Time runs left to right (col), branches are rows (lane). Edges point from a
 * commit to its parent; "copy" edges show a commit that was re-created
 * (cherry-pick / rebase) from an original.
 */
export interface DagNode {
  id: string;
  col: number;
  lane: number;
  /** Short text inside the ring, e.g. "C3" or "C3'". */
  label: string;
  /** Text under the ring, e.g. a short hash. */
  sub?: string;
  title?: string;
  color?: string;
  /** Faded, dashed ring: orphaned or not-yet-applied. */
  ghost?: boolean;
  merge?: boolean;
  status?: "clean" | "conflict" | "empty";
  /** Draw as a "more commits here" placeholder instead of a commit. */
  gap?: boolean;
}

export interface DagEdge {
  from: string; // child
  to: string; // parent
  kind?: "parent" | "copy";
  ghost?: boolean;
}

export interface DagTag {
  nodeId: string;
  text: string;
  kind: "branch" | "head" | "tag" | "note";
}

const COL_W = 88;
const LANE_H = 84;
const PAD_X = 36;
const PAD_TOP = 58;
const R = 17;

// Reference labels read by fill, not only hue: HEAD is solid ink (teal is reserved for actions), branches are outlined,
// tags are amber with a flag, notes use the error colour.
const TAG_STYLE: Record<DagTag["kind"], { fill: string; stroke: string; text: string }> = {
  head: { fill: "rgb(var(--fg))", stroke: "rgb(var(--fg))", text: "rgb(var(--ground))" },
  branch: { fill: "rgb(var(--raised))", stroke: "rgb(var(--faint))", text: "rgb(var(--fg))" },
  tag: { fill: "transparent", stroke: "rgb(var(--warn))", text: "rgb(var(--warn))" },
  note: { fill: "transparent", stroke: "rgb(var(--del))", text: "rgb(var(--del))" },
};

const FIT_PAD = 20;
/** In fit mode the diagram never grows past this, so a two-commit history is not blown up to poster size. */
const FIT_MAX_SCALE = 1.35;
const tagWidth = (text: string) => Math.max(34, text.length * 6.6 + 16);

export default function DagView({
  nodes,
  edges,
  tags = [],
  minLanes = 1,
  ariaLabel,
  fit = false,
}: {
  nodes: DagNode[];
  edges: DagEdge[];
  tags?: DagTag[];
  minLanes?: number;
  ariaLabel: string;
  /**
   * Crop to the real content and scale it to the space available (centred), instead of drawing at a
   * fixed size from the top-left corner. Used by the simulator; the small before/after previews keep
   * their natural size.
   */
  fit?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!fit) return;
    const el = boxRef.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = (n: DagNode) => ({ x: PAD_X + n.col * COL_W, y: PAD_TOP + n.lane * LANE_H });

  const maxCol = Math.max(0, ...nodes.map((n) => n.col));
  const maxLane = Math.max(minLanes - 1, ...nodes.map((n) => n.lane), 0);
  const width = PAD_X * 2 + maxCol * COL_W + 20;
  const height = PAD_TOP + maxLane * LANE_H + 52;

  // Tags stack upward from their commit.
  const stackCount = new Map<string, number>();

  // Fit mode: the box that really contains the drawing (rings, hashes, the stack of labels above a commit).
  let view = { x: 0, y: 0, w: width, h: height };
  if (fit && nodes.length > 0) {
    const stacks = new Map<string, number>();
    for (const t of tags) stacks.set(t.nodeId, (stacks.get(t.nodeId) ?? 0) + 1);
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const n of nodes) {
      const { x, y } = pos(n);
      x0 = Math.min(x0, x - R);
      x1 = Math.max(x1, x + R);
      y0 = Math.min(y0, y - R - (stacks.get(n.id) ? 12 + 14 + (stacks.get(n.id)! - 1) * 22 + 18 - 14 : 0));
      y1 = Math.max(y1, y + R + 20);
    }
    for (const t of tags) {
      const n = byId.get(t.nodeId);
      if (!n) continue;
      const { x } = pos(n);
      x0 = Math.min(x0, x - tagWidth(t.text) / 2);
      x1 = Math.max(x1, x + tagWidth(t.text) / 2);
    }
    view = { x: x0 - FIT_PAD, y: y0 - FIT_PAD, w: x1 - x0 + 2 * FIT_PAD, h: y1 - y0 + 2 * FIT_PAD };
  }
  const k = fit && box.w > 0 && box.h > 0 ? Math.min(FIT_MAX_SCALE, box.w / view.w, box.h / view.h) : 1;

  return (
    <div
      ref={boxRef}
      className={fit ? "w-full h-full flex items-center justify-center overflow-hidden" : "overflow-x-auto"}
    >
      <svg
        width={fit ? view.w * k : width}
        height={fit ? view.h * k : height}
        viewBox={fit ? `${view.x} ${view.y} ${view.w} ${view.h}` : undefined}
        role="img"
        aria-label={ariaLabel}
        className="block flex-none"
      >
        <defs>
          <marker id="dag-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="context-stroke" />
          </marker>
        </defs>

        {edges.map((e, i) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const p = pos(a);
          const q = pos(b);
          const color = e.kind === "copy" ? "rgb(var(--warn))" : a.color ?? laneColor(Math.max(a.lane, b.lane));
          const opacity = e.ghost || a.ghost ? 0.35 : 1;
          // Start/end on the rings' edges, not their centres.
          const dir = Math.sign(q.x - p.x) || -1;
          const x1 = p.x + dir * R;
          const x2 = q.x - dir * (R + 5);
          const midX = (x1 + x2) / 2;
          const d =
            p.y === q.y && e.kind !== "copy"
              ? `M${x1} ${p.y} L${x2} ${q.y}`
              : e.kind === "copy"
              ? `M${p.x} ${p.y + (q.y >= p.y ? R : -R)} C${p.x} ${(p.y + q.y) / 2 + 30}, ${q.x} ${(p.y + q.y) / 2 + 30}, ${q.x} ${q.y + (q.y >= p.y ? -R - 5 : R + 5)}`
              : `M${x1} ${p.y} C${midX} ${p.y}, ${midX} ${q.y}, ${x2} ${q.y}`;
          return (
            <path
              key={`${e.from}>${e.to}>${i}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={e.kind === "copy" ? 1.5 : 2}
              strokeDasharray={e.kind === "copy" ? "5 5" : e.ghost || a.ghost ? "6 5" : undefined}
              strokeLinecap="round"
              markerEnd="url(#dag-arrow)"
              opacity={opacity}
              className="fade-in"
            />
          );
        })}

        {nodes.map((n) => {
          const { x, y } = pos(n);
          const color = n.status === "conflict" ? "rgb(var(--del))" : n.color ?? laneColor(n.lane);
          if (n.gap) {
            return (
              <g key={n.id} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 180ms ease" }}>
                <text textAnchor="middle" y={5} fontSize={20} fill="rgb(var(--muted))">
                  …
                </text>
                {n.sub && (
                  <text textAnchor="middle" y={R + 16} fontSize={11} fill="rgb(var(--muted))">
                    {n.sub}
                  </text>
                )}
              </g>
            );
          }
          return (
            <g key={n.id} style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 180ms ease" }}>
              <g className="station-in" opacity={n.ghost ? 0.4 : 1}>
                <title>{n.title ?? n.label}</title>
                <circle
                  r={R}
                  fill="rgb(var(--ground))"
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={n.ghost ? "3 3" : undefined}
                />
                {n.merge && <circle r={5} fill={color} />}
                {!n.merge && (
                  <text textAnchor="middle" y={4} fontSize={n.label.length > 3 ? 9 : 11} fontWeight={600} fill="rgb(var(--fg))">
                    {n.status === "conflict" ? "!" : n.label}
                  </text>
                )}
                {n.status === "empty" && (
                  <text textAnchor="middle" y={-R - 5} fontSize={11} fill="rgb(var(--muted))">
                    empty
                  </text>
                )}
                {n.sub && (
                  <text textAnchor="middle" y={R + 16} fontSize={11} fill="rgb(var(--muted))" fontFamily='"JetBrains Mono", monospace'>
                    {n.sub}
                  </text>
                )}
              </g>
            </g>
          );
        })}

        {tags.map((t, i) => {
          const n = byId.get(t.nodeId);
          if (!n) return null;
          const { x, y } = pos(n);
          const k = stackCount.get(t.nodeId) ?? 0;
          stackCount.set(t.nodeId, k + 1);
          const s = TAG_STYLE[t.kind];
          const w = tagWidth(t.text);
          const ty = y - R - 12 - k * 22 - 14;
          return (
            <g key={`${t.nodeId}-${t.text}-${i}`} style={{ transform: `translate(${x}px, ${ty}px)`, transition: "transform 180ms ease" }}>
              <g className="fade-in">
                <rect x={-w / 2} y={0} width={w} height={18} rx={4} fill={s.fill} stroke={s.stroke} strokeDasharray={t.kind === "note" ? "3 2" : undefined} />
                <text textAnchor="middle" y={13} fontSize={11} fontWeight={t.kind === "head" ? 600 : 500} fill={s.text}>
                  {t.text}
                </text>
              </g>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
