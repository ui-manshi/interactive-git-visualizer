"use client";

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

// Reference labels read by fill, not only hue: HEAD is solid, branches are outlined,
// tags are amber with a flag, notes use the error colour.
const TAG_STYLE: Record<DagTag["kind"], { fill: string; stroke: string; text: string }> = {
  head: { fill: "rgb(var(--accent))", stroke: "rgb(var(--accent))", text: "rgb(var(--ground))" },
  branch: { fill: "rgb(var(--raised))", stroke: "rgb(var(--faint))", text: "rgb(var(--fg))" },
  tag: { fill: "transparent", stroke: "rgb(var(--warn))", text: "rgb(var(--warn))" },
  note: { fill: "transparent", stroke: "rgb(var(--del))", text: "rgb(var(--del))" },
};

export default function DagView({
  nodes,
  edges,
  tags = [],
  minLanes = 1,
  ariaLabel,
}: {
  nodes: DagNode[];
  edges: DagEdge[];
  tags?: DagTag[];
  minLanes?: number;
  ariaLabel: string;
}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = (n: DagNode) => ({ x: PAD_X + n.col * COL_W, y: PAD_TOP + n.lane * LANE_H });

  const maxCol = Math.max(0, ...nodes.map((n) => n.col));
  const maxLane = Math.max(minLanes - 1, ...nodes.map((n) => n.lane), 0);
  const width = PAD_X * 2 + maxCol * COL_W + 20;
  const height = PAD_TOP + maxLane * LANE_H + 52;

  // Tags stack upward from their commit.
  const stackCount = new Map<string, number>();

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label={ariaLabel} className="block">
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
                  <text textAnchor="middle" y={R + 16} fontSize={10} fill="rgb(var(--muted))">
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
                  <text textAnchor="middle" y={-R - 5} fontSize={9} fill="rgb(var(--muted))">
                    empty
                  </text>
                )}
                {n.sub && (
                  <text textAnchor="middle" y={R + 16} fontSize={10} fill="rgb(var(--muted))" fontFamily='"JetBrains Mono", monospace'>
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
          const w = Math.max(34, t.text.length * 6.6 + 16);
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
