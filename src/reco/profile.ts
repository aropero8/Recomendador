import { isBookSource, ITEM_TYPES, type Item, type ItemType } from "../types";

// Perfil de gustos sin IA: lo que más y menos te ha gustado, lo último que has visto o leído y los
// géneros que más puntúas alto, por categoría. Sirve de contexto para Gemini o para pegar en un chat.

const NAME: Record<ItemType, string> = { anime: "Anime", manga: "Manga", movie: "Películas", book: "Libros" };
const DONE: Record<ItemType, string> = { anime: "vistos", manga: "leídos", movie: "vistas", book: "leídos" };
const MAX_TOKENS = 3000; // presupuesto aproximado del texto completo (1 token ≈ 4 caracteres)

/** Fecha de la última vez (la de la importación o, en libros, el año de lectura), para «recientes». */
export const recency = (i: Item) => Date.parse(i.extra.date ?? "") || (i.extra.yearRead ? Date.UTC(i.extra.yearRead, 0, 1) : 0);

const score = (s: number) => s.toFixed(1).replace(".0", "");

/** Título sin ambigüedad: con autor (libros), año y director (películas) o el título original (anime y manga). */
export function label(i: Item) {
  const e = i.extra;
  if (i.type === "movie") return `${i.title}${e.year ? ` (${[e.year, e.director].filter(Boolean).join(", ")})` : ""}`;
  if (isBookSource(i)) return `${i.title}${e.author ? ` (${e.author})` : ""}`;
  const original = (e.altTitles ?? []).find((t: string) => t !== i.title && /[a-z]/i.test(t));
  return original ? `${i.title} [${original}]` : i.title;
}

export interface CategoryProfile {
  type: ItemType;
  done: number; // vistos o leídos (lo que no está pendiente)
  rated: number;
  avg: number | null;
  top: Item[];
  bottom: Item[];
  recent: Item[];
  genres: [string, number][];
}

interface Sizes {
  top: number;
  bottom: number;
  recent: number;
  genres: number;
}
const FULL: Sizes = { top: 15, bottom: 5, recent: 10, genres: 8 };

export function categoryProfile(items: Item[], type: ItemType, n: Sizes = FULL): CategoryProfile {
  const done = items.filter((i) => i.type === type && i.status !== "plan");
  const rated = done.filter((i) => i.userScore != null);
  const avg = rated.length ? rated.reduce((a, i) => a + i.userScore!, 0) / rated.length : null;
  const byScore = [...rated].sort((a, b) => b.userScore! - a.userScore! || recency(b) - recency(a));
  const top = byScore.slice(0, n.top);
  // Los peor puntuados, solo si quedan por debajo de tu media (si no, no dicen nada)
  const bottom = byScore
    .slice(top.length)
    .reverse()
    .filter((i) => avg != null && i.userScore! < avg)
    .slice(0, n.bottom);
  const listed = new Set([...top, ...bottom].map((i) => i.key));
  const recent = done
    .filter((i) => !listed.has(i.key) && recency(i) > 0)
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, n.recent);
  // Géneros de lo que puntúas alto (por encima de tu media y al menos un 7)
  const counts = new Map<string, number>();
  for (const i of rated.filter((i) => i.userScore! >= Math.max(avg ?? 0, 7)))
    for (const g of new Set(i.genres)) counts.set(g, (counts.get(g) ?? 0) + 1);
  const genres = [...counts].sort((a, b) => b[1] - a[1]).slice(0, n.genres);
  return { type, done: done.length, rated: rated.length, avg, top, bottom, recent, genres };
}

function categoryText(p: CategoryProfile) {
  if (!p.done) return "";
  const withScore = (xs: Item[]) => xs.map((i) => `${label(i)} ${score(i.userScore!)}`).join(" · ");
  const lines = [
    `## ${NAME[p.type]} (${p.done} ${DONE[p.type]}, ${p.rated} con nota${p.avg != null ? `, media ${score(p.avg)}` : ""})`,
    p.top.length && `Favoritos: ${withScore(p.top)}`,
    p.bottom.length && `Menos gustados: ${withScore(p.bottom)}`,
    p.recent.length && `Recientes: ${p.recent.map((i) => (i.userScore != null ? `${label(i)} ${score(i.userScore)}` : label(i))).join(" · ")}`,
    p.genres.length && `Géneros que más puntúo alto: ${p.genres.map(([g, n]) => `${g} (${n})`).join(", ")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Texto compacto del perfil (las categorías pedidas, por defecto todas). Si pasa del presupuesto
 * de ~3.000 tokens, se acortan las listas hasta que quepa.
 */
export function profileText(items: Item[], types: ItemType[] = ITEM_TYPES) {
  const steps: Sizes[] = [FULL, { top: 12, bottom: 4, recent: 8, genres: 8 }, { top: 10, bottom: 3, recent: 6, genres: 6 }, { top: 8, bottom: 2, recent: 4, genres: 5 }];
  let text = "";
  for (const n of steps) {
    const parts = types.map((t) => categoryText(categoryProfile(items, t, n))).filter(Boolean);
    text = `PERFIL DE GUSTOS (notas sobre 10)\n\n${parts.join("\n\n")}`;
    if (estimateTokens(text) <= MAX_TOKENS) break;
  }
  return text;
}

/** Perfil con instrucciones para pegarlo en cualquier chat de IA («Copiar mi perfil»). */
export function profileForChat(items: Item[]) {
  return [
    "Quiero que me recomiendes anime, manga, películas o libros según mis gustos. Abajo tienes mi perfil con mis notas sobre 10.",
    "Cuando te pida algo (por ejemplo «5 libros», «una película corta y oscura» o «un anime parecido a Steins;Gate»):",
    "- recomiéndame títulos que no aparezcan en mi perfil, con su año y su autor, director o estudio;",
    "- explica en 1-2 frases por qué me puede gustar cada uno, mencionando qué títulos míos se parecen;",
    "- responde en español.",
    "",
    profileText(items),
  ].join("\n");
}
