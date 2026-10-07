import { useCallback, useEffect, useState } from "react";
import type { ItemType } from "./types";

// Pantallas de la app. Cada navegación se apunta en el historial del navegador, así el botón
// «atrás» (también el de Android, ver main.tsx) vuelve a la pantalla anterior y acaba en el inicio.
export type View =
  | { v: "home" }
  | { v: "cat"; type: ItemType }
  | { v: "item"; type: ItemType; key: string } // ficha abierta encima de su categoría
  | { v: "data" }
  | { v: "settings" };

const HOME: View = { v: "home" };

export function useNav() {
  const [view, setView] = useState<View>(HOME);

  useEffect(() => {
    history.replaceState(HOME, "");
    const onPop = (e: PopStateEvent) => setView((e.state as View) ?? HOME);
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((next: View) => {
    history.pushState(next, "");
    setView(next);
  }, []);
  const back = useCallback(() => history.back(), []);

  return { view, go, back };
}
