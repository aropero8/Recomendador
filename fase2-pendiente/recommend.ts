import { db } from "./db";
import { norm } from "./lib/text";
import type { Item, ItemType } from "./types";

// Nota (0-10) a peso (-1..1). Por debajo de CENTER resta, por encima suma.
const CENTER = 6.5;
const weight = (s: number) => Math.max(-1, Math.min(1, (s - CENTER) / 3.5));

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

export interface Rec {
  item: Item;
  score: number; // similitud coseno + pequeño extra por prioridad
  because: string[];
}

/** Las series de manga del Excel que ya están en MAL se funden con la entrada de MAL. */
function mergeDuplicates(items: Item[]): Item[] {
  const isExcelManga = (i: Item) => i.type === "manga" && i.source === "excel";
  const out = items.filter((i) => !isExcelManga(i));
  const mal = out.filter((i) => i.type === "manga" && i.source === "mal");
  for (const s of items.filter(isExcelManga)) {
    const n = norm(s.title);
    const m = mal.find((x) =>
      [x.title, ...(x.extra.altTitles ?? [])].some((t) => {
        const tn = norm(t);
        return tn === n || (n.length >= 6 && tn.length >= 6 && (tn.includes(n) || n.includes(tn)));
      }),
    );
    if (!m) {
      out.push(s);
    } else if (m.userScore == null && s.userScore != null) {
      out[out.indexOf(m)] = { ...m, userScore: s.userScore, status: m.status === "plan" ? "read" : m.status };
    }
  }
  return out;
}

/**
 * Recomienda dentro de `target` (solo lo que tienes pendiente) usando el gusto
 * calculado a partir de las categorías de `from` (o de todas).
 */
export async function recommend(target: ItemType, from: ItemType[] | "all", n = 15): Promise<Rec[]> {
  const items = mergeDuplicates((await db.items.toArray()).filter((i) => i.embedding));
  const rated = items.filter((i) => i.userScore != null && (from === "all" || from.includes(i.type)));
  if (!rated.length) return [];

  const dim = rated[0].embedding!.length;
  const prof = new Float32Array(dim);
  for (const i of rated) {
    const w = weight(i.userScore!);
    for (let k = 0; k < dim; k++) prof[k] += w * i.embedding![k];
  }
  const norma = Math.sqrt(dot(prof, prof)) || 1;
  for (let k = 0; k < dim; k++) prof[k] /= norma;

  const liked = rated.filter((i) => i.userScore! >= 8);
  return items
    .filter((i) => i.type === target && i.status === "plan")
    .map((item) => {
      const bonus = item.extra.priority ? (5 - item.extra.priority) * 0.01 : 0;
      const because = liked
        .filter((l) => l.key !== item.key)
        .map((l) => ({ t: l.title, s: dot(item.embedding!, l.embedding!) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
        .map((x) => x.t);
      return { item, score: dot(item.embedding!, prof) + bonus, because };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
