/**
 * Shared geometry for the commit graph, used by the server layout (graphBuilder.ts)
 * and the client renderer. Lanes sit on the left; the commit table sits right of the
 * last lane, so commit text can never overlap a node or an edge.
 *
 * These are design metrics of the renderer, not properties of any repository: the
 * number of lanes and rows always comes from the repository's real history.
 */
export const ROW_H = 34;
/**
 * Lane spacing of the server layout (x = lane * LANE_W). The renderer re-spaces lanes to the
 * width it actually has (see laneSpacing in components/lanes.ts), so this is the layout unit,
 * not the drawn distance: lane index is recovered with Math.round(x / LANE_W).
 */
export const LANE_W = 24;
/** Left padding before lane 0. */
export const LANE_PAD = 20;
