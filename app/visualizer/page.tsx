"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { HeadInfo, RawGraphEdge, RawGraphNode } from "@/components/CommitGraph";
import FileTreeExplorer from "@/components/FileTreeExplorer";
import DiffViewer, { DiffMode } from "@/components/DiffViewer";
import ObjectInspector from "@/components/ObjectInspector";
import FilterBar from "@/components/FilterBar";
import ShortcutsHelp from "@/components/ShortcutsHelp";
import { FilterState, computeMatches } from "@/components/graphFilter";
import { ancestorSet, computeBranchModel } from "@/components/branchColors";
import { Brand, IconButton, MoreMenu, Toolbar, ToolbarDivider, menuItem } from "@/components/shell";
import { Tip } from "@/components/Tooltip";
import { useToast } from "@/components/Toast";
import { useDiffSummary } from "@/lib/diffClient";
import { EMPTY_FILTER } from "@/components/graphFilter";
import { CopyButton, HashValue, MetaGrid, MetaRow } from "@/components/CommitDetails";
import { FlagIcon } from "@/components/CommitNode";
import { isReleaseTag } from "@/components/tags";
import TimeTravel from "@/components/TimeTravel";
import BranchComparePanel from "@/components/BranchComparePanel";
import StatsView from "@/components/StatsView";
import CherryPickPreview from "@/components/CherryPickPreview";

// React Flow touches window/measures DOM on mount; load it client-only.
const CommitGraph = dynamic(() => import("@/components/CommitGraph"), {
  ssr: false,
});

interface Ref {
  name: string;
  hash: string;
  /** Remote-tracking branch such as origin/main. */
  remote?: boolean;
}

interface TagInfo {
  name: string;
  hash: string;
  annotated: boolean;
  message: string | null;
}

interface GraphResponse {
  nodes: RawGraphNode[];
  edges: RawGraphEdge[];
  truncated: boolean;
  totalCommits: number;
}

// "Load more" steps up to the server-side cap, so big repositories load in stages.
const LOAD_STEPS = [500, 1000, 2000, 5000];

type View = "graph" | "stats";

interface ParsedCommitDetail {
  type: "commit";
  hash: string;
  size: number;
  tree: string;
  parents: string[];
  author: { name: string; email: string; timestamp: number; timezone: string };
  committer: { name: string; email: string; timestamp: number; timezone: string };
  message: string;
}

type Tab = "details" | "files" | "changes" | "raw";

const TABS: Tab[] = ["details", "files", "changes", "raw"];
const HASH_RE = /^[0-9a-f]{40}$/i;

/** Reads the shareable view state out of the page URL (see the sync effect below). */
function parseSharedState(sp: URLSearchParams) {
  const hash = (v: string | null) => (v && HASH_RE.test(v) ? v.toLowerCase() : null);
  const tab = sp.get("tab");
  const commit = hash(sp.get("commit"));
  return {
    commit,
    compare: commit ? hash(sp.get("compare")) : null,
    tab: TABS.includes(tab as Tab) ? (tab as Tab) : null,
    diff: (sp.get("diff") === "split" ? "split" : "unified") as DiffMode,
    view: (sp.get("view") === "stats" ? "stats" : "graph") as View,
    max: (() => {
      const n = parseInt(sp.get("max") ?? "", 10);
      return LOAD_STEPS.includes(n) ? n : LOAD_STEPS[0];
    })(),
    bc:
      sp.get("ba") && sp.get("bb")
        ? { base: sp.get("ba")!, head: sp.get("bb")! }
        : (null as { base: string; head: string } | null),
    filter: {
      q: sp.get("q") ?? "",
      author: sp.get("author") ?? "",
      branch: sp.get("branch") ?? "",
      from: sp.get("from") ?? "",
      to: sp.get("to") ?? "",
    } as FilterState,
  };
}

export default function VisualizerPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen text-muted p-8 text-body">Loading…</main>
      }
    >
      <VisualizerContent />
    </Suspense>
  );
}

const SIDEBAR_DEFAULT_W = 264;
const SIDEBAR_MIN_W = 220;
const SIDEBAR_MAX_W = 420;
const INSPECTOR_DEFAULT_W = 440;
const INSPECTOR_MIN_W = 320;
/** The graph always keeps at least this much room beside the sidebar and inspector. */
const GRAPH_MIN_W = 380;

