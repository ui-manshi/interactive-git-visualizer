"use client";

import Link from "next/link";
import { ReactNode, useEffect, useRef, useState } from "react";
import { Tip } from "./Tooltip";

/** The one app bar used by every screen: sticky, fixed 48px, single row, one baseline. */
export function Toolbar({ children, label = "Application", compact = false }: { children: ReactNode; label?: string; compact?: boolean }) {
  return (
    <header
      role="banner"
      aria-label={label}
      className={`sticky top-0 z-40 flex-none ${compact ? "h-10 bg-[rgb(23_26_29)]" : "h-12 bg-surface"} flex items-center gap-2 px-3 border-b border-line/70 min-w-0 overflow-x-clip`}
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
        <path d="M5 3.5v11M5 11c0-3 8-1.5 8-6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <circle cx="5" cy="3.5" r="1.9" fill="rgb(var(--surface))" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="5" cy="14.5" r="1.9" fill="currentColor" />
        <circle cx="13" cy="5" r="1.9" fill="rgb(var(--surface))" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <span className={`text-body font-semibold tracking-tight ${compact ? "hidden sm:inline" : ""}`}>Git Visualizer</span>
    </Link>
  );
}

export function ToolbarDivider() {
  return <span className="block w-px h-5 bg-line flex-none mx-1" aria-hidden />;
}

export const toolbarBtn = "h-8 px-2.5 rounded-md text-body inline-flex items-center gap-1.5 whitespace-nowrap";

/**
 * A primary navigation item. The active item shows a 2px accent bar on the toolbar's bottom
 * edge and brighter text; it also sets aria-current so the state is not colour-only.
 */
export function NavTab({
  label,
  active,
  href,
  onClick,
  tip,
  shortcut,
}: {
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  tip?: string;
  shortcut?: string;
}) {
  const cls = `relative h-12 px-3 inline-flex items-center text-body whitespace-nowrap transition-colors ${
    active ? "text-fg font-medium" : "text-muted hover:text-fg"
  } after:absolute after:left-2 after:right-2 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors ${
    active ? "after:bg-accent" : "after:bg-transparent"
  }`;
  const inner = href ? (
    <Link href={href} className={cls} aria-current={active ? "page" : undefined}>
      {label}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls} aria-current={active ? "page" : undefined}>
      {label}
    </button>
  );
  return tip ? (
    <Tip label={tip} shortcut={shortcut}>
      {inner}
    </Tip>
  ) : (
    inner
  );
}

export function IconButton({
  label,
  onClick,
  children,
  pressed,
  className = "",
  shortcut,
  tipSide = "bottom",
  tipAlign = "center",
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  pressed?: boolean;
  className?: string;
  shortcut?: string;
  tipSide?: "top" | "bottom" | "left" | "right";
  tipAlign?: "center" | "start" | "end";
}) {
  return (
    <Tip label={label} shortcut={shortcut} side={tipSide} align={tipAlign}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        className={`btn-ghost w-8 h-8 rounded-md inline-flex items-center justify-center flex-none ${className}`}
      >
        {children}
      </button>
    </Tip>
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
      <IconButton label={label} pressed={open} onClick={() => setOpen((o) => !o)} tipAlign="end">
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
  "w-full text-left h-8 px-2.5 rounded-md text-body flex items-center gap-2 text-fg hover:bg-surface";
