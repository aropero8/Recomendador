import * as XLSX from "xlsx";
import { removeCover } from "./covers/user";
import { db, getMeta, putInBatches, setMeta } from "./db";
import { apiGet, applyUserEdits, DELETED_EXCEL, EDITABLE, OL, olCover, titleMatch } from "./ingest/books";
import { qs } from "./lib/http";
import { saveFile } from "./lib/save";
import { norm } from "./lib/text";
import { BOOK_SOURCES, isBookSource, type Item, type Log, type Status } from "./types";

// Libros apuntados en la app (source "app") y edición de los que vinieron del Excel.

export type BookStatus = "read" | "reading" | "plan";
export const BOOK_STATUS: [BookStatus, string][] = [
  ["read", "Leído"],
  ["reading", "Leyendo"],
  ["plan", "Pendiente"],
];
const STATUS_TEXT: Record<Status, string> = { read: "Leído", reading: "Leyendo", plan: "Pendiente", dropped: "Abandonado", other: "En pausa" };
export const FORMATS = ["Papel", "Digital", "Audio"];

export interface BookInput {
  title: string;
  author: string;
  status: BookStatus;
  score: number | null; // 0-10 con medios puntos, solo si está leído
  date: string; // fecha de lectura (AAAA-MM-DD), solo si está leído
  pages?: number;
  format?: string;
  priority?: number | null; // 1-5, solo si está pendiente
  cover?: string; // de la sugerencia de Open Library
  olKey?: string;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Valores de un libro en el formato del formulario. */
export function bookToInput(it: Item): BookInput {
  const status: BookStatus = it.status === "read" || it.status === "reading" || it.status === "plan" ? it.status : "read";
  return {
    title: it.title,
    author: it.extra.author ?? "",
    status,
    score: it.userScore,
    date: it.extra.date ?? today(),
    pages: it.extra.pages,
    format: it.extra.format,
    priority: it.extra.priority ?? null,
  };
}

/** Aplica lo del formulario: la nota y la fecha solo cuentan si está leído; la prioridad, si está pendiente. */
function applyInput(it: Item, b: BookInput): Item {
  const read = b.status === "read";
  const date = read ? b.date || today() : undefined;
  return {
    ...it,
    title: b.title.trim(),
    status: b.status,
    userScore: read ? b.score : null,
    extra: {
      ...it.extra,
      author: b.author.trim(),
      date,
      yearRead: date ? Number(date.slice(0, 4)) : b.status === "plan" ? undefined : it.extra.yearRead,
      pages: b.pages || undefined,
      format: b.format || undefined,
      priority: b.status === "plan" ? b.priority ?? null : null,
    },
  };
}

/** Lo que ha cambiado en los campos editables (para guardarlo en extra.userEdits de los libros del Excel). */
function changedFields(before: Item, after: Item) {
  const get = (i: Item, k: string) => (k === "title" || k === "status" || k === "userScore" ? (i as any)[k] : i.extra[k]);
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (JSON.stringify(get(before, k)) !== JSON.stringify(get(after, k))) out[k] = get(after, k) ?? null;
  return out;
}

export async function addBook(b: BookInput): Promise<string> {
  const key = `book:app:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const base: Item = {
    key,
    source: "app",
    type: "book",
    title: "",
    synopsis: "",
    genres: [],
    userScore: null,
    status: "plan",
    cover: b.cover,
    extra: { addedAt: new Date().toISOString(), olKey: b.olKey },
  };
  await putInBatches([applyInput(base, b)]);
  return key;
}

/**
 * Guarda los cambios del formulario. Nunca quita la sinopsis ni la portada que ya tuviera (la de la
 * sugerencia solo se usa si no había ninguna). En los libros del Excel, lo cambiado se apunta en
 * extra.userEdits para que una reimportación lo respete.
 */
export async function updateBook(key: string, b: BookInput) {
  const it = await db.items.get(key);
  if (!it) throw new Error("Ese libro ya no está en tu biblioteca.");
  const next = applyInput(it, b);
  if (!it.cover && b.cover) next.cover = b.cover;
  if (it.source === "excel") {
    const ue = { ...it.extra.userEdits, ...changedFields(it, next) };
    await putInBatches([applyUserEdits(next, ue)]);
  } else await putInBatches([next]);
}

export async function markAsRead(key: string, score: number | null, date: string) {
  const it = await db.items.get(key);
  if (!it) throw new Error("Ese libro ya no está en tu biblioteca.");
  await updateBook(key, { ...bookToInput(it), status: "read", score, date });
}

/**
 * Elimina un libro (y la portada que le pusieras a mano). Si venía del Excel se apunta para que
 * no vuelva al reimportar.
 */
export async function deleteBook(key: string) {
  const it = await db.items.get(key);
  if (it?.source === "excel") {
    const del = await getMeta<string[]>(DELETED_EXCEL, []);
    await setMeta(DELETED_EXCEL, [...new Set([...del, key])]);
  }
  await db.items.delete(key);
  await removeCover(key);
}

/** ¿Ya tienes un libro con el mismo título y autor? */
export function findDuplicate(items: Item[], title: string, author: string, exceptKey?: string) {
  const surname = (a: string) => norm(a).split(/\s+/).pop() ?? "";
  return items.find(
    (i) =>
      isBookSource(i) &&
      i.key !== exceptKey &&
      titleMatch(i.title, title) === 2 &&
      surname(i.extra.author ?? "") === surname(author),
  );
}

// ---------- sugerencias de Open Library ----------

export interface Suggestion {
  key: string;
  title: string;
  author: string;
  year?: number;
  pages?: number;
  cover?: string;
}

/** Libros de Open Library para un título a medio escribir (comparte el límite de una petición por segundo). */
export async function suggestBooks(q: string): Promise<Suggestion[]> {
  const fields = "key,title,author_name,first_publish_year,number_of_pages_median,cover_i,editions,editions.title,editions.cover_i,editions.language";
  const js = await apiGet(`${OL}/search.json?${qs({ q, limit: 6, fields })}`);
  return ((js?.docs ?? []) as any[]).map((d) => {
    const ed = d.editions?.docs?.[0]; // la edición que coincide con lo escrito (a menudo en español)
    const spa = (ed?.language ?? []).includes("spa");
    return {
      key: d.key,
      title: String(ed?.title ?? d.title).replace(/\s+/g, " ").trim(), // algunos títulos traen saltos de línea
      author: d.author_name?.[0] ?? "",
      year: d.first_publish_year,
      pages: d.number_of_pages_median,
      cover: olCover((spa && ed?.cover_i) || d.cover_i || ed?.cover_i),
    };
  });
}

// ---------- exportar a Excel ----------

/** «2026-10-01» como número de serie de Excel (días desde 30/12/1899), sin zonas horarias de por medio. */
const excelDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000;
};

/** Descarga un .xlsx con todos los libros (los del Excel y los de la app). */
export async function exportBooksXlsx(log: Log) {
  const items = (await db.items.where("source").anyOf([...BOOK_SOURCES]).toArray()).sort((a, b) => a.title.localeCompare(b.title, "es"));
  const rows = items.map((i) => ({
    Título: i.title,
    Autor: i.extra.author ?? "",
    Tipo: i.type === "manga" ? "Manga" : "Libro",
    Estado: STATUS_TEXT[i.status],
    Nota: i.userScore ?? "",
    Fecha: i.extra.date ? excelDate(i.extra.date) : i.extra.yearRead ?? "",
    Páginas: i.extra.pages ?? "",
    Formato: i.extra.format ?? "",
    Prioridad: i.extra.priority ?? "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  // La columna Fecha (F) lleva números de serie de Excel: se les da formato de fecha
  rows.forEach((r, n) => {
    const cell = ws[`F${n + 2}`];
    if (cell && typeof r.Fecha === "number" && r.Fecha > 3000) cell.z = "dd/mm/yyyy"; // > 3000: no es un año suelto
  });
  ws["!cols"] = [40, 28, 8, 11, 6, 12, 8, 10, 9].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Libros");
  const name = `libros-recomendador-${today()}.xlsx`; // .gitignore: *.xlsx
  const xlsx = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const saved = await saveFile(name, new Blob([xlsx], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  if (!saved) return log("Excel sin guardar: has cerrado «Compartir».");
  log(`Libros exportados a Excel: ${items.length} (${name})`);
}
