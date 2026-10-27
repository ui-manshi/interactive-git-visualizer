"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RawGraphNode } from "./CommitGraph";

interface Props {
  nodes: RawGraphNode[];
  totalCommits: number;
  repoPath: string;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtShort(ts: number): string {
  const d = new Date(ts * 1000);
  return `${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function StatsView({ nodes, totalCommits, repoPath }: Props) {
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

  if (nodes.length === 0) return <p className="p-6 text-muted text-sm m-0">No commits to analyse.</p>;

  const loadedAll = nodes.length >= totalCommits;
  const topAuthor = stats.contributors[0];
  // Charts about time need commits on more than one day to say anything.
  const enoughDays = stats.days.size >= 2;
  const fmt = (ts: number) => new Date(ts * 1000).toLocaleDateString();

  const range = (first: number, last: number) => `${fmtShort(first)} – ${fmtShort(last)}`;

  return (
    <div className="absolute inset-0 overflow-y-auto">
      {/* No cards: sections are separated by space, and every list shares one row grid. */}
      <div className="max-w-[1100px] mx-auto px-6 py-8 space-y-10">
        {!loadedAll && (
          <p className="text-xs text-warn m-0">
            These numbers cover the newest {nodes.length.toLocaleString()} of {totalCommits.toLocaleString()} commits.
            Use &ldquo;Load more&rdquo; in the sidebar to include older history.
          </p>
        )}

        <header className="space-y-3">
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-5 m-0">
            <Metric label="Commits analysed" value={nodes.length.toLocaleString()} />
            <Metric label="Contributors" value={stats.contributors.length.toLocaleString()} />
            <Metric label="Active days" value={stats.days.size.toLocaleString()} />
            <Metric label="Top contributor" value={topAuthor.name} sub={`${topAuthor.commits.toLocaleString()} commits`} />
          </dl>
          <p className="text-xs text-muted m-0">
            History from {fmt(stats.first)} to {fmt(stats.last)}. Times use your local time zone.
          </p>
        </header>

        <div className="grid lg:grid-cols-2 gap-x-12 gap-y-10 items-start">
          <Section title="Contributors" note={stats.contributors.length > 10 ? `Top 10 of ${stats.contributors.length}` : undefined}>
            <ul className="m-0 p-0 list-none space-y-3.5">
              {stats.contributors.slice(0, 10).map((c) => {
                const pct = (c.commits / nodes.length) * 100;
                return (
                  <li key={c.name}>
                    <div className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate">
                        <span className="text-fg text-sm" title={c.name}>
                          {c.name}
                        </span>
                        <span className="text-faint ml-2 tabular-nums">{range(c.first, c.last)}</span>
                      </span>
                      <span className="text-muted flex-shrink-0 tabular-nums">
                        {c.commits.toLocaleString()} · {pct.toFixed(pct < 10 ? 1 : 0)}%
                      </span>
                    </div>
                    <div className="h-1 rounded-sm bg-raised mt-1.5 overflow-hidden">
                      <div className="h-full bg-muted" style={{ width: `${Math.max(pct, 1.5)}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>

          <Section title="Most changed files">
            {hotError && <p className="text-del text-xs m-0">{hotError}</p>}
            {!hot && !hotError && <p className="text-muted text-xs m-0">Scanning recent commits…</p>}
            {hot && hot.files.length === 0 && (
              <p className="text-muted text-xs m-0">No file changes were found in the commits scanned.</p>
            )}
            {hot && hot.files.length > 0 && (
              <>
                <ul className="m-0 p-0 list-none space-y-3.5">
                  {hot.files.map((f) => (
                    <li key={f.path}>
                      <div className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="font-mono text-sm text-fg [overflow-wrap:anywhere]" title={f.path}>
                          {f.path}
                        </span>
                        <span className="text-muted flex-shrink-0 tabular-nums">{f.commits}</span>
                      </div>
                      <div className="h-1 rounded-sm bg-raised mt-1.5 overflow-hidden">
                        <div className="h-full bg-muted" style={{ width: `${(f.commits / hot.files[0].commits) * 100}%` }} />
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-2xs text-faint mt-4 mb-0">
                  Counted over the newest {hot.scanned.toLocaleString()} non-merge commits: the number of commits that touched each file.
                </p>
              </>
            )}
          </Section>
        </div>

        <Section title="Activity calendar">
          {enoughDays ? (
            <Heatmap days={stats.days} end={stats.last} />
          ) : (
            <p className="text-muted text-xs m-0">
              All {nodes.length.toLocaleString()} loaded commits fall on a single day, so there is no activity pattern to show yet.
            </p>
          )}
        </Section>

        <div className="grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-12 gap-y-10 items-start">
          <Section title="Commits by weekday">
            {enoughDays ? (
              <Bars values={stats.weekday} labels={WEEKDAYS} names={WEEKDAYS} />
            ) : (
              <p className="text-muted text-xs m-0">Needs commits on at least two different days.</p>
            )}
          </Section>
          <Section title="Commits by hour of day">
            {enoughDays ? (
              <Bars
                values={stats.hour}
                labels={stats.hour.map((_, i) => (i % 3 === 0 ? String(i) : ""))}
                names={stats.hour.map((_, i) => `${String(i).padStart(2, "0")}:00`)}
              />
            ) : (
              <p className="text-muted text-xs m-0">Needs commits on at least two different days.</p>
            )}
          </Section>
        </div>

        <StoragePanel repoPath={repoPath} />
      </div>
    </div>
  );
}

function Metric({ label, value, sub, small }: { label: string; value: string; sub?: string; small?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="m-0 mt-1 min-w-0">
        <span className={`block truncate text-fg tabular-nums ${small ? "text-lg font-medium" : "text-xl font-semibold"}`} title={value}>
          {value}
        </span>
        {sub && <span className="block text-xs text-muted">{sub}</span>}
      </dd>
    </div>
  );
}

/** A titled group. Hierarchy is the heading and the space around it, not a box. */
function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="min-w-0">
      <div className="flex items-baseline justify-between gap-3 mb-4">
        <h3 className="text-sm font-semibold m-0">{title}</h3>
        {note && <span className="text-2xs text-faint">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** Vertical bars with a y-axis (0, half, max), light gridlines and one label per bar group. */
function Bars({ values, labels, names }: { values: number[]; labels: string[]; names: string[] }) {
  const max = Math.max(...values, 1);
  const H = 96;
  const ticks = [max, Math.round(max / 2), 0].filter((t, i, a) => a.indexOf(t) === i);
  return (
    <div className="flex gap-2" role="img" aria-label={`Bar chart. Highest value ${max} commits.`}>
      <div className="relative flex-none w-8 text-2xs text-faint tabular-nums" style={{ height: H }} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: H - (t / max) * H }}>
            {t}
          </span>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="relative flex items-end gap-[3px]" style={{ height: H }}>
          {ticks.map((t) => (
            <div key={t} className="absolute inset-x-0 border-t border-raised" style={{ top: H - (t / max) * H }} aria-hidden />
          ))}
          {values.map((v, i) => (
            <div key={i} className="relative flex-1 min-w-0 h-full flex items-end" title={`${names[i]}: ${v} commit${v === 1 ? "" : "s"}`}>
              <div className={`w-full rounded-t-[2px] ${v === max ? "bg-fg" : "bg-muted/70"}`} style={{ height: `${(v / max) * 100}%`, minHeight: v > 0 ? 2 : 0 }} />
            </div>
          ))}
        </div>
        <div className="flex gap-[3px] mt-1.5">
          {labels.map((l, i) => (
            <span key={i} className="flex-1 min-w-0 text-2xs text-faint text-center overflow-visible whitespace-nowrap">
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** GitHub-style calendar: 53 weeks ending at the latest commit's week, with month and weekday labels. */
function Heatmap({ days, end }: { days: Map<string, number>; end: number }) {
  const WEEKS = 53;
  const GAP = 3;
  const LEFT = 28;
  const TOP = 16;
  const [hover, setHover] = useState<string | null>(null);
  // The calendar grows with the space it has (10 to 18px squares) instead of sitting small in a wide section.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(0);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const read = () => setWrapW(el.clientWidth);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const CELL = wrapW > 0 ? Math.max(10, Math.min(18, Math.floor((wrapW - LEFT) / (WEEKS + 1)) - GAP)) : 11;
  const endDate = new Date(end * 1000);
  endDate.setHours(12, 0, 0, 0);
  const start = new Date(endDate.getTime() - (WEEKS * 7 - 1) * DAY_MS);
  start.setTime(start.getTime() - start.getDay() * DAY_MS); // back to a Sunday

  const max = Math.max(...Array.from(days.values()), 1);
  const level = (n: number) => (n === 0 ? 0 : Math.max(1, Math.ceil((n / max) * 4)));
  const opacity = [0, 0.22, 0.4, 0.62, 0.9];

  const cells: React.ReactNode[] = [];
  const monthStarts: { w: number; month: number }[] = [];
  let lastMonth = -1;
  for (let w = 0; w < WEEKS + 1; w++) {
    const first = new Date(start.getTime() + w * 7 * DAY_MS);
    if (first.getMonth() !== lastMonth && first.getTime() <= endDate.getTime()) {
      lastMonth = first.getMonth();
      monthStarts.push({ w, month: lastMonth });
    }
    for (let d = 0; d < 7; d++) {
      const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
      if (date.getTime() > endDate.getTime() + DAY_MS) continue;
      const n = days.get(dayKey(date)) ?? 0;
      const lv = level(n);
      const label = `${n} commit${n === 1 ? "" : "s"} on ${date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}`;
      cells.push(
        <rect
          key={`${w}-${d}`}
          x={LEFT + w * (CELL + GAP)}
          y={TOP + d * (CELL + GAP)}
          width={CELL}
          height={CELL}
          rx={2}
          fill={lv === 0 ? "rgb(var(--raised))" : "rgb(var(--fg))"}
          fillOpacity={lv === 0 ? 1 : opacity[lv]}
          onMouseEnter={() => setHover(label)}
          onMouseLeave={() => setHover(null)}
        >
          <title>{label}</title>
        </rect>
      );
    }
  }

  // A month label needs about three columns of room; drop one that would crowd the next.
  const monthLabels = monthStarts
    .filter((m, i) => i === monthStarts.length - 1 || monthStarts[i + 1].w - m.w >= 3)
    .map((m) => (
      <text key={`m${m.w}`} x={LEFT + m.w * (CELL + GAP)} y={10} fontSize={11} fill="rgb(var(--faint))">
        {MONTHS[m.month]}
      </text>
    ));

  const width = LEFT + (WEEKS + 1) * (CELL + GAP);
  return (
    <div ref={wrapRef}>
      <div className="overflow-x-auto">
        <svg width={width} height={TOP + 7 * (CELL + GAP)} role="img" aria-label="Commit activity calendar">
          {monthLabels}
          {[1, 3, 5].map((d) => (
            <text key={d} x={0} y={TOP + d * (CELL + GAP) + CELL - 1} fontSize={11} fill="rgb(var(--faint))">
              {WEEKDAYS[d]}
            </text>
          ))}
          {cells}
        </svg>
      </div>
      <div className="flex items-center justify-between gap-3 mt-2 text-2xs text-muted flex-wrap">
        <span aria-live="polite" className="min-h-4">
          {hover ?? `The year up to ${endDate.toLocaleDateString()}, one square per day.`}
        </span>
        <span className="inline-flex items-center gap-1" aria-hidden>
          Less
          {[0, 1, 2, 3, 4].map((l) => (
            <span
              key={l}
              className="w-[11px] h-[11px] rounded-[2px] inline-block"
              style={{ background: l === 0 ? "rgb(var(--raised))" : `rgb(var(--fg) / ${opacity[l]})` }}
            />
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

const ENTRY_COLORS: [keyof StorageData["packs"][number]["entries"], string, string][] = [
  ["commit", "rgb(var(--fg))", "commits"],
  ["tree", "rgb(var(--blue))", "trees"],
  ["blob", "rgb(var(--violet))", "files (blobs)"],
  ["tag", "rgb(var(--warn))", "tags"],
  ["ofs_delta", "rgb(var(--add))", "deltas"],
  ["ref_delta", "rgb(var(--add))", "deltas (by hash)"],
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
    <Section title="Object storage">
      {error && <p className="text-del text-xs m-0">{error}</p>}
      {!data && !error && <p className="text-muted text-xs m-0">Reading packfiles…</p>}
      {data && (
        <div className="space-y-6">
          <p className="text-xs text-muted m-0 leading-relaxed max-w-[70ch]">
            Git keeps objects either as individual zlib-compressed <em>loose</em> files, or bundled into <em>packfiles</em> where similar
            objects are stored as small <em>deltas</em> against each other. Clones and larger fetches arrive packed; small fetches and your own commits start out loose until <code>git gc</code> packs them.
          </p>
          <dl className="grid grid-cols-3 gap-x-8 m-0 max-w-xl">
            <MiniStat label="Packfiles" value={String(data.packs.length)} />
            <MiniStat label="Packed objects" value={data.packs.reduce((n, p) => n + p.objects, 0).toLocaleString()} />
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
                <div className="flex justify-between gap-3 text-xs">
                  <span className="font-mono text-fg truncate" title={p.file}>
                    {p.file}
                    {p.inAlternate && <span className="text-warn font-sans"> (shared)</span>}
                  </span>
                  <span className="text-muted flex-shrink-0">
                    {formatBytes(p.bytes)} · {p.objects.toLocaleString()} objects
                  </span>
                </div>
                <div className="flex h-2.5 rounded-sm overflow-hidden bg-raised" role="img" aria-label="Object types in this pack">
                  {ENTRY_COLORS.map(([k, color]) =>
                    p.entries[k] > 0 ? (
                      <div key={k} style={{ width: `${(p.entries[k] / p.objects) * 100}%`, background: color }} title={`${p.entries[k]} ${k}`} />
                    ) : null
                  )}
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-muted">
                  {ENTRY_COLORS.filter(([k]) => p.entries[k] > 0).map(([k, color, label]) => (
                    <span key={k} className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-sm" style={{ background: color }} />
                      {p.entries[k].toLocaleString()} {label}
                    </span>
                  ))}
                </div>
                <p className="text-2xs text-muted m-0">
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
            <p className="text-2xs text-muted m-0">
              This repository borrows objects from {data.alternates.length} other object director{data.alternates.length === 1 ? "y" : "ies"} (alternates).
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Metric label={label} value={value} sub={sub} small />
  );
}
