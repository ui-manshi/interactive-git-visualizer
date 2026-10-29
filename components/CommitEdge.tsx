"use client";

import { EdgeProps, useStore } from "reactflow";
import { LANE_W, ROW_H } from "@/lib/graphLayout";

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

/**
 * Lane routing. Lines that stay in their lane are straight. A line that changes lane travels
 * in its own lane and then eases across to the other lane in a smooth S-curve that spans
 * more rows the further it has to go, so a long jump is a gentle diagonal instead of a
 * horizontal run along a commit's row.
 *
 * - first-parent edge changing lane (a branch point): straight in the child's lane, then the
 *   S-curve ends exactly on the parent commit.
 * - merge edge: the S-curve leaves the merge commit and ends in the merged branch's lane, which
 *   then runs straight down to the parent.
 *
 * Because bends happen between rows, an edge arriving at a commit and an edge leaving it
 * never share a horizontal segment, which is what made busy merge points ambiguous.
 */
export function edgePath({ sx, sy, tx, ty, kind }: Pick<EdgeData, "sx" | "sy" | "tx" | "ty" | "kind">): string {
  if (sx === tx) return `M${sx} ${sy} V${ty}`;
  const rowsAvailable = Math.max(1, Math.round((ty - sy) / ROW_H));
  const lanesApart = Math.abs(tx - sx) / LANE_W;
  const span = Math.min(rowsAvailable, Math.max(1, Math.ceil(lanesApart / 2)), 4) * ROW_H;
  const k = span * 0.5;
  if (kind === "merge") {
    const y1 = sy + span;
    return `M${sx} ${sy} C${sx} ${sy + k} ${tx} ${y1 - k} ${tx} ${y1}${y1 < ty ? ` V${ty}` : ""}`;
  }
  const y0 = ty - span;
  return `M${sx} ${sy}${y0 > sy ? ` V${y0}` : ""} C${sx} ${y0 + k} ${tx} ${ty - k} ${tx} ${ty}`;
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
      {/* A ground-coloured underlay opens a small gap where lines cross, so crossings read as
          one line passing over another instead of a knot. */}
      <path d={d} fill="none" stroke="rgb(var(--ground))" strokeWidth={width + 3} strokeLinecap="round" />
      <path d={d} fill="none" stroke={data.color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}
