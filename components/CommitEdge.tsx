"use client";

import { EdgeProps, useStore } from "reactflow";

export interface EdgeData {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  /** "first": the line a branch continues along. "merge": a merged-in branch joining the merge commit. */
  kind: "first" | "merge";
  color: string;
  opacity: number;
  width: number;
}

const CORNER = 10;
/** Extra stroke width of the background-coloured underlay that opens a gap where two lines cross. */
const HALO = 4;

/**
 * Lane routing. Straight lines stay in their lane.
 * - first-parent edge that changes lane (a branch point): run down the child's lane,
 *   then curve into the parent's lane at the parent's row.
 * - merge edge: leave the merge commit sideways on its own row, then run down the
 *   merged branch's lane to the parent.
 * Either way the bend happens beside a commit, never in the middle of the lane gap.
 */
export function edgePath({ sx, sy, tx, ty, kind }: Pick<EdgeData, "sx" | "sy" | "tx" | "ty" | "kind">): string {
  if (sx === tx) return `M${sx} ${sy} V${ty}`;
  const dir = tx > sx ? 1 : -1;
  const r = Math.min(CORNER, Math.abs(tx - sx), (ty - sy) / 2);
  if (kind === "merge") {
    return `M${sx} ${sy} H${tx - dir * r} Q${tx} ${sy} ${tx} ${sy + r} V${ty}`;
  }
  return `M${sx} ${sy} V${ty - r} Q${sx} ${ty} ${sx + dir * r} ${ty} H${tx}`;
}

export default function CommitEdge({ data }: EdgeProps<EdgeData>) {
  const zoomTenths = useStore((s) => Math.round(s.transform[2] * 10));
  if (!data) return null;
  const z = Math.max(zoomTenths, 1) / 10;
  // Keep lines at least ~1px on screen when zoomed far out.
  const width = Math.max(data.width, 1.1 / z);
  const d = edgePath(data);
  return (
    <g opacity={data.opacity}>
      {/* Underlay in the canvas colour: where this edge crosses another, the older one is cut
          cleanly instead of the two colours blending into a knot. */}
      <path d={d} fill="none" stroke="rgb(var(--ground))" strokeWidth={width + HALO} strokeLinecap="round" strokeLinejoin="round" />
      <path d={d} fill="none" stroke={data.color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}
