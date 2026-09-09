"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The rendered width of an element, kept current. Charts draw into a
 * coordinate space this wide, so a 10px label is 10px on a phone as well
 * as on a monitor instead of a scaled-down picture of a wide chart.
 */
export function useWidth<T extends HTMLElement>(fallback = 720) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}
