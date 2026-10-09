import { useCallback, useEffect, useRef, useState } from "react";
import type { ItemType } from "./types";

// Pantallas de la app. Cada navegación se apunta en el historial del navegador, así el botón
// «atrás» (también el de Android, ver main.tsx) vuelve a la pantalla anterior y acaba en el inicio.
export type View =
  | { v: "home" }
  | { v: "cat"; type: ItemType }
  | { v: "item"; type: ItemType; key: string } // ficha abierta encima de la pantalla anterior
  | { v: "book"; type: ItemType; key?: string } // formulario para añadir (sin key) o editar un libro
  | { v: "reco"; type?: ItemType } // «Recomiéndame» (desde el inicio o desde una categoría)
  | { v: "ruleta" } // «Ver peli»: ruleta con las películas pendientes (desde Películas)
  | { v: "data" }
  | { v: "settings" };

const HOME: View = { v: "home" };

/** Ficha y formulario: se abren encima de la pantalla anterior, que sigue montada debajo (y conserva su scroll). */
export const isOverlay = (v: View) => v.v === "item" || v.v === "book";

export function useNav() {
  const [view, setView] = useState<View>(HOME);
  const current = useRef(view);
  current.current = view;

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

  /**
   * Barra inferior (Inicio y las categorías): las categorías cuelgan siempre directamente del inicio,
   * así «atrás» desde cualquiera de ellas vuelve al inicio y desde ahí sale de la app, como en Android.
   */
  const tab = useCallback(
    (next: View) => {
      if (current.current.v === "home") {
        if (next.v !== "home") go(next);
      } else if (next.v === "home") {
        history.back(); // el popstate pone el inicio
      } else {
        history.replaceState(next, "");
        setView(next);
      }
    },
    [go],
  );

  return { view, go, back, tab };
}
