import * as XLSX from "xlsx";
import { BatchWriter, bulkUpsert, db, Stopper } from "../db";
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
  date?: string; // fecha de lectura (ISO), si la hoja la tiene
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
        date: o.date instanceof Date && !isNaN(o.date.getTime()) ? o.date.toISOString().slice(0, 10) : undefined,
        pages: typeof o.pages === "number" ? o.pages : undefined,
        format: o.format,
      });
    }
  }
  return out;
}

// ---------- sinopsis: Wikipedia ES -> Open Library -> Wikipedia EN ----------

export const OL = "https://openlibrary.org";
const OL_FIELDS = "key,title,author_name,subject,first_sentence,language,cover_i";
// default=false: si la portada no existe da error (y se ve el recuadro con iniciales) en vez de una imagen en blanco
export const olCover = (id?: number) => (id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg?default=false` : undefined);
const GAP = 1000; // como mucho una petición por segundo, sumando todas las fuentes
let last = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function apiGet(url: string) {
  const wait = last + GAP - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  try {
    return await getJson(url, { strict: true });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    if (e instanceof HttpError) throw new Error(`${new URL(url).host} no responde (${e.status}). Pulsa de nuevo para reanudar.`);
    throw e;
  }
}

/**
 * Título limpio para buscar (no se guarda): sin paréntesis ni número de tomo al final.
 * "Divina Comedia I" -> "Divina Comedia", "El pistolero (DT1)" -> "El pistolero". "Fahrenheit 451" se queda igual.
 */
export function cleanTitle(t: string) {
  const c = t
    // primero el tomo final y después los paréntesis: "La llegada de los 3 (DT2)" conserva el 3
    .replace(/\s+(?:vol\.?|tomo)\s*$/i, "")
    .replace(/\s+(?:[IVX]{1,4}|\d{1,2})\s*$/, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return c || t.trim();
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

/** Con wantDesc = false solo busca (portada y temas), sin pedir la descripción de la obra. */
async function openLibrary(title: string, author: string, wantDesc = true) {
  // Primero título + autor; si nada encaja, solo título (los autores del Excel pueden estar mal escritos)
  for (const p of author ? [{ title, author }, { title }] : [{ title }]) {
    const js = await apiGet(`${OL}/search.json?${qs({ ...p, limit: 5, fields: OL_FIELDS })}`);
    // De los 5 resultados, los que coinciden exactamente antes que los que solo contienen el título.
    // Buscando solo por título, el autor tiene que parecerse para no coger otro libro con el mismo nombre.
    const ok: any[] = (js?.docs ?? [])
      .filter((d: any) => !author || p.author || authorMatch(author, d.author_name))
      .map((d: any) => ({ d, m: titleMatch(title, d.title) }))
      .filter((x: any) => x.m > 0)
      .sort((a: any, b: any) => b.m - a.m)
      .map((x: any) => x.d);
    if (!ok.length) continue;

    let desc = "";
    if (wantDesc) {
      const w = await apiGet(`${OL}${ok[0].key}.json`);
      desc = w?.description ?? "";
      if (typeof desc === "object") desc = (desc as any).value ?? "";
    }
    // Open Library suele repetir el mismo libro en varias obras: primera frase, temas y portada de cualquiera de ellas.
    // La primera frase es una cita del libro, no un resumen: solo se usa si no hay nada mejor.
    const firstSentence = String(ok.find((d) => d.first_sentence?.length)?.first_sentence[0] ?? "").trim();
    const subjects = [...new Set(ok.flatMap((d) => (d.subject ?? []) as string[]))].slice(0, 10);
    const cover = olCover(ok.find((d) => d.cover_i)?.cover_i);
    return { desc: String(desc).trim(), firstSentence, subjects, cover };
  }
  return null;
}

/** El texto menciona al autor (su apellido, aunque esté mal escrito en el Excel). */
function mentionsAuthor(author: string, text: string) {
  const surname = words(author).trim().split(" ").pop() ?? "";
  if (surname.length < 3) return true;
  const toks = words(text).trim().split(" ");
  return toks.some((t) => t === surname || (surname.length >= 6 && editDistance(t, surname) <= 2));
}

// Palabras que indican que la página es de un libro (y no de la película, la banda sonora...)
const BOOK_WORDS =
  / (novela|novelas|libro|obra|poema|poemario|ensayo|cuento|cuentos|relato|relatos|saga|trilogia|manga|historieta|novel|novella|book|poem|essay|memoir) /;
// (no «serie» a secas: «es una serie de manga» sí es un libro)
const OTHER_WORDS =
  / (pelicula|film|banda sonora|soundtrack|album|videojuego|video game|television|miniserie|miniseries|comic|comics|cancion|song) /;

/** Es un libro si lo dice antes de hablar de película, disco... ("banda sonora de la adaptación de la novela" no vale). */
function isBookPage(head: string) {
  const w = words(head);
  const book = w.search(BOOK_WORDS);
  const other = w.search(OTHER_WORDS);
  return book >= 0 && (other < 0 || book < other);
}

async function wikipedia(lang: "es" | "en", title: string, author: string) {
  const surname = words(author).trim().split(" ").pop() ?? "";
  const kind = lang === "es" ? "novela" : "novel";
  // Con un apellido mal escrito la búsqueda no devuelve nada: se repite sin él, y por último
  // solo con el título (para lo que no es novela: "Divina Comedia" es un poema)
  const queries = [...new Set([[title, surname, kind], [title, kind], [title]].map((q) => q.filter(Boolean).join(" ")))];
  const seen = new Set<string>(); // páginas ya descartadas en una búsqueda anterior
  for (const q of queries) {
    const js = await apiGet(
      `https://${lang}.wikipedia.org/w/api.php?${qs({ action: "query", list: "search", srsearch: q, srlimit: 5, format: "json", origin: "*" })}`,
    );
    // Páginas cuyo título (sin la coletilla "(novela)") se parece al del libro; como mucho dos intentos
    const pages = ((js?.query?.search ?? []) as any[])
      .map((r) => ({ t: r.title as string, m: titleMatch(title, r.title.replace(/\([^)]*\)/g, "")) }))
      .filter((p) => p.m > 0 && !seen.has(p.t))
      .sort((a, b) => b.m - a.m)
      .slice(0, 2);
    for (const p of pages) {
      seen.add(p.t);
      const sum = await apiGet(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(p.t.replace(/ /g, "_"))}`);
      if (!sum?.extract || sum.type === "disambiguation") continue;
      // La descripción o la primera frase tienen que decir que es un libro
      const head = `${sum.description ?? ""} ${String(sum.extract).split(/(?<=\.)\s/)[0]}`;
      if (!isBookPage(head)) continue;
      // Y tiene que hablar del autor, para no coger otro libro con el mismo título
      if (author && !mentionsAuthor(author, `${sum.description ?? ""} ${sum.extract}`)) continue;
      return {
        desc: String(sum.extract).trim(),
        url: sum.content_urls?.desktop?.page as string | undefined,
        thumb: sum.thumbnail?.source as string | undefined,
      };
    }
  }
  return null;
}

/** Miniatura del artículo de Wikipedia del que ya salió la sinopsis (una sola petición). */
export async function wikiThumb(pageUrl: string) {
  const m = /^https:\/\/(\w+)\.wikipedia\.org\/wiki\/(.+)$/.exec(pageUrl);
  if (!m) return undefined;
  const sum = await apiGet(`https://${m[1]}.wikipedia.org/api/rest_v1/page/summary/${m[2]}`);
  return sum?.thumbnail?.source as string | undefined;
}

