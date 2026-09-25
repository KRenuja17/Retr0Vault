import { useCallback, useEffect, useState } from "react";

/*
 * Two viewer preferences for motion plates:
 *
 * - reduced motion, from the operating system: plates never play by themselves,
 *   only on an explicit PLAY;
 * - scrub mode, chosen on the Motion rail: the pointer's position across a
 *   plate sets the time, like leafing through a flip-book. Remembered per
 *   viewer, and harmless when storage is unavailable.
 */

const SCRUB_KEY = "retr0vault.motion.scrub";

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

function readScrub(): boolean {
  try {
    return window.localStorage.getItem(SCRUB_KEY) === "1";
  } catch {
    return false;
  }
}

const listeners = new Set<(value: boolean) => void>();

export function useScrubMode(): readonly [boolean, (next: boolean) => void] {
  const [scrub, setScrub] = useState(readScrub);
  useEffect(() => {
    listeners.add(setScrub);
    return () => {
      listeners.delete(setScrub);
    };
  }, []);
  const update = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(SCRUB_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable (private window, blocked site data): keep it for this page only.
    }
    for (const listener of listeners) listener(next);
  }, []);
  return [scrub, update] as const;
}
