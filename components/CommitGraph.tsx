"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Edge, MiniMap, Node, Panel, ReactFlowInstance, useReactFlow, useStore } from "reactflow";
import "reactflow/dist/style.css";
import CommitNode, { COL, CommitNodeData, RefChip, RowData, refLabelWidth } from "./CommitNode";
import CommitEdge, { EdgeData } from "./CommitEdge";
import { BranchModel, RefInfo } from "./branchColors";
import { LANE_PAD, ROW_H, laneOf, laneSpacing, laneX } from "./lanes";

export type { CommitNodeData };

export interface RawGraphNode {
  id: string;
  position: { x: number; y: number };
  data: CommitNodeData;
}

export interface RawGraphEdge {
  id: string;
  source: string;
  target: string;
  /** 0 = first parent; 1+ = parents merged in. Absent on older responses (treated as 0). */
  parentIndex?: number;
}

export interface HeadInfo {
  branch: string | null;
  hash: string | null;
}

interface CommitGraphProps {
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
  model: BranchModel;
  refs: RefInfo[];
  head: HeadInfo | null;
  /** Commits to draw as selected (one normally; two in compare mode, base first). */
  highlightedHashes: string[];
  compareMode: boolean;
  /** Ancestry of the selected commit; everything else is toned down. Null = no emphasis. */
  ancestry: Set<string> | null;
  onSelectCommit: (hash: string) => void;
  /** Change `n` to scroll the view to `hash` (e.g. when a branch is picked in the sidebar). */
  focus?: { hash: string; n: number; keepZoom?: boolean } | null;
  /** Commits matching the active search/filter; null when no filter is active. */
  matchedHashes?: Set<string> | null;
  /** Commits not yet "reached" by the time-travel slider; they are not drawn at all. */
  hiddenHashes?: Set<string> | null;
}

const nodeTypes = { commit: CommitNode };
const edgeTypes = { commit: CommitEdge };

/** The commit table fills the available width, within these bounds (graph units). */
const LABEL_W_MIN = 420;
const LABEL_W_MAX = 1600;
const EDGE_PAD = 12;
/** Gap between the last lane and the first column of the commit table. */
const LANES_TO_TABLE = 28;
/** The refs column never takes more than this, or a third of the table, whichever is smaller. */
const REFS_MAX = 224;
/** Smallest message column worth showing an author column next to. */
const MESSAGE_MIN = 220;

const MAP_W = 132;
const MAP_H = 176;

interface MiniCtxValue {
  lane: Map<string, number>;
  laneW: number;
  color: Map<string, string>;
  labelX: number;
  /** Graph units per minimap pixel, so marks stay about a pixel thick however long the history is. */
  unit: number;
}
const MiniCtx = createContext<MiniCtxValue>({ lane: new Map(), laneW: 24, color: new Map(), labelX: 0, unit: 1 });

/** Minimap mark: a lane dash plus a faint stub where the commit text is. */
function MiniMark({ id, x, y }: { id: string; x: number; y: number }) {
  const { lane, laneW, color, labelX, unit } = useContext(MiniCtx);
  const u = Math.max(unit, 1);
  return (
    <g>
      <rect x={x + laneX(lane.get(id) ?? 0, laneW) - u} y={y + ROW_H / 2 - u * 0.6} width={2 * u} height={1.2 * u} fill={color.get(id) ?? "#888"} />
      <rect x={x + labelX} y={y + ROW_H / 2 - u * 0.4} width={u * 36} height={0.8 * u} fill="rgb(70 78 86)" />
    </g>
  );
}

