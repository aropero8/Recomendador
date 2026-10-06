import * as XLSX from "xlsx";
import { bulkUpsert, db, Stopper } from "../db";
import { getJson, HttpError, qs } from "../lib/http";
import { norm, slug } from "../lib/text";
import type { Item, ItemType, Log, Status } from "../types";

const COLS: Record<string, string> = {
  title: "title", titulo: "title",
  author: "author", autor: "author",
  pages: "pages",
  type: "kind", "manga or novel": "kind",
  genre: "genre", genero: "genre",
  subgenre: "subgenre", subgenero: "subgenre",
  format: "format", language: "language", idioma: "language",
  rating: "rating", date: "date",
  prioridad: "priority",
};
const PRIORITY_TEXT: [string, number][] = [["maxima", 1], ["alta", 2], ["media", 3], ["baja", 4], ["muy baja", 5]];

interface Row {
  title: string;
  author: string;
  kind: string;
  genres: string[];
  rating: number | null;
  priority: number | null;
  year: number | null;
  pages?: number;
  format?: string;
}

function parsePriority(v: unknown): number | null {
  if (v == null) return null;
  const s = norm(v);
  if (/^\d+(\.0)?$/.test(s)) return parseInt(s, 10);
  for (const [k, n] of PRIORITY_TEXT) if (s.startsWith(k)) return n;
  return null;
}

/** Lee todas las pestañas; la cabecera se detecta sola (primera fila con "Title"/"Titulo"). */
function readSheets(buf: ArrayBuffer, only?: string[]): Row[] {
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const out: Row[] = [];
  for (const name of wb.SheetNames) {
    if (only && !only.includes(name)) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null });
    const h = rows.findIndex((r, i) => i < 10 && r.some((c) => ["title", "titulo"].includes(norm(c))));
    if (h < 0) continue;
    const cols = rows[h].map((c) => (c == null ? null : COLS[norm(c)] ?? null));
    const sheetYear = /(20\d\d)/.exec(name)?.[1];

    for (const r of rows.slice(h + 1)) {
      const o: Record<string, any> = {};
      cols.forEach((c, i) => {
        if (c && !(c in o) && r[i] != null) o[c] = r[i];
      });
      if (!o.title) continue;
      const rating = parseFloat(String(o.rating ?? "").replace(",", "."));
      out.push({
        title: String(o.title).trim(),
        author: String(o.author ?? "").trim(),
        kind: norm(o.kind),
        genres: [o.genre, o.subgenre].filter((g) => typeof g === "string"),
        rating: isNaN(rating) ? null : rating,
        priority: parsePriority(o.priority),
        year: o.date instanceof Date ? o.date.getFullYear() : sheetYear ? parseInt(sheetYear, 10) : null,
        pages: typeof o.pages === "number" ? o.pages : undefined,
        format: o.format,
      });
    }
  }
  return out;
}

// ---------- sinopsis (Open Library) ----------

const OL = "https://openlibrary.org";
const OL_FIELDS = "key,title,author_name,subject,first_sentence,language";
const OL_GAP = 1000; // como mucho una petición por segundo
let lastOl = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function olGet(path: string) {
  const wait = lastOl + OL_GAP - Date.now();
  if (wait > 0) await sleep(wait);
  lastOl = Date.now();
  try {
    return await getJson(OL + path, { strict: true });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    if (e instanceof HttpError) throw new Error(`Open Library no responde (${e.status}). Pulsa de nuevo para reanudar.`);
    throw e;
  }
}

const words = (s: unknown) => ` ${norm(s).replace(/[^a-z0-9]+/g, " ").trim()} `;

/** 2 = mismo título, 1 = uno contiene al otro (palabras completas), 0 = distintos. Sin tildes ni mayúsculas. */
export function titleMatch(a: unknown, b: unknown) {
  const x = words(a);
  const y = words(b);
  if (!x.trim() || !y.trim()) return 0;
  if (x === y) return 2;
  return x.includes(y) || y.includes(x) ? 1 : 0;
}

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Autor parecido aunque esté mal escrito (Kaztenbach ~ Katzenbach): alguna palabra a ≤ 2 letras. */
function authorMatch(excel: string, names: string[] = []) {
  const toks = (s: string) => words(s).trim().split(" ").filter((w) => w.length >= 4);
  const mine = toks(excel);
  return names.some((n) => toks(n).some((t) => mine.some((m) => editDistance(m, t) <= 2)));
}

async function openLibrary(title: string, author: string) {
  // Primero título + autor; si nada encaja, solo título (los autores del Excel pueden estar mal escritos)
  for (const p of author ? [{ title, author }, { title }] : [{ title }]) {
    const js = await olGet(`/search.json?${qs({ ...p, limit: 5, fields: OL_FIELDS })}`);
    // De los 5 resultados, los que coinciden exactamente antes que los que solo contienen el título.
    // Buscando solo por título, el autor tiene que parecerse para no coger otro libro con el mismo nombre.
    const ok: any[] = (js?.docs ?? [])
      .filter((d: any) => !author || p.author || authorMatch(author, d.author_name))
      .map((d: any) => ({ d, m: titleMatch(title, d.title) }))
      .filter((x: any) => x.m > 0)
      .sort((a: any, b: any) => b.m - a.m)
      .map((x: any) => x.d);
    if (!ok.length) continue;

    const w = await olGet(`${ok[0].key}.json`);
    let desc = w?.description ?? "";
    if (typeof desc === "object") desc = desc.value ?? "";
    // Open Library suele repetir el mismo libro en varias obras: primera frase y temas de cualquiera de ellas
    if (!desc) desc = ok.find((d) => d.first_sentence?.length)?.first_sentence[0] ?? "";
    const subjects = [...new Set(ok.flatMap((d) => (d.subject ?? []) as string[]))].slice(0, 10);
    return { desc: String(desc).trim(), subjects };
  }
  return null;
}