export const firstAuthor = (it: Item) => String(it.extra.author ?? "").split("/")[0].trim(); // varios autores: el primero

/** Serie de tu lista de MAL que corresponde a un manga del Excel (mismo título o título alternativo). */
export function malSeries(it: Item, malManga: Item[]) {
  if (it.type !== "manga") return undefined;
  return malManga.find((m) => [m.title, ...(m.extra.altTitles ?? [])].some((t) => titleMatch(it.title, t) === 2));
}

/**
 * Portada de un libro: cover_i de Open Library y, si no hay, la miniatura de Wikipedia (la del
 * artículo de la sinopsis o buscando en español y después en inglés). Una petición por segundo.
 */
export async function buscarPortadaLibro(it: Item): Promise<string | undefined> {
  const title = cleanTitle(it.title);
  const author = firstAuthor(it);
  const ol = await openLibrary(title, author, false);
  if (ol?.cover) return ol.cover;
  const url: string | undefined = it.extra.synopsisUrl;
  const urlLang = /^https:\/\/(\w+)\.wikipedia\.org\//.exec(url ?? "")?.[1];
  if (urlLang) {
    const t = await wikiThumb(url!);
    if (t) return t;
  }
  for (const lang of ["es", "en"] as const) {
    if (lang === urlLang) continue; // ese artículo ya se ha mirado
    const w = await wikipedia(lang, title, author);
    if (w?.thumb) return w.thumb;
  }
  return undefined;
}