export default function CommitGraph({
  nodes,
  edges,
  model,
  refs,
  head,
  highlightedHashes,
  compareMode,
  ancestry,
  onSelectCommit,
  focus,
  matchedHashes = null,
  hiddenHashes = null,
}: CommitGraphProps) {
  const [ready, setReady] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The commit under the pointer: its edges to parents and children are drawn at full strength.
  const [hover, setHover] = useState<string | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<ReactFlowInstance | null>(null);

  // Lane index of every commit, and how many lanes this history really uses.
  const { lanes, maxLane } = useMemo(() => {
    const lane = new Map<string, number>();
    let max = 0;
    for (const n of nodes) {
      const l = laneOf(n.position.x);
      lane.set(n.id, l);
      if (l > max) max = l;
    }
    return { lanes: lane, maxLane: max };
  }, [nodes]);

  // Track the workspace size so the table can fill it. Widths are rounded so a drag-resize
  // of the inspector re-lays-out in steps rather than on every pixel.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const read = () => setBox({ w: Math.round(el.clientWidth / 40) * 40, h: Math.round(el.clientHeight / 20) * 20 });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // The minimap only earns its place when the history is taller than the view (and the view is tall enough).
  const overflowsView = nodes.length * ROW_H > box.h - 2 * EDGE_PAD && box.h >= 560;
  const mapVisible = showMap && overflowsView && nodes.length < 2500;
  // Controls and minimap live in their own right-hand gutter, so they never sit on top of commit text.
  const gutter = mapVisible ? MAP_W + 28 : 52;

  // Branch topology gets the room it needs; the commit table starts right of the last lane.
  const laneW = laneSpacing(maxLane, box.w);
  const labelX = LANE_PAD + maxLane * laneW + LANES_TO_TABLE;
  const labelW = Math.min(LABEL_W_MAX, Math.max(LABEL_W_MIN, box.w - labelX - gutter - EDGE_PAD));

  // Table columns: hash | refs | message | author | date. The refs column is as wide as the widest
  // label set in the loaded history (so branch and tag labels line up in one column); the author
  // column appears only when the message keeps a usable width.
  const refsW = useMemo(() => {
    let need = 0;
    for (const n of nodes) {
      let w = 0;
      for (const b of n.data.branchNames) w += refLabelWidth(b);
      for (const t of n.data.tagNames ?? []) w += refLabelWidth(t, true);
      if (w > need) need = w;
    }
    if (need === 0) return 0;
    return Math.min(need, REFS_MAX, Math.floor(labelW * 0.34));
  }, [nodes, labelW]);
  const fixedW = COL.hash + COL.date + (refsW > 0 ? refsW + COL.gap : 0) + 3 * COL.gap + 20;
  const showAuthor = labelW - fixedW - COL.author - COL.gap >= MESSAGE_MIN;
  // In a narrow table (inspector open, small window) the date goes before the message gets cramped.
  const showDate = showAuthor || labelW - fixedW >= MESSAGE_MIN - 60;

  const refByName = useMemo(() => new Map(refs.map((r) => [r.name, r] as const)), [refs]);

  const flowNodes: Node<RowData>[] = useMemo(
    () =>
      nodes.map((n) => {
        const chips: RefChip[] = n.data.branchNames.map((name) => {
          const r = refByName.get(name);
          const remote = !!r?.remote;
          return {
            name,
            remote,
            head: !remote && !!head?.branch && head.branch === name,
            color: model.colorOfRef({ name, remote }),
          };
        });
        // Checked-out branch first, then local, then remote-tracking.
        chips.sort((a, b) => Number(b.head) - Number(a.head) || Number(a.remote) - Number(b.remote));
        const sideIdx = compareMode ? highlightedHashes.indexOf(n.id) : -1;
        return {
          id: n.id,
          position: { x: 0, y: n.position.y },
          type: "commit",
          draggable: false,
          selectable: false,
          focusable: false,
          selected: highlightedHashes.includes(n.id),
          // Dots sit above every edge, so the crossing underlay of an edge can never cut into a commit.
          zIndex: 10,
          hidden: !!hiddenHashes?.has(n.id),
          style: { width: labelX + labelW, height: ROW_H },
          data: {
            ...n.data,
            lane: lanes.get(n.id) ?? 0,
            laneW,
            color: model.colorOf(n.id),
            labelX,
            labelW,
            refsW,
            showAuthor,
            showDate,
            chips,
            detachedHead: !!head && !head.branch && head.hash === n.id,
            faded: !!ancestry && !ancestry.has(n.id),
            side: sideIdx === 0 ? "A" : sideIdx === 1 ? "B" : null,
            dimmed: matchedHashes ? !matchedHashes.has(n.id) : undefined,
          },
        };
      }),
    [nodes, refByName, head, model, labelX, labelW, laneW, refsW, showAuthor, showDate, lanes, highlightedHashes, compareMode, ancestry, matchedHashes, hiddenHashes]
  );

  const yById = useMemo(() => new Map(nodes.map((n) => [n.id, n.position.y] as const)), [nodes]);

  const flowEdges: Edge<EdgeData>[] = useMemo(() => {
    const out = edges.map((e) => {
      const kind: EdgeData["kind"] = (e.parentIndex ?? 0) === 0 ? "first" : "merge";
      // A merge edge carries the merged branch's colour; a first-parent edge, the child's.
      const color = kind === "merge" ? model.colorOf(e.target) : model.colorOf(e.source);
      const dimmed = !!matchedHashes && !(matchedHashes.has(e.source) && matchedHashes.has(e.target));
      const inAncestry = !ancestry || (ancestry.has(e.source) && ancestry.has(e.target));
      // Pointing at a commit: its own edges (to parents and children) stay bright, the rest recede.
      const touchesHover = !!hover && (e.source === hover || e.target === hover);
      const base = dimmed ? 0.12 : inAncestry ? 1 : 0.22;
      const opacity = hover && !touchesHover ? base * 0.4 : base;
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        type: "commit",
        focusable: false,
        hidden: !!(hiddenHashes && (hiddenHashes.has(e.source) || hiddenHashes.has(e.target))),
        zIndex: touchesHover ? 3 : ancestry && inAncestry && !dimmed ? 2 : 1,
        data: {
          sx: laneX(lanes.get(e.source) ?? 0, laneW),
          sy: (yById.get(e.source) ?? 0) + ROW_H / 2,
          tx: laneX(lanes.get(e.target) ?? 0, laneW),
          ty: (yById.get(e.target) ?? 0) + ROW_H / 2,
          kind,
          color,
          opacity,
          width: touchesHover || (ancestry && inAncestry) ? 2.5 : 2,
        },
      } as Edge<EdgeData>;
    });
    return out;
  }, [edges, model, lanes, laneW, yById, matchedHashes, ancestry, hiddenHashes, hover]);

  const mini = useMemo<MiniCtxValue>(() => {
    const color = new Map<string, string>();
    for (const n of nodes) color.set(n.id, model.colorOf(n.id));
    // The minimap fits the whole graph into MAP_W x MAP_H; its scale is set by the tighter axis.
    const unit = Math.max((labelX + labelW) / MAP_W, (nodes.length * ROW_H) / MAP_H);
    return { lane: lanes, laneW, color, labelX, unit };
  }, [nodes, model, lanes, laneW, labelX, labelW]);

  function handleInit(instance: ReactFlowInstance) {
    instRef.current = instance;
    instance.setViewport({ x: EDGE_PAD, y: EDGE_PAD, zoom: 1 });
    setReady(true);
  }

  // Scroll a commit into the vertical middle of the view; horizontal position is left alone.
  useEffect(() => {
    if (!focus || !ready || !instRef.current) return;
    const y = yById.get(focus.hash);
    if (y === undefined) return;
    const inst = instRef.current;
    const vp = inst.getViewport();
    const h = wrapperRef.current?.clientHeight ?? 600;
    const zoom = focus.keepZoom ? vp.zoom : Math.max(vp.zoom, 0.8);
    inst.setViewport({ x: vp.x, y: h / 2 - (y + ROW_H / 2) * zoom, zoom }, { duration: focus.keepZoom ? 150 : 200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, ready]);

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full"
      role="region"
      aria-label="Commit graph. Newest commits are at the top. Use the arrow keys or j and k to move between commits."
    >
      <MiniCtx.Provider value={mini}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodeClick={(_, node) => onSelectCommit(node.id)}
          onNodeMouseEnter={(_, node) => setHover(node.id)}
          onNodeMouseLeave={() => setHover(null)}
          onInit={handleInit}
          minZoom={0.05}
          maxZoom={2}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          // A long history reads like a list: the wheel scrolls it, Ctrl/⌘+wheel or pinch zooms.
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          // Only rows and edges inside the viewport are rendered, which keeps thousands of commits responsive.
          onlyRenderVisibleElements
          proOptions={{ hideAttribution: true }}
        >
          <Panel position="bottom-right" className="!m-3 flex flex-col items-end gap-2">
            {mapVisible && (
              <MiniMap
                pannable
                zoomable
                nodeComponent={MiniMark as never}
                maskColor="rgba(16,18,20,0.72)"
                maskStrokeColor="rgb(98,199,178)"
                maskStrokeWidth={1.5}
                style={{ width: MAP_W, height: MAP_H }}
              />
            )}
            <GraphControls
              labelX={labelX}
              showMap={showMap}
              canMap={overflowsView && nodes.length < 2500}
              onToggleMap={() => setShowMap((v) => !v)}
            />
          </Panel>
        </ReactFlow>
      </MiniCtx.Provider>
    </div>
  );
}

