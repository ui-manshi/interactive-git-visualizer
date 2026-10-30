"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RawGraphNode } from "./CommitGraph";

interface Props {
  nodes: RawGraphNode[];
  totalCommits: number;
  repoPath: string;
  /** Number of branches (local and remote-tracking) in the repository. */
  branchCount?: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

/** YYYY-MM-DD in the viewer's time zone, matching how commits are bucketed into days. */
function localIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function StatsView({ nodes, totalCommits, repoPath, branchCount }: Props) {
  const stats = useMemo(() => {
    const authors = new Map<string, { commits: number; first: number; last: number }>();
    const days = new Map<string, number>();
    const weekday = new Array(7).fill(0);
    const hour = new Array(24).fill(0);
    let first = Infinity;
    let last = -Infinity;

    for (const n of nodes) {
      const ts = n.data.timestamp;
      const d = new Date(ts * 1000);
      first = Math.min(first, ts);
      last = Math.max(last, ts);
      const a = authors.get(n.data.author) ?? { commits: 0, first: ts, last: ts };
      a.commits++;
      a.first = Math.min(a.first, ts);
      a.last = Math.max(a.last, ts);
      authors.set(n.data.author, a);
      days.set(dayKey(d), (days.get(dayKey(d)) ?? 0) + 1);
      weekday[d.getDay()]++;
      hour[d.getHours()]++;
    }

    const contributors = Array.from(authors, ([name, v]) => ({ name, ...v })).sort((a, b) => b.commits - a.commits);
    return { contributors, days, weekday, hour, first, last };
  }, [nodes]);

  const [hot, setHot] = useState<{ files: { path: string; commits: number }[]; scanned: number } | null>(null);
  const [hotError, setHotError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setHot(null);
    setHotError(null);
    fetch(`/api/repo/hotfiles?path=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setHot(d);
      })
      .catch((e) => !cancelled && setHotError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  if (nodes.length === 0) return <p className="p-6 text-muted text-body m-0">No commits to analyse.</p>;

  const loadedAll = nodes.length >= totalCommits;
  const topAuthor = stats.contributors[0];
  // Charts about time need commits on more than one day to say anything.
  const enoughDays = stats.days.size >= 2;
  const iso = (ts: number) => localIso(new Date(ts * 1000));
  const scope = loadedAll ? "entire history" : `loaded history (${nodes.length.toLocaleString()} of ${totalCommits.toLocaleString()})`;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      <div className="max-w-[1120px] mx-auto px-5 py-5 space-y-4">
        <header className="flex items-baseline justify-between gap-3 flex-wrap">
          <h2 className="text-title font-semibold m-0">Repository statistics</h2>
          <p className="font-mono text-caption text-muted m-0 tabular-nums">
            {iso(stats.first)} → {iso(stats.last)} · local time
          </p>
        </header>
        {!loadedAll && (
          <p className="text-body text-warn m-0 rounded-lg bg-warn/10 px-3 py-2" role="note">
            These figures cover the newest {nodes.length.toLocaleString()} of {totalCommits.toLocaleString()} commits. Use &ldquo;Load more&rdquo; in the sidebar to include older history.
          </p>
        )}

        <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 m-0">
          <Kpi label="Commits analysed" value={nodes.length.toLocaleString()} sub={loadedAll ? "entire history" : `of ${totalCommits.toLocaleString()} total`} />
          <Kpi label="Contributors" value={stats.contributors.length.toLocaleString()} sub={`in the ${loadedAll ? "history" : "loaded commits"}`} />
          <Kpi label="Active days" value={stats.days.size.toLocaleString()} sub="days with at least one commit" />
          {branchCount !== undefined && <Kpi label="Branches" value={branchCount.toLocaleString()} sub="local and remote-tracking" />}
        </dl>

        <div className="grid lg:grid-cols-2 gap-4 items-stretch">
          <Card
            title="Contributors"
            note={`${stats.contributors.length > 10 ? `top 10 of ${stats.contributors.length} · ` : ""}top: ${topAuthor.name} (${topAuthor.commits.toLocaleString()})`}
          >
            <ul className="m-0 p-0 list-none space-y-3.5">
              {stats.contributors.slice(0, 10).map((c) => {
                const pct = (c.commits / nodes.length) * 100;
                return (
                  <li key={c.name}>
                    <div className="flex justify-between gap-3 text-body">
                      <span className="text-fg min-w-0 [overflow-wrap:anywhere]">{c.name}</span>
                      <span className="font-mono text-caption text-muted flex-shrink-0 tabular-nums leading-5">
                        {c.commits.toLocaleString()} · {pct.toFixed(pct < 10 ? 1 : 0)}%
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-raised mt-1.5 overflow-hidden" role="img" aria-label={`${pct.toFixed(1)} percent of analysed commits`}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                    </div>
                    <p className="font-mono text-caption text-faint m-0 mt-1 tabular-nums">
                      {iso(c.first)} → {iso(c.last)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card title="Most changed files" note={hot ? `newest ${hot.scanned.toLocaleString()} non-merge commits` : undefined}>
            {hotError && <p className="text-del text-body m-0">{hotError}</p>}
            {!hot && !hotError && <SkeletonRows />}
            {hot && hot.files.length === 0 && <p className="text-muted text-body m-0">No file changes were found in the commits scanned.</p>}
            {hot && hot.files.length > 0 && (
              <>
                <ul className="m-0 p-0 list-none space-y-3.5">
                  {hot.files.map((f) => (
                    <li key={f.path}>
                      <div className="flex justify-between gap-3">
                        <span className="font-mono text-caption text-fg [overflow-wrap:anywhere] leading-5" title={f.path}>
                          {f.path}
                        </span>
                        <span className="font-mono text-caption text-muted flex-shrink-0 tabular-nums leading-5">{f.commits}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-raised mt-1.5 overflow-hidden">
                        <div className="h-full rounded-full bg-violet" style={{ width: `${(f.commits / hot.files[0].commits) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-caption text-faint mt-3 mb-0">Each bar counts the commits that touched that file.</p>
              </>
            )}
          </Card>
        </div>

        <Card title="Activity calendar" note={scope}>
          {enoughDays ? (
            <Heatmap days={stats.days} first={stats.first} end={stats.last} />
          ) : (
            <p className="text-muted text-body m-0">
              All {nodes.length.toLocaleString()} loaded commits fall on a single day, so there is no activity pattern to show yet.
            </p>
          )}
        </Card>

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 items-stretch">
          <Card title="Commits by weekday" note={scope}>
            {enoughDays ? (
              <Bars values={stats.weekday} labels={WEEKDAYS} names={WEEKDAYS} total={nodes.length} />
            ) : (
              <p className="text-muted text-body m-0">Needs commits on at least two different days.</p>
            )}
          </Card>
          <Card title="Commits by hour of day" note="local time">
            {enoughDays ? (
              <Bars
                values={stats.hour}
                labels={stats.hour.map((_, i) => (i % 3 === 0 ? String(i) : ""))}
                names={stats.hour.map((_, i) => `${String(i).padStart(2, "0")}:00–${String(i).padStart(2, "0")}:59`)}
                total={nodes.length}
              />
            ) : (
              <p className="text-muted text-body m-0">Needs commits on at least two different days.</p>
            )}
          </Card>
        </div>

        <StoragePanel repoPath={repoPath} />
      </div>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card px-4 py-3 min-w-0">
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="m-0 mt-1 min-w-0">
        <span className="block text-display tabular-nums text-fg" title={value}>
          {value}
        </span>
        {sub && <span className="block text-caption text-faint">{sub}</span>}
      </dd>
    </div>
  );
}

/** A dashboard card: title and an optional scope note on one line, content below. */
function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="card p-4 min-w-0 flex flex-col">
      <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
        <h3 className="text-body font-semibold m-0">{title}</h3>
        {note && <span className="text-caption text-faint">{note}</span>}
      </div>
      <div className="flex-1">{children}</div>
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-4" aria-label="Loading" aria-busy="true">
      {[80, 62, 48, 36].map((w) => (
        <div key={w} className="space-y-2">
          <div className="h-3 rounded bg-raised animate-pulse motion-reduce:animate-none" style={{ width: `${w}%` }} />
          <div className="h-1.5 rounded-full bg-raised animate-pulse motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

/** A floating readout that follows a hovered chart element. */
function ChartTip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      role="tooltip"
      className="absolute z-10 pointer-events-none -translate-x-1/2 -translate-y-full -mt-2 whitespace-nowrap popover rounded-md px-2.5 py-1.5 text-caption"
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}

/** Vertical bars with a y-axis (0, half, max) and light gridlines. Hover or keyboard focus shows the exact value. */
function Bars({ values, labels, names, total }: { values: number[]; labels: string[]; names: string[]; total: number }) {
  const max = Math.max(...values, 1);
  const H = 120;
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const ticks = [max, Math.round(max / 2), 0].filter((t, i, a) => a.indexOf(t) === i);

  function show(i: number, el: HTMLElement) {
    const w = wrap.current?.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (w) setTip({ i, x: r.left - w.left + r.width / 2, y: r.top - w.top });
  }

  return (
    <div ref={wrap} className="relative flex gap-2" role="group" aria-label={`Bar chart. Highest value ${max} commits.`}>
      <div className="relative flex-none w-8 font-mono text-caption text-faint tabular-nums" style={{ height: H }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: H - (t / max) * H }}>
            {t}
          </span>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="relative flex items-end gap-[3px]" style={{ height: H }} onMouseLeave={() => setTip(null)}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-line/40" style={{ top: H - (t / max) * H }} aria-hidden />
          ))}
          {values.map((v, i) => (
            <button
              key={i}
              type="button"
              className="relative flex-1 min-w-0 h-full flex items-end focus-visible:outline-offset-0"
              aria-label={`${names[i]}: ${v} commit${v === 1 ? "" : "s"}`}
              onMouseEnter={(e) => show(i, e.currentTarget.firstElementChild as HTMLElement)}
              onFocus={(e) => show(i, e.currentTarget.firstElementChild as HTMLElement)}
              onBlur={() => setTip(null)}
            >
              <span className={`block w-full rounded-t-[3px] transition-colors ${v === max ? "bg-accent" : "bg-accent/55 hover:bg-accent/80"}`} style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
            </button>
          ))}
        </div>
        <div className="flex gap-[3px] mt-1.5">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 min-w-0 font-mono text-caption text-faint text-center whitespace-nowrap">
              {l}
            </span>
          ))}
        </div>
      </div>
      {tip && (
        <ChartTip x={tip.x} y={tip.y}>
          <span className="text-fg font-medium">{names[tip.i]}</span>
          <span className="text-muted">
            {" "}
            · {values[tip.i].toLocaleString()} commit{values[tip.i] === 1 ? "" : "s"} ({((values[tip.i] / total) * 100).toFixed(1)}%)
          </span>
        </ChartTip>
      )}
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * GitHub-style calendar: 53 weeks ending at the latest commit's week. Three kinds of square are
 * kept apart: a day with commits (filled), a quiet day inside the loaded history (empty), and a
 * day outside the loaded history (dashed outline), where "no commits" would be a guess.
 */
