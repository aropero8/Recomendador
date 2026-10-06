import * as XLSX from "xlsx";
import { db, upsert } from "../db";
import { getJson, qs } from "../lib/http";
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

// ---------- sinopsis ----------

async function googleBooks(title: string, author: string, key: string) {
  for (const q of [`intitle:${title} inauthor:${author}`, `intitle:${title}`]) {
    const js = await getJson(
      `https://www.googleapis.com/books/v1/volumes?${qs({ q, maxResults: 3, key })}`,
      { delay: 300 },
    );
    for (const it of js?.items ?? []) {
      const v = it.volumeInfo;
      if (v?.description) return { desc: v.description as string, cats: (v.categories ?? []) as string[] };
    }
  }
  return null;
}

async function openLibrary(title: string, author: string) {
  const s = await getJson(`https://openlibrary.org/search.json?${qs({ title, author, limit: 1 })}`, { delay: 300 });
  const doc = s?.docs?.[0];
  if (!doc) return null;
  const w = await getJson(`https://openlibrary.org${doc.key}.json`, { delay: 300 });
  let d = w?.description ?? "";
  if (typeof d === "object") d = d.value ?? "";
  return d ? { desc: d as string, cats: ((w?.subjects ?? []) as string[]).slice(0, 5) } : null;
}

async function lookup(title: string, author: string, key: string) {
  return (await googleBooks(title, author, key)) ?? (await openLibrary(title, author)) ?? { desc: "", cats: [] };
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

export async function importBooks(readFile: File, unreadFile: File, sheetsCsv: string, booksKey: string, log: Log) {
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

  let n = 0;
  for (const { e, status } of entries) {
    const key = `${e.type}:excel:${slug(e.title + "_" + e.author)}`;
    const old = await db.items.get(key);
    let synopsis = old?.synopsis ?? "";
    let cats: string[] = old?.extra.cats ?? [];
    if (!old || !old.synopsis) {
      const r = await lookup(e.title, e.author, booksKey);
      synopsis = r.desc;
      cats = r.cats;
    }
    const item: Item = {
      key,
      source: "excel",
      type: e.type,
      title: e.title,
      synopsis,
      genres: [...e.genres, ...cats],
      userScore: status === "plan" ? null : e.rating,
      status,
      extra: { author: e.author, pages: e.pages, format: e.format, yearRead: e.year, priority: status === "plan" ? e.priority : null, volumes: e.volumes, cats },
    };
    await upsert(item);
    if (++n % 20 === 0) log(`libros/manga: ${n}/${entries.length}`);
  }
  log(`libros/manga: ${entries.length} importados`);
}