/** Zoom, fit and minimap controls in one group. */
function GraphControls({
  labelX,
  showMap,
  canMap,
  onToggleMap,
}: {
  labelX: number;
  showMap: boolean;
  canMap: boolean;
  onToggleMap: () => void;
}) {
  const rf = useReactFlow();
  const zoomPct = useStore((s) => Math.round(s.transform[2] * 100));
  const size = useStore((s) => ({ w: s.width, h: s.height }), (a, b) => a.w === b.w && a.h === b.h);

  const btn = "h-7 w-8 rounded-md flex items-center justify-center text-muted hover:text-fg hover:bg-raised";

  function fitWidth() {
    const vp = rf.getViewport();
    const z = Math.min(1.25, Math.max(0.1, (size.w - 2 * EDGE_PAD) / (labelX + LABEL_W_MIN)));
    // Keep whatever row is in the middle of the view in the middle.
    const worldY = (size.h / 2 - vp.y) / vp.zoom;
    rf.setViewport({ x: EDGE_PAD, y: size.h / 2 - worldY * z, zoom: z }, { duration: 150 });
  }

  return (
    <div role="toolbar" aria-label="Graph view" aria-orientation="vertical" className="panel rounded-lg p-1 flex flex-col items-center gap-0.5">
      <button className={btn} onClick={() => rf.zoomIn({ duration: 120 })} aria-label="Zoom in" title="Zoom in">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M3.5 8h9M8 3.5v9" />
        </svg>
      </button>
      <button
        className={`${btn} font-mono text-2xs tabular-nums`}
        onClick={() => rf.zoomTo(1, { duration: 120 })}
        aria-label={`Zoom ${zoomPct}%. Reset to 100%`}
        title="Reset to 100%"
      >
        {zoomPct}%
      </button>
      <button className={btn} onClick={() => rf.zoomOut({ duration: 120 })} aria-label="Zoom out" title="Zoom out">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
          <path d="M3.5 8h9" />
        </svg>
      </button>
      <span className="h-1" aria-hidden />
      <button className={btn} onClick={fitWidth} aria-label="Fit graph to width" title="Fit to width">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.5 3v10M13.5 3v10M5.5 8h5M7.2 6.3 5.5 8l1.7 1.7M8.8 6.3 10.5 8 8.8 9.7" />
        </svg>
      </button>
      <button
        className={btn}
        onClick={() => rf.fitView({ padding: 0.04, duration: 200, minZoom: 0.05 })}
        aria-label="Fit whole history on screen"
        title="Fit whole history"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
        </svg>
      </button>
      <button
        className={btn}
        onClick={() => rf.setViewport({ x: EDGE_PAD, y: EDGE_PAD, zoom: rf.getZoom() }, { duration: 150 })}
        aria-label="Scroll to newest commit"
        title="Newest commit"
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M3 3h10M8 13V6M5 8.5 8 5.5l3 3" />
        </svg>
      </button>
      {canMap && (
        <>
          <span className="h-1" aria-hidden />
          <button
            className={`${btn} ${showMap ? "text-fg" : ""}`}
            onClick={onToggleMap}
            aria-pressed={showMap}
            aria-label="Minimap"
            title={showMap ? "Hide minimap" : "Show minimap"}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
              <rect x="2.5" y="3" width="11" height="10" rx="1.5" />
              <rect x="7.5" y="7" width="4.5" height="4" rx="0.5" fill="currentColor" stroke="none" />
            </svg>
          </button>
        </>
      )}
    </div>
  );
}
