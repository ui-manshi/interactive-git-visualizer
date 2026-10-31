"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query. Returns `fallback` on the server and for the first client render
 * (so hydration matches), then the real value.
 */
export function useMediaQuery(query: string, fallback = false): boolean {
  const [matches, setMatches] = useState(fallback);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const update = () => setMatches(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, [query]);
  return matches;
}

/** Below Tailwind's `lg` (1024px): the inspector is an overlay sheet, not a docked column. */
export const NARROW_QUERY = "(max-width: 1023px)";
