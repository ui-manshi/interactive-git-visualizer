/**
 * Shared geometry for the commit graph, used by the server layout (graphBuilder.ts)
 * and the client renderer. Lanes sit on the left; the commit table sits right of the
 * last lane, so commit text can never overlap a node or an edge.
 *
 * These are design metrics of the renderer, not properties of any repository: the
 * number of lanes and rows always comes from the repository's real history.
 */
export const ROW_H = 36;
/** Lanes are wide enough that two neighbouring branches read as two lines, not one thick one. */
export const LANE_W = 28;
/** Left padding before lane 0. */
export const LANE_PAD = 22;
