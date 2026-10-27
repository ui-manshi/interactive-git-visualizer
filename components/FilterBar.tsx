"use client";

import { RefObject, useState } from "react";
import { EMPTY_FILTER, FilterState, isFilterActive } from "./graphFilter";

interface Props {
  value: FilterState;
  onChange: (next: FilterState) => void;
  authors: string[];
  branches: string[];
  matchCount: number | null; // null = no filter active
  total: number;
  onStep: (dir: 1 | -1) => void;
  inputRef: RefObject<HTMLInputElement>;
}

const field = "field rounded-md px-2 h-8 text-xs text-fg";

export default function FilterBar({
  value,
  onChange,
  authors,
  branches,
  matchCount,
  total,
  onStep,
  inputRef,
}: Props) {
  const set = (patch: Partial<FilterState>) => onChange({ ...value, ...patch });
  const active = isFilterActive(value);
  const extrasCount = [value.author, value.branch, value.from, value.to].filter(Boolean).length;
  const [open, setOpen] = useState(extrasCount > 0);

  return (
    <div role="search" className="flex-none bg-surface border-b border-line px-3 py-2 space-y-2">
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="search"
          value={value.q}
          onChange={(e) => set({ q: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onStep(e.shiftKey ? -1 : 1);
            }
          }}
          placeholder="Search commits (press /)"
          aria-label="Search commits"
          className={`${field} flex-1 min-w-0 max-w-sm`}
        />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`text-xs px-2.5 h-8 rounded-md border whitespace-nowrap transition-colors ${
            open || extrasCount > 0 ? "border-accent bg-accent/10 text-accent" : "btn text-fg"
          }`}
        >
          Filters{extrasCount > 0 ? ` (${extrasCount})` : ""}
        </button>

        {active && (
          <div className="flex items-center gap-1.5 ml-auto text-xs">
            <span className="text-muted whitespace-nowrap" aria-live="polite">
              {matchCount === 0 ? "No matches" : `${matchCount} of ${total}`}
            </span>
            <button
              type="button"
              onClick={() => onStep(-1)}
              disabled={!matchCount}
              className="w-7 h-7 rounded-md btn text-fg text-[10px]"
              aria-label="Previous match"
              title="Previous match (Shift+Enter)"
            >
              ▲
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              disabled={!matchCount}
              className="w-7 h-7 rounded-md btn text-fg text-[10px]"
              aria-label="Next match"
              title="Next match (Enter)"
            >
              ▼
            </button>
            <button
              type="button"
              onClick={() => onChange(EMPTY_FILTER)}
              className="px-2.5 h-7 rounded-md btn text-fg"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="flex flex-wrap items-center gap-2">
          {authors.length > 1 && (
            <select
              value={value.author}
              onChange={(e) => set({ author: e.target.value })}
              aria-label="Filter by author"
              className={`${field} max-w-[10rem]`}
            >
              <option value="">All authors</option>
              {authors.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          )}
          {branches.length > 1 && (
            <select
              value={value.branch}
              onChange={(e) => set({ branch: e.target.value })}
              aria-label="Show only commits reachable from branch"
              className={`${field} max-w-[10rem]`}
            >
              <option value="">All branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          )}
          <label className="flex items-center gap-1 text-xs text-muted">
            From
            <input
              type="date"
              value={value.from}
              max={value.to || undefined}
              onChange={(e) => set({ from: e.target.value })}
              className={field}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-muted">
            To
            <input
              type="date"
              value={value.to}
              min={value.from || undefined}
              onChange={(e) => set({ to: e.target.value })}
              className={field}
            />
          </label>
        </div>
      )}
    </div>
  );
}