function VisualizerContent() {
  const searchParams = useSearchParams();
  const repoPath = searchParams.get("path") || "";

  const [refs, setRefs] = useState<Ref[]>([]);
  const [tags, setTags] = useState<TagInfo[]>([]);
  const [head, setHead] = useState<HeadInfo | null>(null);
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [refsLoaded, setRefsLoaded] = useState(false);
  const [focusFile, setFocusFile] = useState<string | null>(null);
  const [sidebarW, setSidebarW] = useState(SIDEBAR_DEFAULT_W);
  const toast = useToast();
  const [graph, setGraph] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Selection. In normal mode only `selectedHash` is used. In compare mode,
  // `selectedHash` is the base commit (A) and `compareHash` the target (B).
  // The initial values come from the URL, so a shared link reopens the same view.
  const [initial] = useState(() => parseSharedState(new URLSearchParams(searchParams.toString())));
  const [selectedHash, setSelectedHash] = useState<string | null>(initial.commit);
  const [compareHash, setCompareHash] = useState<string | null>(initial.compare);
  const [compareMode, setCompareMode] = useState(!!initial.compare);
  const [tab, setTab] = useState<Tab>(initial.tab ?? (initial.compare ? "changes" : "details"));
  const [filesSide, setFilesSide] = useState<"A" | "B">("A");
  const [diffMode, setDiffMode] = useState<DiffMode>(initial.diff);
  // Layout: the sidebar collapses on desktop and becomes a drawer on narrow screens; the
  // inspector is a resizable column on desktop and a drawer on narrow screens.
  const rowRef = useRef<HTMLDivElement>(null);
  const [inspectorW, setInspectorW] = useState(initial.diff === "split" ? 720 : INSPECTOR_DEFAULT_W);
  const [sidebarDesktop, setSidebarDesktop] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [filter, setFilter] = useState<FilterState>(initial.filter);
  const [helpOpen, setHelpOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [cursorHash, setCursorHash] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [focus, setFocus] = useState<{ hash: string; n: number; keepZoom?: boolean } | null>(null);

  const [view, setView] = useState<View>(initial.view);
  const [maxCommits, setMaxCommits] = useState(initial.max);
  const [loadingMore, setLoadingMore] = useState(false);
  const graphLoaded = useRef(false);

  // Time travel: `replay` is an index into oldest-to-newest history, null = everything.
  const [replay, setReplay] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  // Things that dim the rest of the graph: file history and branch comparison.
  const [fileSet, setFileSet] = useState<{ file: string; hashes: Set<string> } | null>(null);
  const [branchSet, setBranchSet] = useState<Set<string> | null>(null);
  const [branchCmp, setBranchCmp] = useState<{ base: string; head: string } | null>(initial.bc);
  const [cmpDraft, setCmpDraft] = useState<{ base: string; head: string }>({ base: "", head: "" });

  const [selectedCommit, setSelectedCommit] = useState<ParsedCommitDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Branches and tags load once per repository.
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    fetch(`/api/repo/refs?path=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setRefs(d.refs);
        setTags(d.tags ?? []);
        setHead(d.head ?? null);
        setRemoteUrl(d.remoteUrl ?? null);
        setRefsLoaded(true);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  // The graph reloads when "Load more" raises the limit; the old graph stays on screen meanwhile.
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    if (graphLoaded.current) setLoadingMore(true);
    else setLoading(true);
    setError(null);

    fetch(`/api/repo/graph?path=${encodeURIComponent(repoPath)}&max=${maxCommits}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        graphLoaded.current = true;
        setGraph(d);
        setReplay(null);
        setPlaying(false);
      })
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : String(err)))
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath, maxCommits]);

  // Pre-fill the branch-compare pickers once branches are known.
  useEffect(() => {
    if (refs.length < 2 || cmpDraft.base) return;
    const base = refs.find((r) => r.name === "main" || r.name === "master") ?? refs[0];
    const head = refs.find((r) => r.name !== base.name) ?? refs[1];
    setCmpDraft({ base: base.name, head: head.name });
  }, [refs, cmpDraft.base]);

  useEffect(() => {
    if (!selectedHash) {
      setSelectedCommit(null);
      return;
    }
    setDetailError(null);
    setSelectedCommit(null);
    fetch(`/api/repo/object/${selectedHash}?path=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSelectedCommit(data);
      })
      .catch((err) => setDetailError(err instanceof Error ? err.message : String(err)));
  }, [selectedHash, repoPath]);

  function handleSelectCommit(hash: string) {
    setDrawerOpen(false);
    setFocusFile(null);
    if (!compareMode) {
      setSelectedHash(hash);
      setCompareHash(null);
      return;
    }
    // Compare mode: first click picks A, second picks B, a third starts over.
    if (!selectedHash || compareHash) {
      setSelectedHash(hash);
      setCompareHash(null);
    } else if (hash !== selectedHash) {
      setCompareHash(hash);
      setTab("changes");
    }
  }

  function toggleCompareMode() {
    setCompareMode((on) => !on);
    setCompareHash(null);
    setFilesSide("A");
    setTab("details");
  }

  function swapSides() {
    setSelectedHash(compareHash);
    setCompareHash(selectedHash);
  }

  function closePanel() {
    if (selectedHash) {
      setSelectedHash(null);
      setCompareHash(null);
    } else {
      setBranchCmp(null);
    }
  }

  const highlighted = useMemo(
    () => [selectedHash, compareHash].filter((h): h is string => !!h),
    [selectedHash, compareHash]
  );

  const comparing = compareMode && !!selectedHash && !!compareHash;
  const filesHash = comparing && filesSide === "B" ? compareHash! : selectedHash;

  // What the "Changes" tab diffs.
  let diffFrom: string | null = null;
  let diffTo: string | null = null;
  let diffLabel = "";
  if (comparing) {
    diffFrom = selectedHash;
    diffTo = compareHash;
    diffLabel = `${selectedHash!.slice(0, 7)} → ${compareHash!.slice(0, 7)}`;
  } else if (selectedHash && selectedCommit) {
    diffFrom = selectedCommit.parents[0] ?? null;
    diffTo = selectedHash;
    diffLabel = selectedCommit.parents.length === 0
      ? "root commit (all files are new)"
      : selectedCommit.parents.length > 1
      ? `merge commit — changes versus first parent ${selectedCommit.parents[0].slice(0, 7)}`
      : `changes versus parent ${selectedCommit.parents[0].slice(0, 7)}`;
  }

  const nodeCount = graph?.nodes.length ?? 0;

  // One real change summary feeds the inspector header, the Files tab markers and the Changes tab.
  const { summary: changeSummary, error: changeSummaryError } = useDiffSummary(repoPath, diffFrom, diffTo);
  const changesMap = useMemo(
    () => (changeSummary ? new Map(changeSummary.files.map((f) => [f.path, f.status] as const)) : null),
    [changeSummary]
  );
  // Branch comparison shows in the side panel whenever no single commit is selected.
  const cmpRefs = useMemo(() => {
    if (!branchCmp) return null;
    const base = refs.find((r) => r.name === branchCmp.base);
    const head = refs.find((r) => r.name === branchCmp.head);
    return base && head ? { base, head } : null;
  }, [branchCmp, refs]);
  const showBranchPanel = !!cmpRefs && !selectedHash;
  const panelOpen = !!selectedHash || showBranchPanel;
  const repoName = shortRepoName(repoPath);

  // ---- shareable link: mirror the view state into the URL ----
  useEffect(() => {
    if (!repoPath) return;
    const p = new URLSearchParams();
    p.set("path", repoPath);
    if (selectedHash) p.set("commit", selectedHash);
    if (selectedHash && compareMode && compareHash) p.set("compare", compareHash);
    if (selectedHash && tab !== (compareMode && compareHash ? "changes" : "details")) p.set("tab", tab);
    if (diffMode === "split") p.set("diff", "split");
    if (filter.q.trim()) p.set("q", filter.q.trim());
    if (filter.author) p.set("author", filter.author);
    if (filter.branch) p.set("branch", filter.branch);
    if (filter.from) p.set("from", filter.from);
    if (filter.to) p.set("to", filter.to);
    if (view === "stats") p.set("view", "stats");
    if (maxCommits !== LOAD_STEPS[0]) p.set("max", String(maxCommits));
    if (branchCmp) {
      p.set("ba", branchCmp.base);
      p.set("bb", branchCmp.head);
    }
    window.history.replaceState(null, "", `${window.location.pathname}?${p.toString()}`);
  }, [repoPath, selectedHash, compareHash, compareMode, tab, diffMode, filter, view, maxCommits, branchCmp]);

  // Pan to the commit named in a shared link once the graph is ready.
  useEffect(() => {
    if (graph && initial.commit && graph.nodes.some((n) => n.id === initial.commit)) {
      setFocus({ hash: initial.commit, n: Date.now() });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  // Remember panel widths between visits (best effort: storage can be unavailable).
  useEffect(() => {
    try {
      const sw = Number(localStorage.getItem("gv.sidebarW"));
      const iw = Number(localStorage.getItem("gv.inspectorW"));
      if (sw >= SIDEBAR_MIN_W && sw <= SIDEBAR_MAX_W) setSidebarW(sw);
      if (iw >= INSPECTOR_MIN_W && iw <= 1200 && initial.diff !== "split") setInspectorW(iw);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("gv.sidebarW", String(sidebarW));
      localStorage.setItem("gv.inspectorW", String(inspectorW));
    } catch {}
  }, [sidebarW, inspectorW]);

  function copyLink() {
    navigator.clipboard
      ?.writeText(window.location.href)
      .then(() => {
        setLinkCopied(true);
        toast("Link to this view copied");
        setTimeout(() => setLinkCopied(false), 1500);
      })
      .catch(() => toast("Could not copy the link. Your browser blocked clipboard access.", "error"));
  }

  function changeDiffMode(m: DiffMode) {
    setDiffMode(m);
    if (m === "split") setInspectorW((w) => clampInspectorW(Math.max(w, 720)));
  }

  // ---- search / filter ----
  const matched = useMemo(
    () => (graph ? computeMatches(graph.nodes, graph.edges, refs, filter) : null),
    [graph, refs, filter]
  );
  const authors = useMemo(
    () => Array.from(new Set(graph?.nodes.map((n) => n.data.author) ?? [])).sort(),
    [graph]
  );
  const branchNames = useMemo(() => refs.map((r) => r.name), [refs]);

  // Commits newest-first (one per row). Keyboard navigation and match stepping walk this order.
  const { ordered, posById, parentsOf, childrenOf } = useMemo(() => {
    const nodes = graph?.nodes ?? [];
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const pos = new Map(nodes.map((n) => [n.id, n.position] as const));
    const par = new Map<string, string[]>();
    const kids = new Map<string, string[]>();
    for (const e of graph?.edges ?? []) {
      (par.get(e.source) ?? par.set(e.source, []).get(e.source)!).push(e.target);
      (kids.get(e.target) ?? kids.set(e.target, []).get(e.target)!).push(e.source);
    }
    return { ordered: sorted.map((n) => n.id), posById: pos, parentsOf: par, childrenOf: kids };
  }, [graph]);

  // Colour and identity follow branches, not columns; the selected commit's ancestry is emphasised.
  const model = useMemo(() => computeBranchModel(graph?.nodes ?? [], graph?.edges ?? [], refs), [graph, refs]);
  const ancestry = useMemo(
    () => (selectedHash && !compareMode && posById.has(selectedHash) ? ancestorSet(selectedHash, parentsOf) : null),
    [selectedHash, compareMode, posById, parentsOf]
  );

  // Several features dim the rest of the graph; a commit stays lit only if it passes all of them.
  const dimSet = useMemo(() => {
    const sets = [matched, fileSet?.hashes ?? null, branchSet].filter((x): x is Set<string> => !!x);
    if (sets.length === 0) return null;
    const [first, ...rest] = sets;
    return new Set([...first].filter((h) => rest.every((x) => x.has(h))));
  }, [matched, fileSet, branchSet]);

  // ---- time travel ----
  const chrono = useMemo(() => [...ordered].reverse(), [ordered]); // oldest first
  const nodeById = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n] as const)), [graph]);
  const hiddenHashes = useMemo(
    () => (replay === null ? null : new Set(chrono.slice(replay + 1))),
    [replay, chrono]
  );
  const replayNode = replay !== null ? nodeById.get(chrono[replay]) : undefined;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setReplay((r) => {
        const next = (r ?? -1) + 1;
        if (next >= chrono.length - 1) {
          setPlaying(false);
          return null; // reached the end: back to the full, current history
        }
        return next;
      });
    }, 700 / speed);
    return () => clearInterval(id);
  }, [playing, speed, chrono.length]);

  // Follow the replay: keep the newest visible commit in view.
  useEffect(() => {
    if (replay !== null && chrono[replay]) setFocus({ hash: chrono[replay], n: Date.now(), keepZoom: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  function togglePlay() {
    if (playing) return setPlaying(false);
    if (replay === null) setReplay(0);
    setPlaying(true);
  }

  const navList = useMemo(
    () => ordered.filter((h) => (!dimSet || dimSet.has(h)) && !hiddenHashes?.has(h)),
    [ordered, dimSet, hiddenHashes]
  );

  /** Select (unless comparing) and pan to a commit. */
  function goTo(hash: string) {
    if (!compareMode) handleSelectCommit(hash);
    setCursorHash(hash);
    setFocus({ hash, n: Date.now() });
  }

  function stepMatch(dir: 1 | -1) {
    if (navList.length === 0) return;
    const current = !compareMode && selectedHash ? selectedHash : cursorHash;
    const i = current ? navList.indexOf(current) : -1;
    const next = i === -1 ? (dir === 1 ? 0 : navList.length - 1) : (i + dir + navList.length) % navList.length;
    goTo(navList[next]);
  }

  function moveBy(dir: 1 | -1) {
    if (navList.length === 0) return;
    const i = selectedHash ? navList.indexOf(selectedHash) : -1;
    if (i === -1) return goTo(navList[0]);
    const next = Math.min(navList.length - 1, Math.max(0, i + dir));
    if (next !== i) goTo(navList[next]);
  }

  function goParent() {
    if (!selectedHash) return;
    const parents =
      selectedCommit && selectedCommit.hash === selectedHash
        ? selectedCommit.parents
        : parentsOf.get(selectedHash) ?? [];
    const p = parents.find((h) => posById.has(h));
    if (p) goTo(p);
  }

  function goChild() {
    if (!selectedHash) return;
    const here = posById.get(selectedHash);
    const kids = (childrenOf.get(selectedHash) ?? []).filter((h) => posById.has(h));
    if (!here || kids.length === 0) return;
    // Prefer the child in the same lane.
    kids.sort((a, b) => Math.abs(posById.get(a)!.x - here.x) - Math.abs(posById.get(b)!.x - here.x));
    goTo(kids[0]);
  }

  // ---- keyboard navigation ----
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {});
  keyHandler.current = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    const typing =
      !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

    if (e.key === "Escape") {
      if (helpOpen) setHelpOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
      else if (typing) t!.blur();
      else if (panelOpen) closePanel();
      else if (replay !== null) {
        setReplay(null);
        setPlaying(false);
      }
      return;
    }
    if (typing || helpOpen || loading || error || !graph) return;

    switch (e.key) {
      case "/":
        e.preventDefault();
        searchRef.current?.focus();
        break;
      case "?":
        setHelpOpen(true);
        break;
      case "m":
        toggleCompareMode();
        break;
      case "g":
        setView((v) => (v === "graph" ? "stats" : "graph"));
        break;
      case "p":
        if (view === "graph") togglePlay();
        break;
      case "d":
        changeDiffMode(diffMode === "split" ? "unified" : "split");
        if (panelOpen) setTab("changes");
        break;
      case "1":
      case "2":
      case "3":
      case "4":
        if (panelOpen) setTab(TABS[Number(e.key) - 1]);
        break;
      case "ArrowDown":
      case "j":
        if (!compareMode) {
          e.preventDefault();
          moveBy(1);
        }
        break;
      case "ArrowUp":
      case "k":
        if (!compareMode) {
          e.preventDefault();
          moveBy(-1);
        }
        break;
      case "ArrowLeft":
      case "h":
        if (!compareMode) {
          e.preventDefault();
          goParent();
        }
        break;
      case "ArrowRight":
      case "l":
        if (!compareMode) {
          e.preventDefault();
          goChild();
        }
        break;
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tabLabels: Record<Tab, string> = {
    details: "Details",
    files: "Files",
    changes: "Changes",
    raw: "Raw",
  };

  // ---- layout helpers ----
  // The sidebar docks from 1280px; below that it is a drawer so the graph keeps its room.
  const sidebarDocks = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1280px)").matches;

  function clampInspectorW(w: number): number {
    const total = rowRef.current?.clientWidth ?? 1400;
    const used = sidebarDesktop && sidebarDocks() ? sidebarW : 0;
    return Math.round(Math.min(Math.max(w, INSPECTOR_MIN_W), Math.max(INSPECTOR_MIN_W, total - used - GRAPH_MIN_W)));
  }

  function toggleSidebar() {
    if (sidebarDocks()) setSidebarDesktop((v) => !v);
    else setDrawerOpen((v) => !v);
  }

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const right = rowRef.current?.getBoundingClientRect().right ?? window.innerWidth;
    const move = (ev: PointerEvent) => setInspectorW(clampInspectorW(right - ev.clientX));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startSidebarResize(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const left = rowRef.current?.getBoundingClientRect().left ?? 0;
    const move = (ev: PointerEvent) => setSidebarW(Math.round(Math.min(SIDEBAR_MAX_W, Math.max(SIDEBAR_MIN_W, ev.clientX - left))));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const inspectorExpanded = inspectorW >= 640;
  const ready = !loading && !error && !!graph && nodeCount > 0;
  const sidebarVisibleDesktop = sidebarDesktop;
  const subject = selectedCommit ? selectedCommit.message.split("\n")[0] : "";
  const bodyText = selectedCommit ? selectedCommit.message.trim() : "";
  const showFullMessage = !!selectedCommit && (bodyText.includes("\n") || subject.length > 72);
  const localRefs = refs.filter((r) => !r.remote);
  const remoteRefs = refs.filter((r) => r.remote);

  const secondaryActions = (
    <>
      <Link href="/simulator" className={menuItem}>
        Simulator
      </Link>
      <Link href="/" className={menuItem}>
        New repository
      </Link>
      {ready && (
        <>
          <button onClick={copyLink} className={menuItem}>
            {linkCopied ? "Link copied" : "Copy link"}
          </button>
          <button onClick={() => setHelpOpen(true)} className={menuItem}>
            Keyboard shortcuts
          </button>
        </>
      )}
    </>
  );

  return (
    <main className="h-dvh flex flex-col bg-ground text-fg overflow-hidden">
      <Toolbar compact>
        {/* Left: panel toggle, product, repository and checked-out branch */}
        <IconButton label="Toggle sidebar" onClick={toggleSidebar} pressed={sidebarDesktop || drawerOpen} tipAlign="start" className="!w-7 !h-7">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M6 3v10" />
          </svg>
        </IconButton>
        <Brand compact />
        <span className="hidden sm:block">
          <ToolbarDivider />
        </span>
        <div className="flex items-center gap-2 min-w-0" aria-live="polite">
          <span className="font-mono text-body font-medium text-fg truncate min-w-0" title={repoPath}>
            {loading ? "Reading repository…" : error ? "Could not open this repository" : repoName}
          </span>
          {ready && head && (
            <Tip label={head.branch ? `Checked out: ${head.branch}` : `HEAD is detached at ${head.hash}`} className="min-w-0 flex-none">
              <span className="hidden sm:inline-flex items-center gap-1.5 h-6 px-2 rounded-md bg-raised text-caption text-muted">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden className="flex-none">
                  <circle cx="4" cy="3.5" r="1.6" />
                  <circle cx="4" cy="12.5" r="1.6" />
                  <circle cx="12" cy="6" r="1.6" />
                  <path d="M4 5.1v5.8M12 7.6c0 2.4-3 2.2-6.4 3.6" />
                </svg>
                <span className="font-mono max-w-[12rem] truncate">{head.branch ?? `detached ${head.hash?.slice(0, 7)}`}</span>
              </span>
            </Tip>
          )}
        </div>

        <span className="flex-1" />

        {/* Right: Graph | Stats, Compare commits, Simulator, New repository, Copy link, ? */}
        {ready && (
          <>
            <div role="group" aria-label="View" className="segmented flex text-body rounded-md overflow-hidden flex-none">
              <Tip label="Commit graph" shortcut="g" align="start">
                <button onClick={() => setView("graph")} aria-pressed={view === "graph"} className={`h-7 px-3 rounded-md ${view === "graph" ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
                  Graph
                </button>
              </Tip>
              <Tip label="Repository statistics" shortcut="g">
                <button onClick={() => setView("stats")} aria-pressed={view === "stats"} className={`h-7 px-3 rounded-md ${view === "stats" ? "bg-raised text-fg" : "text-muted hover:text-fg"}`}>
                  Stats
                </button>
              </Tip>
            </div>
            <Tip label="Compare two commits" shortcut="m">
              <button
                onClick={toggleCompareMode}
                aria-pressed={compareMode}
                aria-label={compareMode ? "Exit compare mode" : "Compare commits"}
                className={`${compareMode ? "ring-1 ring-inset ring-accent text-accent bg-accent/10" : "btn"} h-7 px-2.5 rounded-md text-body inline-flex items-center gap-1.5 whitespace-nowrap flex-none`}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 2.5v8M4 10.5a2 2 0 1 0 0 3 2 2 0 0 0 0-3ZM12 13.5v-8M12 5.5a2 2 0 1 0 0-3 2 2 0 0 0 0 3Z" />
                </svg>
                <span className="hidden lg:inline">{compareMode ? "Exit compare" : "Compare commits"}</span>
              </button>
            </Tip>
          </>
        )}
        <div className="hidden xl:flex items-center gap-0.5 flex-none">
          <Link href="/simulator" className="btn-ghost h-7 px-2.5 rounded-md text-body inline-flex items-center">
            Simulator
          </Link>
          <Link href="/" className="btn-ghost h-7 px-2.5 rounded-md text-body inline-flex items-center">
            New repository
          </Link>
          {ready && (
            <>
              <Tip label="Copy a link to this exact view">
                <button onClick={copyLink} className="btn-ghost h-7 px-2.5 rounded-md text-body">
                  {linkCopied ? "Link copied" : "Copy link"}
                </button>
              </Tip>
              <IconButton label="Keyboard shortcuts" shortcut="?" onClick={() => setHelpOpen(true)} tipAlign="end" className="!w-7 !h-7">
                <span className="text-body font-semibold" aria-hidden>
                  ?
                </span>
              </IconButton>
            </>
          )}
        </div>
        <div className="xl:hidden flex-none">
          <MoreMenu>{secondaryActions}</MoreMenu>
        </div>
      </Toolbar>

      <div ref={rowRef} className="flex-1 min-h-0 flex relative">
        {drawerOpen && (
          <div
            className="xl:hidden fixed inset-x-0 top-10 bottom-0 z-30 bg-ground/70"
            aria-hidden
            onClick={() => setDrawerOpen(false)}
          />
        )}
        {panelOpen && (
          <div className="lg:hidden fixed inset-x-0 top-10 bottom-0 z-30 bg-ground/70" aria-hidden onClick={closePanel} />
        )}

        {/* ---------------- Sidebar ---------------- */}
        <nav
          id="repo-sidebar"
          aria-label="Repository"
          className={`relative flex-none flex-col bg-surface border-r border-line/70 min-h-0 w-[min(20rem,calc(100vw-3rem))] xl:w-[var(--sw)] ${
            sidebarVisibleDesktop ? "xl:flex" : "xl:hidden"
          } ${
            drawerOpen
              ? "max-xl:flex max-xl:fixed max-xl:left-0 max-xl:top-10 max-xl:bottom-0 max-xl:z-40"
              : "max-xl:hidden"
          }`}
          style={{ ["--sw" as string]: `${sidebarW}px` }}
        >
          <div className="flex-none px-4 pt-4 pb-3">
            <p className="text-title font-semibold m-0 break-words" title={repoPath}>
              {repoName}
            </p>
            {(remoteUrl || repoPath) && (
              <p className="font-mono text-caption text-faint m-0 mt-1 truncate" title={remoteUrl ?? repoPath}>
                {remoteUrl ?? repoPath}
              </p>
            )}
            {remoteUrl && repoPath && remoteUrl !== repoPath && (
              <p className="font-mono text-caption text-faint/80 m-0 truncate" title={repoPath}>
                {repoPath}
              </p>
            )}

            {/* Loaded versus total history. The bar and the numbers are the same two values. */}
            {!loading && !error && graph && (
              <div className="mt-3">
                <p className="font-mono text-caption text-muted m-0 tabular-nums flex justify-between gap-2">
                  <span>
                    {nodeCount.toLocaleString()} of {graph.totalCommits.toLocaleString()} commits loaded
                  </span>
                  <span>
                    {refs.length} branch{refs.length === 1 ? "" : "es"}
                  </span>
                </p>
                {graph.truncated && (
                  <div
                    role="progressbar"
                    aria-label="Share of history loaded"
                    aria-valuemin={0}
                    aria-valuemax={graph.totalCommits}
                    aria-valuenow={nodeCount}
                    className="h-1 rounded-full bg-raised mt-1.5 overflow-hidden"
                  >
                    <div className="h-full bg-accent/70 rounded-full transition-[width]" style={{ width: `${Math.min(100, (nodeCount / graph.totalCommits) * 100)}%` }} />
                  </div>
                )}
              </div>
            )}
            {graph?.truncated && (
              <div className="mt-2.5 text-caption">
                {maxCommits < LOAD_STEPS[LOAD_STEPS.length - 1] ? (
                  <button
                    onClick={() => setMaxCommits(LOAD_STEPS.find((x) => x > maxCommits) ?? maxCommits)}
                    disabled={loadingMore}
                    className="btn w-full text-body px-2.5 h-8 rounded-md inline-flex items-center justify-center gap-2"
                  >
                    {loadingMore && <span className="w-3 h-3 rounded-full border-2 border-line border-t-accent animate-spin motion-reduce:animate-none" aria-hidden />}
                    {loadingMore ? "Loading history…" : `Load more (up to ${(LOAD_STEPS.find((x) => x > maxCommits) ?? maxCommits).toLocaleString()})`}
                  </button>
                ) : (
                  <p className="text-muted m-0">That is the most this viewer loads at once.</p>
                )}
              </div>
            )}
          </div>

          {/* The only scrolling region: branches, remotes and tags. */}
          <div className="flex-1 min-h-0 overflow-y-auto py-1">
            {!refsLoaded && !error && (
              <div className="px-4 pt-2 space-y-2.5" aria-hidden>
                {[60, 78, 52, 70, 46].map((w, i) => (
                  <div key={i} className="h-3 rounded bg-raised animate-pulse motion-reduce:animate-none" style={{ width: `${w}%` }} />
                ))}
              </div>
            )}
            {refsLoaded && localRefs.length === 0 && remoteRefs.length === 0 && (
              <p className="px-4 py-3 text-body text-muted m-0">This repository has no branches yet.</p>
            )}
            <RefSection title="branches" count={localRefs.length}>
              {localRefs.map((ref) => (
                <RefRow
                  key={ref.name}
                  ref_={ref}
                  color={model.colorOfRef(ref)}
                  selected={selectedHash === ref.hash}
                  isHead={!!head?.branch && head.branch === ref.name}
                  onSelect={() => {
                    handleSelectCommit(ref.hash);
                    setFocus({ hash: ref.hash, n: Date.now() });
                  }}
                />
              ))}
            </RefSection>
            {remoteRefs.length > 0 && (
              <RefSection title="remotes" count={remoteRefs.length}>
                {remoteRefs.map((ref) => (
                  <RefRow
                    key={ref.name}
                    ref_={ref}
                    color={model.colorOfRef(ref)}
                    selected={selectedHash === ref.hash}
                    isHead={false}
                    onSelect={() => {
                      handleSelectCommit(ref.hash);
                      setFocus({ hash: ref.hash, n: Date.now() });
                    }}
                  />
                ))}
              </RefSection>
            )}
            {tags.length > 0 && (
              <RefSection title="tags" count={tags.length}>
                {tags.map((t) => {
                  const loaded = nodeById.has(t.hash);
                  return (
                    <button
                      key={t.name}
                      onClick={() => goTo(t.hash)}
                      disabled={!loaded}
                      title={
                        loaded
                          ? `${t.annotated ? "Annotated tag" : "Tag"} ${t.name}${t.message ? `: ${t.message}` : ""}`
                          : "This commit is older than the history loaded so far"
                      }
                      className="w-full text-left flex items-center gap-2 h-7 px-4 text-body hover:bg-raised disabled:opacity-40 disabled:hover:bg-transparent"
                    >
                      <span className={`flex-none ${isReleaseTag(t.name) ? "text-warn" : "text-faint"}`}>
                        <FlagIcon size={12} />
                      </span>
                      <span className="truncate flex-1 min-w-0">{t.name}</span>
                      <span className="font-mono text-caption text-faint flex-none">{t.hash.slice(0, 7)}</span>
                    </button>
                  );
                })}
              </RefSection>
            )}
          </div>

          {/* Fixed footer: comparison controls and legend never overlap the list above. */}
          <div className="flex-none pt-2">
            {refs.length >= 2 && (
              <details open className="group">
                <summary className="h-8 px-4 flex items-center gap-1.5 font-mono text-caption text-muted cursor-pointer select-none hover:text-fg list-none [&::-webkit-details-marker]:hidden">
                  <svg className="transition-transform group-open:rotate-90" width="10" height="10" viewBox="0 0 10 10" fill="currentColor" aria-hidden>
                    <path d="M3 1.5 7 5 3 8.5z" />
                  </svg>
                  Compare branches
                </summary>
                <div className="px-4 pb-3 space-y-1.5">
                  {(["base", "head"] as const).map((side) => (
                    <select
                      key={side}
                      value={cmpDraft[side]}
                      onChange={(e) => setCmpDraft((d) => ({ ...d, [side]: e.target.value }))}
                      aria-label={side === "base" ? "Base branch" : "Branch to compare"}
                      className="field w-full rounded-md px-2 h-8 text-body"
                    >
                      {refs.map((r) => (
                        <option key={r.name} value={r.name}>
                          {side === "base" ? "Base: " : "Compare: "}
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ))}
                  <button
                    disabled={!cmpDraft.base || cmpDraft.base === cmpDraft.head}
                    onClick={() => {
                      setCompareMode(false);
                      setSelectedHash(null);
                      setCompareHash(null);
                      setBranchCmp({ ...cmpDraft });
                    }}
                    className="btn w-full text-body h-8 rounded-md"
                  >
                    Compare
                  </button>
                </div>
              </details>
            )}
            <div className="px-4 pt-2 pb-4 font-mono text-caption text-faint space-y-2" aria-label="Legend">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-muted" aria-hidden /> commit
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full border-2 border-muted" aria-hidden /> merge
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans">
                <span className="px-1.5 rounded text-caption font-semibold bg-muted text-ground">checked out</span>
                <span className="px-1.5 rounded text-caption bg-muted/20 text-muted">local</span>
                <span className="px-1.5 rounded text-caption border border-dashed border-muted/60 text-muted">remote</span>
              </div>
              <p className="m-0 font-sans">Newest first. Colour follows the branch.</p>
            </div>
          </div>
          {/* Drag to resize; arrow keys resize too. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            aria-valuemin={SIDEBAR_MIN_W}
            aria-valuemax={SIDEBAR_MAX_W}
            aria-valuenow={sidebarW}
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onDoubleClick={() => setSidebarW(SIDEBAR_DEFAULT_W)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                setSidebarW((w) => Math.max(SIDEBAR_MIN_W, w - 16));
              } else if (e.key === "ArrowRight") {
                e.preventDefault();
                setSidebarW((w) => Math.min(SIDEBAR_MAX_W, w + 16));
              }
            }}
            className="hidden xl:block absolute -right-[3px] top-0 bottom-0 w-[5px] z-10 cursor-col-resize hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
          />
        </nav>

        {/* ---------------- Workspace ---------------- */}
        <section className="flex-1 min-w-0 min-h-0 flex flex-col relative">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div
                className="w-6 h-6 rounded-full border-2 border-line border-t-accent animate-spin motion-reduce:animate-none"
                aria-hidden
              />
              <p className="text-body text-fg m-0">Reading the commit history…</p>
              <p className="text-body text-muted max-w-sm m-0">
                A GitHub URL is cloned the first time you open it, so larger repositories take longer.
              </p>
            </div>
          )}

          {!loading && error && (
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="max-w-md w-full rounded-lg border border-del/40 bg-del/10 p-5" role="alert">
                <p className="text-body font-semibold text-del m-0">Could not open this repository</p>
                <p className="text-body text-fg/90 mt-2 mb-0 break-words">{error}</p>
                <p className="text-body text-muted mt-3 mb-0">
                  Check that the path is absolute and points to a folder with a .git directory, or that the
                  GitHub URL is public.
                </p>
                <Link href="/" className="btn-primary inline-flex items-center mt-4 text-body px-3 h-8 rounded-md">
                  Try another repository
                </Link>
              </div>
            </div>
          )}

          {!loading && !error && graph && nodeCount === 0 && (
            <div className="absolute inset-0 flex items-center justify-center p-8 text-center">
              <p className="text-muted text-body max-w-md m-0">
                No commits found. The repository may be empty, or an earlier clone may be incomplete — reload
                the page to try again.
              </p>
            </div>
          )}

          {ready && view === "stats" && (
            <div className="flex-1 min-h-0 relative">
              <StatsView nodes={graph!.nodes} totalCommits={graph!.totalCommits} repoPath={repoPath} branchCount={refs.length} />
            </div>
          )}

          {ready && (
            <div className={view === "stats" ? "hidden" : "flex flex-col flex-1 min-h-0"}>
              <FilterBar
                value={filter}
                onChange={setFilter}
                authors={authors}
                branches={branchNames}
                matchCount={matched ? matched.size : null}
                total={nodeCount}
                onStep={stepMatch}
                inputRef={searchRef}
              />
              {compareMode && !comparing && (
                <div className="flex-none flex items-center gap-2 px-3 min-h-8 py-1 text-body bg-accent/10 text-fg" role="status">
                  {selectedHash ? (
                    <>
                      Base is <span className="font-mono text-fg">{selectedHash.slice(0, 7)}</span>. Now click the commit to compare it with.
                    </>
                  ) : (
                    "Compare mode: click the first commit (the base)."
                  )}
                </div>
              )}
              {fileSet && (
                <div className="flex-none flex items-center gap-2 px-3 min-h-8 py-1 text-body bg-raised text-fg" role="status">
                  <span className="min-w-0 truncate">
                    Highlighting commits that changed <span className="font-mono text-fg">{fileSet.file}</span>
                  </span>
                  <button onClick={() => setFileSet(null)} className="btn-ghost h-6 px-2 rounded text-body flex-none">
                    Clear
                  </button>
                </div>
              )}
              {loadingMore && (
                <div className="flex-none px-3 min-h-8 flex items-center text-body text-muted bg-raised" role="status">
                  Loading more commits…
                </div>
              )}
              <div className="flex-1 min-h-0 relative">
                <CommitGraph
                  nodes={graph!.nodes}
                  edges={graph!.edges}
                  model={model}
                  refs={refs}
                  head={head}
                  highlightedHashes={highlighted}
                  compareMode={compareMode}
                  ancestry={ancestry}
                  onSelectCommit={handleSelectCommit}
                  focus={focus}
                  matchedHashes={dimSet}
                  hiddenHashes={hiddenHashes}
                />
                {matched && matched.size === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center p-6 pointer-events-none">
                    <div className="popover rounded-lg p-5 text-center max-w-xs pointer-events-auto" role="status">
                      <p className="text-body font-medium m-0">No commits match</p>
                      <p className="text-body text-muted mt-1 mb-3">Nothing in the loaded history fits the current search and filters.</p>
                      <button onClick={() => setFilter(EMPTY_FILTER)} className="btn px-3 h-8 rounded-md text-body">
                        Clear search and filters
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <TimeTravel
                total={chrono.length}
                value={replay}
                playing={playing}
                speed={speed}
                current={
                  replayNode
                    ? { hash: replayNode.id, message: replayNode.data.message, timestamp: replayNode.data.timestamp }
                    : null
                }
                onChange={(v) => {
                  setReplay(v);
                  if (v === null) setPlaying(false);
                }}
                onTogglePlay={togglePlay}
                onSpeed={setSpeed}
              />
            </div>
          )}
        </section>

        {/* ---------------- Inspector ---------------- */}
        {panelOpen && (
          <aside
            aria-label="Commit inspector"
            className="flex-none relative flex flex-col min-h-0 bg-surface border-l border-line/70 max-lg:fixed max-lg:right-0 max-lg:top-10 max-lg:bottom-0 max-lg:z-40 max-lg:!w-[min(34rem,100vw)] lg:max-w-[calc(100%-380px)] xl:max-w-[calc(100%-var(--sb)-380px)]"
            style={{
              width: inspectorW,
              minWidth: INSPECTOR_MIN_W,
              ["--sb" as string]: sidebarVisibleDesktop ? `${sidebarW}px` : "0px",
            }}
          >
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize inspector"
              aria-valuemin={INSPECTOR_MIN_W}
              aria-valuenow={inspectorW}
              tabIndex={0}
              onPointerDown={startResize}
              onDoubleClick={() => setInspectorW(clampInspectorW(INSPECTOR_DEFAULT_W))}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") {
                  e.preventDefault();
                  setInspectorW((w) => clampInspectorW(w + 24));
                } else if (e.key === "ArrowRight") {
                  e.preventDefault();
                  setInspectorW((w) => clampInspectorW(w - 24));
                }
              }}
              className="hidden lg:block absolute -left-[3px] top-0 bottom-0 w-[5px] z-10 cursor-col-resize hover:bg-accent/50 focus-visible:bg-accent focus-visible:outline-none"
              title="Drag to resize. Double-click to reset."
            />

            {showBranchPanel && cmpRefs ? (
              <BranchComparePanel
                repoPath={repoPath}
                base={cmpRefs.base}
                head={cmpRefs.head}
                onGoToCommit={goTo}
                onHighlight={setBranchSet}
                onSwap={() => setBranchCmp((c) => (c ? { base: c.head, head: c.base } : c))}
                onClose={() => {
                  setBranchCmp(null);
                  setBranchSet(null);
                }}
              />
            ) : (
              <>
                <div className="flex-none px-4 pt-3 pb-2 flex items-start justify-between gap-3">
                  {comparing ? (
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <CompareRow side="A" label="Base" hash={selectedHash!} subject={nodeById.get(selectedHash!)?.data.message} tone="accent" />
                      <CompareRow side="B" label="Compare" hash={compareHash!} subject={nodeById.get(compareHash!)?.data.message} tone="warn" />
                      <div className="flex items-center gap-3 pt-0.5">
                        <button onClick={swapSides} className="btn h-7 px-2.5 rounded-md text-body inline-flex items-center gap-1.5" aria-label="Swap base and compare commits">
                          <span aria-hidden>⇄</span> Swap
                        </button>
                        <ChangeSummaryLine summary={changeSummary} error={changeSummaryError} />
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0 flex-1">
                      <h2 className="text-title font-semibold m-0 break-words line-clamp-4" title={subject}>
                        {selectedCommit ? subject || "(no message)" : <span className="inline-block h-4 w-2/3 rounded bg-raised animate-pulse motion-reduce:animate-none align-middle" />}
                      </h2>
                      <div className="mt-1 flex items-center gap-1 text-body text-muted min-w-0 flex-wrap">
                        <span className="font-mono text-caption">{selectedHash!.slice(0, 7)}</span>
                        <CopyButton text={selectedHash!} label="Copy full hash" />
                        {selectedCommit && (
                          <span className="min-w-0 truncate">
                            {selectedCommit.author.name} · {timeAgo(selectedCommit.author.timestamp)}
                          </span>
                        )}
                      </div>
                      {selectedCommit && (
                        <div className="mt-1.5">
                          <ChangeSummaryLine summary={changeSummary} error={changeSummaryError} />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-0.5 flex-none -mr-1.5">
                    <IconButton
                      label={inspectorExpanded ? "Collapse inspector" : "Expand inspector"}
                      onClick={() => setInspectorW(clampInspectorW(inspectorExpanded ? INSPECTOR_DEFAULT_W : 780))}
                      className="max-lg:hidden"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        {inspectorExpanded ? <path d="m9 3.5 4.5 4.5L9 12.5M2.5 8h10M13.5 3v10" /> : <path d="M7 3.5 2.5 8 7 12.5M13.5 8h-10M2.5 3v10" />}
                      </svg>
                    </IconButton>
                    <IconButton label="Close panel (Esc)" onClick={closePanel}>
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
                        <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
                      </svg>
                    </IconButton>
                  </div>
                </div>

                <div role="tablist" aria-label="Inspector views" className="flex-none px-3 flex gap-1">
                  {TABS.map((t) => (
                    <button
                      key={t}
                      role="tab"
                      aria-selected={tab === t}
                      onClick={() => setTab(t)}
                      className={`px-2.5 h-9 text-body font-medium border-b-2 -mb-px transition-colors ${
                        tab === t ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"
                      }`}
                    >
                      {tabLabels[t]}
                    </button>
                  ))}
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                  {tab === "details" && (
                    <>
                      {detailError && <p className="text-del text-body m-0">{detailError}</p>}
                      {!selectedCommit && !detailError && <p className="text-muted text-body m-0">Loading…</p>}
                      {selectedCommit && (
                        <div className="space-y-5">
                          {showFullMessage && (
                            <pre className="inset whitespace-pre-wrap break-words font-sans text-body text-fg leading-relaxed rounded-lg p-3 m-0 max-h-72 overflow-y-auto">
                              {bodyText}
                            </pre>
                          )}

                          <MetaGrid>
                            <MetaRow label="Author">
                              {selectedCommit.author.name}{" "}
                              <span className="text-muted break-all">&lt;{selectedCommit.author.email}&gt;</span>
                            </MetaRow>
                            <MetaRow label="Date">
                              {new Date(selectedCommit.author.timestamp * 1000).toLocaleString()}{" "}
                              <span className="text-muted">({timeAgo(selectedCommit.author.timestamp)})</span>
                            </MetaRow>
                            <MetaRow label="Commit">
                              <HashValue value={selectedCommit.hash} />
                            </MetaRow>
                            <MetaRow label="Tree">
                              <HashValue value={selectedCommit.tree} copyLabel="Copy full tree hash" />
                              <button onClick={() => setTab("files")} className="text-body text-accent hover:underline mt-0.5">
                                Browse files at this commit
                              </button>
                            </MetaRow>
                            <MetaRow label={selectedCommit.parents.length > 1 ? "Parents" : "Parent"}>
                              {selectedCommit.parents.length === 0 ? (
                                <span className="text-muted">None — this is the root commit</span>
                              ) : (
                                <div className="space-y-1.5">
                                  {selectedCommit.parents.map((p) => (
                                    <div key={p} className="flex items-start gap-1.5 min-w-0">
                                      {!compareMode ? (
                                        <button
                                          onClick={() => {
                                            handleSelectCommit(p);
                                            setFocus({ hash: p, n: Date.now() });
                                          }}
                                          className="font-mono text-body leading-5 text-accent hover:underline flex-none"
                                          title={`Go to parent ${p}`}
                                        >
                                          {p.slice(0, 7)}
                                        </button>
                                      ) : (
                                        <span className="font-mono text-body leading-5 flex-none">{p.slice(0, 7)}</span>
                                      )}
                                      <span className="font-mono text-body leading-5 text-faint break-all min-w-0 select-all">{p}</span>
                                      <CopyButton text={p} label="Copy full parent hash" />
                                    </div>
                                  ))}
                                </div>
                              )}
                            </MetaRow>
                          </MetaGrid>

                          {!compareMode && selectedCommit.parents.length <= 1 && refs.length > 0 && (
                            <CherryPickPreview repoPath={repoPath} commitHash={selectedCommit.hash} refs={refs} />
                          )}
                        </div>
                      )}
                    </>
                  )}

                  {tab === "files" && filesHash && (
                    <div className="flex flex-col gap-3 h-full">
                      {comparing && (
                        <div className="flex gap-1 text-body flex-shrink-0">
                          {(["A", "B"] as const).map((side) => (
                            <button
                              key={side}
                              onClick={() => setFilesSide(side)}
                              aria-pressed={filesSide === side}
                              className={`px-2.5 h-7 rounded-md ${
                                filesSide === side ? "ring-1 ring-inset ring-accent text-fg bg-accent/10" : "btn text-muted hover:text-fg"
                              }`}
                            >
                              Files at {side}
                            </button>
                          ))}
                        </div>
                      )}
                      <FileTreeExplorer
                        repoPath={repoPath}
                        commitHash={filesHash}
                        onGoToCommit={goTo}
                        onFileHistory={(file, hashes) => setFileSet(file && hashes ? { file, hashes } : null)}
                        changes={!comparing || filesSide === "B" ? changesMap : null}
                        onViewChanges={(path) => {
                          setFocusFile(path);
                          setTab("changes");
                        }}
                      />
                    </div>
                  )}

                  {tab === "raw" && selectedHash && <ObjectInspector repoPath={repoPath} rootHash={selectedHash} />}

                  {tab === "changes" && (
                    <>
                      {diffTo ? (
                        <>
                          <p className="text-body text-muted mt-0 mb-3 break-words">{diffLabel}</p>
                          <DiffViewer
                            repoPath={repoPath}
                            from={diffFrom}
                            to={diffTo}
                            mode={diffMode}
                            onModeChange={changeDiffMode}
                            focusPath={focusFile}
                          />
                        </>
                      ) : (
                        <p className="text-muted text-body m-0">Loading…</p>
                      )}
                    </>
                  )}
                </div>
              </>
            )}
          </aside>
        )}
      </div>
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </main>
  );
}

function RefSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="pb-1">
      <h3 className="sticky top-0 z-10 bg-surface px-4 h-8 flex items-center justify-between font-mono text-caption text-faint m-0">
        <span>{title}</span>
        <span className="tabular-nums">{count}</span>
      </h3>
      <div>{children}</div>
    </section>
  );
}

/**
 * One branch in the sidebar. Checked-out = HEAD badge; selected = raised row with an accent bar;
 * remote-tracking = dashed marker and dimmed remote prefix.
 */
function RefRow({
  ref_,
  color,
  selected,
  isHead,
  onSelect,
}: {
  ref_: Ref;
  color: string;
  selected: boolean;
  isHead: boolean;
  onSelect: () => void;
}) {
  const slash = ref_.remote ? ref_.name.indexOf("/") : -1;
  const prefix = slash > 0 ? ref_.name.slice(0, slash + 1) : "";
  const rest = slash > 0 ? ref_.name.slice(slash + 1) : ref_.name;
  return (
    <button
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      title={`${ref_.name} @ ${ref_.hash}${isHead ? " (checked out)" : ""}`}
      className={`w-full text-left flex items-center gap-2 h-7 px-4 text-body hover:bg-raised ${
        selected ? "bg-raised shadow-[inset_2px_0_0_rgb(var(--accent))]" : ""
      }`}
    >
      <span
        aria-hidden
        className="flex-none w-2.5 h-2.5 rounded-full"
        style={ref_.remote ? { border: `1.5px dashed ${color}` } : { background: color }}
      />
      <span className={`truncate flex-1 min-w-0 ${isHead ? "font-semibold text-fg" : "text-fg/90"}`}>
        {prefix && <span className="text-faint">{prefix}</span>}
        {rest}
      </span>
      {isHead && (
        <span className="flex-none font-mono text-caption px-1 rounded bg-raised text-muted leading-4">HEAD</span>
      )}
      <span className="font-mono text-caption text-faint flex-none">{ref_.hash.slice(0, 7)}</span>
    </button>
  );
}

/** "https://github.com/user/repo.git" -> "user/repo"; "/a/b/my-repo/" -> "my-repo" */
function shortRepoName(path: string): string {
  if (!path) return "Repository";
  const cleaned = path.trim().replace(/[\\/]+$/, "").replace(/\.git$/, "");
  const isUrl = /^[a-z]+:\/\//i.test(cleaned);
  const parts = cleaned.split(/[\\/]/).filter(Boolean);
  if (isUrl && parts.length >= 2) return parts.slice(-2).join("/");
  return parts[parts.length - 1] || cleaned;
}

function timeAgo(unixSeconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  const units: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [secs, name] of units) {
    if (diff >= secs) {
      const n = Math.floor(diff / secs);
      return `${n} ${name}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** Files / additions / deletions from the real diff. Shows nothing it cannot back with data. */
function ChangeSummaryLine({
  summary,
  error,
}: {
  summary: { totalFiles: number; additions: number; deletions: number; statsLimited: boolean } | null;
  error: string | null;
}) {
  if (error) return <span className="text-caption text-faint">Change summary unavailable</span>;
  if (!summary) return <span className="inline-block h-3.5 w-40 rounded bg-raised animate-pulse motion-reduce:animate-none" aria-label="Loading change summary" />;
  return (
    <p className="m-0 font-mono text-caption tabular-nums flex items-center gap-3 flex-wrap" aria-label="Change summary">
      <span className="text-muted">
        {summary.totalFiles} file{summary.totalFiles === 1 ? "" : "s"} changed
      </span>
      <span className="text-add" aria-label={`${summary.additions} lines added`}>
        +{summary.additions}
      </span>
      <span className="text-del" aria-label={`${summary.deletions} lines deleted`}>
        −{summary.deletions}
      </span>
      {summary.statsLimited && <span className="text-faint">line counts partial</span>}
    </p>
  );
}

function CompareRow({ side, label, hash, subject, tone }: { side: "A" | "B"; label: string; hash: string; subject?: string; tone: "accent" | "warn" }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span
        className={`flex-none w-5 h-5 rounded text-caption font-bold flex items-center justify-center ${tone === "accent" ? "bg-accent text-ground" : "bg-warn text-ground"}`}
        aria-hidden
      >
        {side}
      </span>
      <div className="min-w-0 flex-1">
        <p className="m-0 text-caption text-faint">
          {label} ({side})
        </p>
        <p className="m-0 text-body min-w-0 truncate" title={subject}>
          <span className="font-mono text-caption text-muted mr-2">{hash.slice(0, 7)}</span>
          {subject?.split("\n")[0] || "—"}
        </p>
      </div>
    </div>
  );
}