function Heatmap({ days, first, end }: { days: Map<string, number>; first: number; end: number }) {
  const WEEKS = 53;
  const CELL = 12;
  const GAP = 3;
  const LEFT = 30;
  const TOP = 18;
  const [tip, setTip] = useState<{ x: number; y: number; text: string; sub: string } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const endDate = new Date(end * 1000);
  endDate.setHours(12, 0, 0, 0);
  const firstDate = new Date(first * 1000);
  firstDate.setHours(0, 0, 0, 0);
  const start = new Date(endDate.getTime() - (WEEKS * 7 - 1) * DAY_MS);
  start.setTime(start.getTime() - start.getDay() * DAY_MS); // back to a Sunday

  let max = 1;
  let busiest: { key: string; n: number } | null = null;
  days.forEach((n, key) => {
    if (n > max) max = n;
    if (!busiest || n > busiest.n) busiest = { key, n };
  });
  const level = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)));
  const opacity = [0, 0.28, 0.5, 0.75, 1];

  const cells: React.ReactNode[] = [];
  const monthStarts: { w: number; month: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS + 1; w++) {
    const wk = new Date(start.getTime() + w * 7 * DAY_MS);
    if (wk.getMonth() !== lastMonth && wk.getTime() <= endDate.getTime()) {
      lastMonth = wk.getMonth();
      monthStarts.push({ w, month: lastMonth });
    }
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
      if (date.getTime() > endDate.getTime() + DAY_MS) continue;
      const n = days.get(dayKey(date)) ?? 0;
      const outside = date.getTime() < firstDate.getTime() || date.getTime() > endDate.getTime() + DAY_MS / 2;
      const lv = level(n);
      const when = date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" });
      const text = outside ? "Outside the loaded history" : n === 0 ? "No commits" : `${n} commit${n === 1 ? "" : "s"}`;
      const x = LEFT + w * (CELL + GAP);
      const y = TOP + d * (CELL + GAP);
      cells.push(
        <rect
          key={`${w}-${d}`}
          data-date={outside ? undefined : dayKey(date)}
          data-count={outside ? undefined : n}
          x={outside ? x + 0.5 : x}
          y={outside ? y + 0.5 : y}
          width={outside ? CELL - 1 : CELL}
          height={outside ? CELL - 1 : CELL}
          rx={2}
          fill={outside ? "none" : lv === 0 ? "rgb(var(--raised))" : "rgb(var(--accent))"}
          fillOpacity={lv === 0 ? 1 : opacity[lv]}
          stroke={outside ? "rgb(var(--line))" : "none"}
          strokeDasharray={outside ? "2 2" : undefined}
          onMouseEnter={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const c = wrap.current?.getBoundingClientRect();
            if (c) setTip({ x: r.left - c.left + r.width / 2, y: r.top - c.top, text, sub: when });
          }}
          onMouseLeave={() => setTip(null)}
        />
      );
    }
  }

  // A label needs about three columns of room; drop one that would crowd the next.
  const monthLabels = monthStarts
    .filter((m, i) => i === monthStarts.length - 1 || monthStarts[i + 1].w - m.w >= 3)
    .map((m) => (
      <text key={`m${m.w}`} x={LEFT + m.w * (CELL + GAP)} y={11} fontSize={11} fill="rgb(var(--faint))">
        {MONTHS[m.month]}
      </text>
    ));

  const width = LEFT + (WEEKS + 1) * (CELL + GAP);
  const b = busiest as { key: string; n: number } | null;
  return (
    <div ref={wrap} className="relative">
      <div className="overflow-x-auto pb-1">
        <svg
          width={width}
          height={TOP + 7 * (CELL + GAP)}
          role="img"
          aria-label={`Commit activity calendar, ${days.size} active days${b ? `; busiest day ${b.key} with ${b.n} commits` : ""}`}
        >
          {monthLabels}
          {[1, 3, 5].map((d) => (
            <text key={d} x={0} y={TOP + d * (CELL + GAP) + CELL - 1} fontSize={11} fill="rgb(var(--faint))">
              {WEEKDAYS[d]}
            </text>
          ))}
          {cells}
        </svg>
      </div>
      {tip && (
        <ChartTip x={tip.x} y={tip.y}>
          <span className="text-fg font-medium">{tip.text}</span>
          <span className="text-muted"> · {tip.sub}</span>
        </ChartTip>
      )}
      <div className="flex items-center justify-between gap-4 mt-2 text-caption text-muted flex-wrap">
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          <span className="w-3 h-3 rounded-[2px] border border-dashed border-line inline-block" /> outside loaded history
        </span>
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span key={l} className="w-3 h-3 rounded-[2px] inline-block" style={{ background: l === 0 ? "rgb(var(--raised))" : `rgb(var(--accent) / ${opacity[l]})` }} />
          ))}
          More
        </span>
      </div>
    </div>
  );
}

