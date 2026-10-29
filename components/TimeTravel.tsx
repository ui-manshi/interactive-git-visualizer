"use client";

interface Props {
  /** Number of commits (oldest to newest). */
  total: number;
  /** Position in 0..total-1, or null when showing the full, current history. */
  value: number | null;
  playing: boolean;
  speed: number;
  current: { hash: string; message: string; timestamp: number } | null;
  onChange: (v: number | null) => void;
  onTogglePlay: () => void;
  onSpeed: (s: number) => void;
}

const SPEEDS = [1, 2, 4];

export default function TimeTravel({ total, value, playing, speed, current, onChange, onTogglePlay, onSpeed }: Props) {
  const active = value !== null;
  const shown = value ?? total - 1;

  return (
    <div
      className="flex-none bg-surface px-3 h-11 flex items-center gap-3 min-w-0"
      role="group"
      aria-label="Time travel"
    >
      <button
        onClick={onTogglePlay}
        className="btn-primary flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center"
        aria-label={playing ? "Pause replay" : active ? "Resume replay" : "Replay history"}
        title={playing ? "Pause" : active ? "Resume" : "Replay history from the first commit"}
      >
        {playing ? (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <rect x="2" y="1.5" width="3" height="9" rx="0.5" />
            <rect x="7" y="1.5" width="3" height="9" rx="0.5" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden>
            <path d="M3 1.5v9l7.5-4.5L3 1.5Z" />
          </svg>
        )}
      </button>

      <input
        type="range"
        min={0}
        max={total - 1}
        value={shown}
        onChange={(e) => {
          const v = Number(e.target.value);
          onChange(v >= total - 1 ? null : v);
        }}
        aria-label="Scrub through history, oldest to newest"
        className="flex-1 min-w-[6rem] accent-[rgb(var(--accent))]"
      />

      <div className="hidden sm:block min-w-0 w-60 text-body leading-tight">
        {active && current ? (
          <>
            <p className="m-0 text-fg truncate" title={current.message}>
              {current.message}
            </p>
            <p className="m-0 text-muted truncate">
              <span className="font-mono text-fg">{current.hash.slice(0, 7)}</span> ·{" "}
              {new Date(current.timestamp * 1000).toLocaleDateString()} · {shown + 1}/{total}
            </p>
          </>
        ) : (
          <p className="m-0 text-muted truncate">Replay: drag to rewind, or press play</p>
        )}
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {SPEEDS.map((s) => (
          <button
            key={s}
            onClick={() => onSpeed(s)}
            aria-pressed={speed === s}
            className={`text-caption px-1.5 h-6 rounded tabular-nums ${
              speed === s ? "ring-1 ring-inset ring-accent bg-accent/10 text-accent" : "btn text-muted hover:text-fg"
            }`}
          >
            {s}×
          </button>
        ))}
        {active && (
          <button
            onClick={() => onChange(null)}
            className="text-caption px-2 h-6 rounded btn text-fg ml-1"
          >
            Latest
          </button>
        )}
      </div>
    </div>
  );
}
