import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether an element is within `margin` of the viewport, or visible by at
 * least `threshold`. Without IntersectionObserver (tests, very old browsers)
 * the element counts as in view, so content is never withheld.
 */
export function useInView<T extends Element>(options: {
  readonly rootMargin?: string;
  readonly threshold?: number;
} = {}): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  const { rootMargin = "0px", threshold = 0 } = options;
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => setInView(entries.some((entry) => entry.isIntersecting)),
      { rootMargin, threshold },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [rootMargin, threshold]);
  return [ref, inView];
}

/**
 * How far outside the viewport a plate attaches its video source: half a
 * screen each way keeps a 3-column grid to about a dozen sources.
 */
export const NEAR_VIEWPORT_MARGIN = "50% 0px";
