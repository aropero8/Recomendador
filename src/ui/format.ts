import type { Item } from "../types";

const decimal = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat("es");

/** Nota con coma decimal y sin «,0»: 8 · 7,5. */
export const scoreText = (s: number) => decimal.format(Math.round(s * 10) / 10);

/** «1 título» · «1.234 títulos». */
export const titles = (n: number) => `${integer.format(n)} ${n === 1 ? "título" : "títulos"}`;

/** Fecha para «Recientes»: la que traiga la importación o, en libros, el año de lectura. */
export const when = (i: Item) => Date.parse(i.extra.date ?? "") || (i.extra.yearRead ? Date.UTC(i.extra.yearRead, 0, 1) : 0);

/** Progreso de MAL de 0 a 1 (episodios o capítulos vistos de los totales), o null si no se sabe. */
export function progress(i: Item): number | null {
  const p = i.extra.progress;
  if (!p) return null;
  const [n, total] = i.type === "anime" ? [p.episodes, p.totalEpisodes] : p.totalChapters ? [p.chapters, p.totalChapters] : [p.volumes, p.totalVolumes];
  return total ? Math.min(1, (n ?? 0) / total) : null;
}
