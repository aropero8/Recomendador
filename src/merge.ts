import { malSeries } from "./ingest/books";
import type { Item } from "./types";

/**
 * Las series de manga del Excel que también están en tu lista de MAL se muestran una sola vez:
 * se oculta la del Excel y la de MAL lleva sus datos en papel (tomos, nota). Si en MAL no le has
 * puesto nota, se usa la del Excel. No cambia nada en la base de datos.
 */
export function fusionarManga(items: Item[]): Item[] {
  const malManga = items.filter((i) => i.source === "mal" && i.type === "manga");
  if (!malManga.length) return items;
  const paper = new Map<string, Item[]>(); // clave de MAL -> series del Excel
  const hidden = new Set<string>();
  for (const it of items) {
    if (it.source !== "excel" || it.type !== "manga") continue;
    const m = malSeries(it, malManga);
    if (!m) continue;
    hidden.add(it.key);
    paper.set(m.key, [...(paper.get(m.key) ?? []), it]);
  }
  if (!hidden.size) return items;
  return items
    .filter((i) => !hidden.has(i.key))
    .map((i) => {
      const ps = paper.get(i.key);
      if (!ps) return i;
      const rated = ps.filter((p) => p.userScore != null);
      const score = rated.length ? rated.reduce((a, p) => a + p.userScore!, 0) / rated.length : null;
      const volumes = ps.reduce((a, p) => a + (p.extra.volumes ?? 1), 0);
      return {
        ...i,
        userScore: i.userScore ?? score,
        cover: i.cover ?? ps.find((p) => p.cover)?.cover,
        extra: { ...i.extra, paper: { volumes, score, keys: ps.map((p) => p.key) } },
      };
    });
}
