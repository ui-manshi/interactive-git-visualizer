import { LANE_PAD, LANE_W, ROW_H } from "@/lib/graphLayout";
import { BRANCH_PALETTE } from "./branchColors";

// Geometry shared with the server-side layout (lib/graphLayout.ts).
export { LANE_PAD, LANE_W, ROW_H };

/** Lane index of a laid-out commit (the server encodes it as x = lane * LANE_W). */
export function laneOf(x: number): number {
  return Math.max(0, Math.round(x / LANE_W));
}

/** Horizontal centre of a lane's dots and lines. */
export function laneX(lane: number): number {
  return LANE_PAD + lane * LANE_W;
}

/**
 * Colour for a row in the small before/after diagrams (simulator, merge/rebase previews),
 * where each row is one branch. The main repository graph colours by branch identity
 * instead (see branchColors.ts).
 */
export function laneColor(lane: number): string {
  return BRANCH_PALETTE[lane % BRANCH_PALETTE.length];
}