const LOOKUP_V = 2; // versión de la búsqueda: lo marcado con una versión anterior se vuelve a intentar

/**
 * Busca la sinopsis de los libros del Excel que no la tienen: Wikipedia en español, Open Library y
 * Wikipedia en inglés. Si de paso aparece una portada (miniatura de Wikipedia o cover_i de Open
 * Library) y el libro no tenía, se guarda; las demás las busca «Descargar portadas». Se puede
 * detener y reanudar (extra.lookupV marca lo ya intentado). Las series de manga que ya están en
 * MAL no se buscan.
 */
export async function completarLibros(log: Log, stop: Stopper) {
  const all = await db.items.toArray();
  const malManga = all.filter((i) => i.source === "mal" && i.type === "manga");
  const books = all.filter((i) => i.source === "excel");
  const inMal = books.filter((i) => malSeries(i, malManga)).length;
  if (inMal) log(`libros: ${inMal} series de manga ya están en MAL; no se buscan`);

  const todo = books.filter((i) => !i.synopsis && i.extra.lookupV !== LOOKUP_V && !malSeries(i, malManga));
  if (!todo.length) log("libros: no queda ninguna sinopsis por buscar");
  else log(`libros: buscando la sinopsis de ${todo.length} títulos (1 petición por segundo)`);

  const bySource: Record<string, number> = {};
  let covers = 0;
  const out = new BatchWriter();
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return log(`libros: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
      const author = firstAuthor(it);
      const title = cleanTitle(it.title);
      const { cats = [], lookupDone, olTried, coverChecked, ...extra } = it.extra; // cats/flags de versiones anteriores
      const excelGenres = it.genres.filter((g) => !cats.includes(g));
      let subjects: string[] = cats;
      let desc = "";
      let source: string | undefined;
      let url: string | undefined;
      let firstSentence = "";
      let cover = it.cover;
      const keepCover = (c?: string) => {
        if (!cover && c) [cover, covers] = [c, covers + 1];
      };

      const es = await wikipedia("es", title, author);
      if (es) {
        [desc, source, url] = [es.desc, "wikipedia-es", es.url];
        keepCover(es.thumb);
      }
      // Open Library: si ya se consultó con este mismo título no se repite
      if (!desc && !(extra.olChecked && title === it.title)) {
        const ol = await openLibrary(title, author);
        extra.olChecked = true;
        if (ol?.subjects.length) subjects = ol.subjects;
        if (ol?.desc) [desc, source] = [ol.desc, "openlibrary"];
        firstSentence = ol?.firstSentence ?? "";
        keepCover(ol?.cover);
      }
      if (!desc) {
        const en = await wikipedia("en", title, author);
        if (en) {
          [desc, source, url] = [en.desc, "wikipedia-en", en.url];
          keepCover(en.thumb);
        }
      }
      if (!desc && firstSentence) [desc, source] = [firstSentence, "openlibrary-frase"];
      if (desc) bySource[source!] = (bySource[source!] ?? 0) + 1;

      await out.put({
        ...it,
        synopsis: desc,
        cover,
        genres: [...new Set([...excelGenres, ...subjects])],
        extra: { ...extra, cats: subjects, lookupV: LOOKUP_V, synopsisSource: source, synopsisUrl: url },
      });
      const found = Object.values(bySource).reduce((a, b) => a + b, 0);
      if ((n + 1) % 5 === 0 || n + 1 === todo.length) log(`libros: ${n + 1}/${todo.length} (${found} sinopsis, ${covers} portadas de paso)`);
    }
  } finally {
    await out.flush();
  }

  const found = Object.values(bySource).reduce((a, b) => a + b, 0);
  if (todo.length) {
    const det = Object.entries(bySource).map(([k, v]) => `${k}: ${v}`).join(", ");
    log(`libros: ${found} sinopsis encontradas de ${todo.length} buscadas${det ? ` (${det})` : ""}`);
  }
  const missing = (await db.items.where("source").equals("excel").toArray()).filter((i) => !i.synopsis && !malSeries(i, malManga));
  log(missing.length ? `libros sin sinopsis (${missing.length}): ${missing.map((i) => i.title).join(" · ")}` : "libros: todos tienen sinopsis");
}

// ---------- agrupado de tomos de manga por serie ----------

interface Entry extends Row {
  type: ItemType;
  volumes?: number;
}

// Número de tomo al final: "Blue Lock 10", "Jujutsu Kaisen vol. 3", "Jujutsu Kaisen vol 3", "Berserk #2", "Tomo 4"
const VOLUME = /\s*[-–,:]?\s*(?:vol(?:umen|ume)?\.?|tomo|t\.|n[º°o]\.?|#)?\s*\d+\s*$/i;
const VOLUME_WORD = /\s+(?:vol(?:umen|ume)?\.?|tomo)\s*$/i;

/** Título de la serie sin el número de tomo, para agrupar todos los tomos en una sola entrada. */
export function volumeBase(title: string) {
  return title.replace(VOLUME, "").replace(VOLUME_WORD, "").trim() || title.trim();
}

function groupManga(rows: Row[]): Entry[] {
  const out: Entry[] = [];
  const series = new Map<string, Row[]>();
  for (const r of rows) {
    if (!r.kind.includes("manga")) {
      out.push({ ...r, type: "book" });
      continue;
    }
    const base = volumeBase(r.title);
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
    extra: {
      author: e.author,
      pages: e.pages,
      format: e.format,
      yearRead: e.year,
      date: status === "plan" ? undefined : e.date,
      priority: status === "plan" ? e.priority : null,
      volumes: e.volumes,
    },
  }));
  // Sin buscar sinopsis ni portadas aquí (ver completarLibros); se conserva lo que ya hubiera
  await bulkUpsert(items, (item, old) => ({
    ...item,
    synopsis: old.synopsis,
    cover: old.cover,
    genres: [...item.genres, ...(old.extra.cats ?? [])],
    extra: {
      ...item.extra,
      cats: old.extra.cats,
      olChecked: old.extra.olChecked,
      lookupV: old.extra.lookupV,
      coverV: old.extra.coverV,
      synopsisSource: old.extra.synopsisSource,
      synopsisUrl: old.extra.synopsisUrl,
    },
  }));
  // Lo que ya no sale del Excel (o se ha agrupado de otra forma) se quita para que no quede repetido
  const fresh = new Set(items.map((i) => i.key));
  const stale = (await db.items.where("source").equals("excel").primaryKeys()).filter((k) => !fresh.has(k as string));
  if (stale.length) {
    await db.items.bulkDelete(stale);
    log(`libros/manga: ${stale.length} entradas antiguas quitadas (ya no están en el Excel o ahora se agrupan)`);
  }
  log(`libros/manga: ${items.length} importados. Usa «Completar datos» para buscar sinopsis y portadas.`);
}
