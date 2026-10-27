import { LANE_PAD, LANE_W, ROW_H } from "@/lib/graphLayout";
import { paletteAt } from "./branchColors";

// Geometry shared with the server-side layout (lib/graphLayout.ts).
export { LANE_PAD, LANE_W, ROW_H };

/** Lane index of a laid-out commit (the server encodes it as x = lane * LANE_W). */
export function laneOf(x: number): number {
  return Math.max(0, Math.round(x / LANE_W));
}

/** Horizontal centre of a lane's dots and lines, for a drawn lane spacing `w`. */
export function laneX(lane: number, w: number = LANE_W): number {
  return LANE_PAD + lane * w;
}

/**
 * Drawn distance between lanes. Branch topology gets real horizontal room: up to 32px per lane
 * while the history has few lanes, shrinking to 16px only when many branches run in parallel,
 * and never taking more than about a third of the view for the graph.
 */
export function laneSpacing(maxLane: number, viewWidth: number): number {
  const budget = Math.min(440, Math.max(180, viewWidth * 0.34));
  return Math.max(16, Math.min(32, Math.floor(budget / Math.max(1, maxLane + 1))));
}

/**
 * Colour for a row in the small before/after diagrams (simulator, merge/rebase previews),
 * where each row is one branch. The main repository graph colours by branch identity
 * instead (see branchColors.ts).
 */
export function laneColor(lane: number): string {
  return paletteAt(lane);
}
