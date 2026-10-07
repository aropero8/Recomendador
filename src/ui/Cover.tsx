import { useState } from "react";
import type { Item } from "../types";

const SMALL = new Set(["el", "la", "los", "las", "lo", "un", "una", "the", "a", "an", "de", "del", "y", "of", "and"]);

/** Iniciales para la portada de relleno: «El nombre del viento» -> «NV». */
export function initials(title: string) {
  const ws = title.replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
  const main = ws.filter((w) => !SMALL.has(w.toLowerCase()));
  return (main.length ? main : ws).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/** Portada con carga perezosa; si no hay (o falla), un recuadro del color de la categoría con las iniciales. */
export default function Cover({ item, eager = false }: { item: Item; eager?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (item.cover && failed !== item.cover) {
    return (
      <img
        className="cover"
        src={item.cover}
        alt=""
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(item.cover!)}
      />
    );
  }
  return (
    <div className={`cover ph ${item.type}`} aria-hidden>
      <span>{initials(item.title)}</span>
    </div>
  );
}