/**
 * Busca en Open Library la sinopsis de los libros que no la tienen. Se puede detener y
 * reanudar: los ya consultados quedan marcados (extra.olChecked) y no se repiten.
 * No busca las series de manga que ya están en la lista de MAL.
 */
export async function completarSinopsis(log: Log, stop: Stopper) {
  const all = await db.items.toArray();
  const malManga = all.filter((i) => i.source === "mal" && i.type === "manga").flatMap((i) => [i.title, ...(i.extra.altTitles ?? [])]);
  const inMal = (it: Item) => it.type === "manga" && malManga.some((t) => titleMatch(it.title, t) === 2);

  const books = all.filter((i) => i.source === "excel");
  const skipped = books.filter(inMal).length;
  if (skipped) log(`libros: ${skipped} series de manga ya están en MAL; no se buscan`);
  const todo = books.filter((i) => !i.synopsis && !i.extra.olChecked && !inMal(i));
  if (!todo.length) log("libros: no queda ninguna sinopsis por buscar");
  else log(`libros: buscando ${todo.length} títulos en Open Library (1 petición por segundo)`);

  let found = 0;
  for (const [n, it] of todo.entries()) {
    if (stop.stopped) return log(`libros: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
    const author = String(it.extra.author ?? "").split("/")[0].trim(); // varios autores: el primero
    const r = await openLibrary(it.title, author);
    if (r?.desc) found++;
    const subjects = r?.subjects ?? [];
    const { cats = [], lookupDone, olTried, ...extra } = it.extra; // cats/flags de versiones anteriores
    const excelGenres = it.genres.filter((g) => !cats.includes(g));
    await db.items.update(it.key, {
      synopsis: r?.desc ?? "",
      genres: [...new Set([...excelGenres, ...subjects])],
      extra: { ...extra, cats: subjects, olChecked: true },
      embedding: undefined,
    });
    if ((n + 1) % 5 === 0 || n + 1 === todo.length) log(`libros: ${n + 1}/${todo.length} (${found} con sinopsis)`);
  }

  const missing = (await db.items.where("source").equals("excel").toArray()).filter((i) => !i.synopsis && !inMal(i));
  if (todo.length) log(`libros: ${found} sinopsis encontradas de ${todo.length} buscadas`);
  log(missing.length ? `libros sin sinopsis (${missing.length}): ${missing.map((i) => i.title).join(" · ")}` : "libros: todos tienen sinopsis");
}

// ---------- agrupado de tomos de manga por serie ----------

interface Entry extends Row {
  type: ItemType;
  volumes?: number;
}

function groupManga(rows: Row[]): Entry[] {
  const out: Entry[] = [];
  const series = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.kind.includes("manga")) {
      out.push({ ...r, type: "book" });
      continue;
    }
    const base = r.title.replace(/\s*#?\d+\s*$/, "").trim() || r.title;
    const k = `${norm(base)}|${norm(r.author)}`;
    series.set(k, [...(series.get(k) ?? []), { ...r, title: base }]);
  }
  for (const vols of series.values()) {
    const rated = vols.filter((v) => v.rating != null);
    const avg = rated.length ? rated.reduce((a, v) => a + v.rating!, 0) / rated.length : null;
    out.push({ ...vols[0], type: "manga", rating: avg, volumes: vols.length });
  }
  return out;
}

// ---------- importación ----------

export async function importBooks(readFile: File, unreadFile: File, sheetsCsv: string, log: Log) {
  const read = groupManga(readSheets(await readFile.arrayBuffer()));
  const only = sheetsCsv.split(",").map((s) => s.trim()).filter(Boolean);

  // pendientes: sin duplicados, con la prioridad más alta (número más bajo)
  const readTitles = new Set(read.map((r) => norm(r.title)));
  const best = new Map<string, Row>();
  for (const r of readSheets(await unreadFile.arrayBuffer(), only.length ? only : undefined)) {
    const k = norm(r.title);
    if (!best.has(k) || (r.priority ?? 9) < (best.get(k)!.priority ?? 9)) best.set(k, r);
  }
  const dup = [...best.keys()].filter((k) => readTitles.has(k));
  if (dup.length) log(`Aparecen en leídos y pendientes: ${dup.join(", ")}`);

  const entries: { e: Entry; status: Status }[] = [
    ...read.map((e) => ({ e, status: (e.rating != null ? "read" : "reading") as Status })),
    ...[...best.values()].map((r) => ({ e: { ...r, type: "book" as ItemType }, status: "plan" as Status })),
  ];

  const items: Item[] = entries.map(({ e, status }) => ({
    key: `${e.type}:excel:${slug(e.title + "_" + e.author)}`,
    source: "excel",
    type: e.type,
    title: e.title,
    synopsis: "",
    genres: e.genres,
    userScore: status === "plan" ? null : e.rating,
    status,
    extra: { author: e.author, pages: e.pages, format: e.format, yearRead: e.year, priority: status === "plan" ? e.priority : null, volumes: e.volumes },
  }));
  // Sin buscar sinopsis aquí (ver completarSinopsis); se conserva la que ya hubiera
  await bulkUpsert(items, (item, old) => ({
    ...item,
    synopsis: old.synopsis,
    genres: [...item.genres, ...(old.extra.cats ?? [])],
    extra: { ...item.extra, cats: old.extra.cats, olChecked: old.extra.olChecked },
  }));
  log(`libros/manga: ${items.length} importados. Usa «Completar sinopsis» para buscar las sinopsis.`);
}
