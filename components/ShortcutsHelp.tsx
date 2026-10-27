"use client";

import { useEffect, useRef } from "react";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["↓", "j"], label: "Select the next older commit" },
  { keys: ["↑", "k"], label: "Select the next newer commit" },
  { keys: ["←", "h"], label: "Go to the parent commit" },
  { keys: ["→", "l"], label: "Go to a child commit" },
  { keys: ["/"], label: "Search commits" },
  { keys: ["Enter"], label: "Next match (Shift+Enter: previous)" },
  { keys: ["1", "2", "3", "4"], label: "Details, Files, Changes, Raw tab" },
  { keys: ["d"], label: "Switch unified / side-by-side diff" },
  { keys: ["m"], label: "Toggle compare mode" },
  { keys: ["g"], label: "Switch between Graph and Stats" },
  { keys: ["p"], label: "Play / pause the history replay" },
  { keys: ["Esc"], label: "Close this panel, dialog or search box" },
  { keys: ["?"], label: "Show this help" },
];

export default function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) closeRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ground/70"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
        className="popover rounded-lg w-full max-w-md p-5"
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-lg">Keyboard shortcuts</h2>
          <button
            ref={closeRef}
            onClick={onClose}
            className="w-7 h-7 rounded text-muted hover:text-fg hover:bg-raised"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="m-0 p-0 list-none space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.label} className="flex items-center justify-between gap-4 text-sm">
              <span className="text-fg/90">{s.label}</span>
              <span className="flex gap-1 flex-shrink-0">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="font-mono text-xs min-w-[1.6rem] text-center px-1.5 py-0.5 rounded inset text-accent"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted mt-4">
          Arrow-key navigation is paused while compare mode is on.
        </p>
      </div>
    </div>
  );
}
