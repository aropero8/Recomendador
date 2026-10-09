import { RefObject, useEffect, useRef, useState } from "react";

export const PULL_THRESHOLD = 72; // px que hay que estirar para que al soltar se actualice
const MAX = 110;

/**
 * Deslizar hacia abajo desde arriba del todo para actualizar (como en las apps de Android).
 * Devuelve cuánto se está estirando, para dibujar el indicador; onRefresh null lo desactiva.
 */
export function usePullToRefresh(ref: RefObject<HTMLElement>, onRefresh: (() => void) | null) {
  const [pull, setPull] = useState(0);
  const latest = useRef(onRefresh);
  latest.current = onRefresh;
  const enabled = onRefresh != null;

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    let startY: number | null = null;
    let dist = 0;
    const set = (d: number) => {
      dist = d;
      setPull(d);
    };
    const start = (e: TouchEvent) => {
      startY = el.scrollTop <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null;
    };
    const move = (e: TouchEvent) => {
      if (startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy <= 0 || el.scrollTop > 0) {
        if (dist) set(0);
        if (el.scrollTop > 0) startY = null; // ha empezado a hacer scroll normal
        return;
      }
      set(Math.min(MAX, dy * 0.5)); // cuesta un poco más que el dedo, como un muelle
    };
    const end = () => {
      if (startY != null && dist >= PULL_THRESHOLD) latest.current?.();
      startY = null;
      if (dist) set(0);
    };
    el.addEventListener("touchstart", start, { passive: true });
    el.addEventListener("touchmove", move, { passive: true });
    el.addEventListener("touchend", end);
    el.addEventListener("touchcancel", end);
    return () => {
      el.removeEventListener("touchstart", start);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", end);
      el.removeEventListener("touchcancel", end);
      setPull(0);
    };
  }, [ref, enabled]);

  return pull;
}