interface StorageData {
  packs: {
    file: string;
    bytes: number;
    objects: number;
    entries: Record<"commit" | "tree" | "blob" | "tag" | "ofs_delta" | "ref_delta", number>;
    maxDeltaDepth: number | null;
    inAlternate: boolean;
  }[];
  loose: { count: number; bytes: number; truncated: boolean };
  alternates: string[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// Object kinds are categories, not Git relationships, so they use one neutral ramp (and direct labels).
const ENTRY_COLORS: [keyof StorageData["packs"][number]["entries"], string, string][] = [
  ["commit", "rgb(var(--fg))", "commits"],
  ["tree", "rgb(var(--fg) / 0.7)", "trees"],
  ["blob", "rgb(var(--fg) / 0.48)", "files (blobs)"],
  ["tag", "rgb(var(--fg) / 0.32)", "tags"],
  ["ofs_delta", "rgb(var(--fg) / 0.2)", "deltas"],
  ["ref_delta", "rgb(var(--fg) / 0.12)", "deltas (by hash)"],
];

function StoragePanel({ repoPath }: { repoPath: string }) {
  const [data, setData] = useState<StorageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetch(`/api/repo/storage?path=${encodeURIComponent(repoPath)}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  return (
    <Card title="Object storage" note="how Git keeps the history on disk">
      {error && <p className="text-del text-body m-0">{error}</p>}
      {!data && !error && <p className="text-muted text-body m-0">Reading packfiles…</p>}
      {data && (
        <div className="space-y-4">
          <p className="text-body text-muted m-0 leading-relaxed max-w-[75ch]">
            Git keeps objects either as individual zlib-compressed <em>loose</em> files, or bundled into <em>packfiles</em> where similar
            objects are stored as small <em>deltas</em> against each other. Clones and larger fetches arrive packed; small fetches and your own commits start out loose until <code>git gc</code> packs them.
          </p>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-3 m-0">
            <MiniStat label="Packfiles" value={String(data.packs.length)} />
            <MiniStat
              label="Packed objects"
              value={data.packs.reduce((n, p) => n + p.objects, 0).toLocaleString()}
              sub={formatBytes(data.packs.reduce((n, p) => n + p.bytes, 0))}
            />
            <MiniStat
              label="Loose objects"
              value={`${data.loose.count.toLocaleString()}${data.loose.truncated ? "+" : ""}`}
              sub={formatBytes(data.loose.bytes)}
            />
          </dl>

          {data.packs.map((p) => {
            const deltas = p.entries.ofs_delta + p.entries.ref_delta;
            return (
              <div key={p.file} className="space-y-2">
                <div className="flex justify-between gap-3 text-body">
                  <span className="font-mono text-caption text-fg truncate" title={p.file}>
                    {p.file}
                    {p.inAlternate && <span className="text-warn font-sans"> (shared)</span>}
                  </span>
                  <span className="font-mono text-caption text-muted flex-shrink-0">
                    {formatBytes(p.bytes)} · {p.objects.toLocaleString()} objects
                  </span>
                </div>
                <div className="flex h-2 gap-px overflow-hidden bg-raised" role="img" aria-label="Object types in this pack">
                  {ENTRY_COLORS.map(([k, color]) =>
                    p.entries[k] > 0 ? (
                      <div key={k} style={{ width: `${(p.entries[k] / p.objects) * 100}%`, background: color }} title={`${p.entries[k]} ${k}`} />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-muted">
                  {ENTRY_COLORS.filter(([k]) => p.entries[k] > 0).map(([k, color, label]) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
                      {p.entries[k].toLocaleString()} {label}
                    </span>
                  ))}
                </div>
                <p className="text-caption text-muted m-0">
                  {deltas > 0
                    ? `${Math.round((deltas / p.objects) * 100)}% of entries are deltas${
                        p.maxDeltaDepth !== null ? `; the longest chain is ${p.maxDeltaDepth} deep` : ""
                      }.`
                    : "No delta compression in this pack."}
                </p>
              </div>
            );
          })}
          {data.alternates.length > 0 && (
            <p className="text-caption text-muted m-0">
              This repository borrows objects from {data.alternates.length} other object director{data.alternates.length === 1 ? "y" : "ies"} (alternates).
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="m-0 mt-0.5">
        <span className="text-title text-fg tabular-nums">{value}</span>
        {sub && <span className="block font-mono text-caption text-faint">{sub}</span>}
      </dd>
    </div>
  );
}
