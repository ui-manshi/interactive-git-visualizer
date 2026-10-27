"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";

/** The one app bar used by every screen: fixed 48px, single row, one baseline. */
export function Toolbar({ children, label = "Application" }: { children: ReactNode; label?: string }) {
  return (
    <header
      role="banner"
      aria-label={label}
      className="flex-none h-12 flex items-center gap-2 px-3 bg-surface min-w-0"
    >
      {children}
    </header>
  );
}

/** Product identity. A small mark and a name; no banner. */
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2 flex-none rounded-md pr-1 hover:text-fg text-fg" aria-label="Git Visualizer home">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden>
        <path d="M5 3.5v11M5 11c0-3 8-1.5 8-6" stroke="rgb(98 199 178)" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="5" cy="3.5" r="1.9" fill="rgb(16 18 20)" stroke="rgb(98 199 178)" strokeWidth="1.5" />
        <circle cx="5" cy="14.5" r="1.9" fill="rgb(98 199 178)" />
        <circle cx="13" cy="5" r="1.9" fill="rgb(16 18 20)" stroke="rgb(98 199 178)" strokeWidth="1.5" />
      </svg>
      <span className={`text-sm font-semibold tracking-tight ${compact ? "hidden sm:inline" : ""}`}>Git Visualizer</span>
    </Link>
  );
}

export function ToolbarDivider() {
  return <span className="w-2 flex-none" aria-hidden />;
}

export const toolbarBtn = "h-8 px-2.5 rounded-md text-sm inline-flex items-center gap-1.5 whitespace-nowrap";

export function IconButton({
  label,
  onClick,
  children,
  pressed,
  className = "",
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  pressed?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`btn-ghost w-8 h-8 rounded-md inline-flex items-center justify-center flex-none ${className}`}
    >
      {children}
    </button>
  );
}

/** Overflow menu for secondary actions on narrow screens. Closes on outside click and Escape. */
export function MoreMenu({ children, label = "More actions" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative flex-none">
      <IconButton label={label} pressed={open} onClick={() => setOpen((o) => !o)}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
          <circle cx="3.5" cy="8" r="1.3" />
          <circle cx="8" cy="8" r="1.3" />
          <circle cx="12.5" cy="8" r="1.3" />
        </svg>
      </IconButton>
      {open && (
        <div
          role="menu"
          className="popover rounded-lg absolute right-0 top-full mt-1 z-50 min-w-[11rem] p-1 flex flex-col"
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export const menuItem =
  "w-full text-left h-8 px-2.5 rounded-md text-sm flex items-center gap-2 text-fg hover:bg-surface";
