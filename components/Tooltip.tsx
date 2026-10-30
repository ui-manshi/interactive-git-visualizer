"use client";

import { ReactNode, useRef } from "react";

type Side = "top" | "bottom" | "left" | "right";
type Align = "center" | "start" | "end";

const POS: Record<Side, Record<Align, string>> = {
  bottom: {
    center: "top-full mt-1.5 left-1/2 -translate-x-1/2",
    start: "top-full mt-1.5 left-0",
    end: "top-full mt-1.5 right-0",
  },
  top: {
    center: "bottom-full mb-1.5 left-1/2 -translate-x-1/2",
    start: "bottom-full mb-1.5 left-0",
    end: "bottom-full mb-1.5 right-0",
  },
  left: { center: "right-full mr-1.5 top-1/2 -translate-y-1/2", start: "right-full mr-1.5 top-0", end: "right-full mr-1.5 bottom-0" },
  right: { center: "left-full ml-1.5 top-1/2 -translate-y-1/2", start: "left-full ml-1.5 top-0", end: "left-full ml-1.5 bottom-0" },
};

/**
 * A small hover/focus tooltip for icon-only controls. The control itself still needs an
 * aria-label; the tooltip is a visual aid for sighted users, so it is hidden from assistive tech.
 *
 * It takes no space until it is shown, and when shown it slides sideways just enough to stay
 * inside the viewport (a control at the screen edge must not push its tooltip off-screen).
 */
export function Tip({
  label,
  shortcut,
  side = "bottom",
  align = "center",
  children,
  className = "",
}: {
  label: string;
  shortcut?: string;
  side?: Side;
  align?: Align;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);

  // Measure after the browser has laid the tooltip out (it is display:none until hovered).
  const keepOnScreen = () =>
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.style.marginLeft = "0px";
      const r = el.getBoundingClientRect();
      const margin = 8;
      let dx = 0;
      if (r.right > window.innerWidth - margin) dx = window.innerWidth - margin - r.right;
      if (r.left + dx < margin) dx = margin - r.left;
      el.style.marginLeft = `${dx}px`;
    });

  return (
    <span className={`relative inline-flex group/tip ${className}`} onMouseEnter={keepOnScreen} onFocus={keepOnScreen}>
      {children}
      <span
        ref={ref}
        aria-hidden
        className={`pointer-events-none absolute z-[60] ${POS[side][align]} hidden group-hover/tip:block group-focus-within/tip:block fade-in [animation-delay:250ms] w-max max-w-[16rem] rounded-md bg-raised border border-line px-2 py-1 text-caption text-fg shadow-[0_4px_12px_rgb(0_0_0/0.4)]`}
      >
        {label}
        {shortcut && <kbd className="ml-2 font-mono text-faint">{shortcut}</kbd>}
      </span>
    </span>
  );
}
