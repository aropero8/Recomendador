import { BatchWriter, db, isQuotaError, limpiarBaseDeDatos, putInBatches, quotaMessage, Stopper } from "../db";
import { qs } from "../lib/http";
import type { Settings } from "../settings";
import { ITEM_TYPES, Log, TYPE_LABEL } from "../types";
import { customCoverKeys } from "../covers/user";
import { fusionarManga } from "../merge";
import { buscarPortadaLibro, cleanTitle, malSeries, titleMatch } from "./books";
import { completarPeliculas, completarPosters } from "./letterboxd";
import { importMal, malGet, malPicture } from "./mal";

// Versiones de las búsquedas de portadas del Excel: lo marcado con otra versión se vuelve a intentar.
// COVER_V 3: Open Library también compara el título de la edición, usa el título en inglés y la búsqueda general.
const COVER_V = 3;
const MAL_SEARCH_V = 2; // búsqueda de los mangas del Excel en MAL

/**
 * Ejecuta un paso; si falla (clave mal puesta, sin conexión...) lo apunta y deja seguir con el siguiente.
 * Si el navegador se queda sin espacio no tiene sentido seguir: se explica y se detiene todo.
 */
export async function step(name: string, log: Log, stop: Stopper, fn: () => Promise<unknown>) {
  if (stop.stopped) return;
  try {
    await fn();
  } catch (e: any) {
    if (isQuotaError(e)) {
      stop.stopped = true;
      log(await quotaMessage());
    } else log(`${name}: ${e?.message ?? e} Sigo con lo demás.`);
  }
}

/** Portadas de Open Library guardadas sin ?default=false (versiones anteriores): se corrigen sin peticiones. */
export async function arreglarUrlsOpenLibrary() {
  const fix = (await db.items.toArray()).filter((i) => i.cover?.startsWith("https://covers.openlibrary.org/") && !i.cover.includes("default=false"));
  if (fix.length) await putInBatches(fix.map((i) => ({ ...i, cover: `${i.cover}?default=false` })));
}

/** Anime y manga de tu lista de MAL sin portada: se vuelve a pedir (MAL es rápido, sin límite de 1/s). */
export async function portadasMal(s: Settings, log: Log, stop: Stopper) {
  const custom = await customCoverKeys();
  let todo = (await db.items.where("source").equals("mal").toArray()).filter((i) => !i.cover && !custom.has(i.key));
  if (!todo.length) return;
  if (!s.malUser || !s.malClientId) return log(`MAL: ${todo.length} sin portada. Pon tu usuario y Client ID en Ajustes.`);
  // Importados antes de guardar portadas: releer las listas es más rápido (una petición por cada 1.000)
  if (todo.some((i) => !i.extra.coverChecked)) {
    log("MAL: vuelvo a leer tus listas para traer las portadas");
    await importMal(s.malUser, s.malClientId, log);
    todo = (await db.items.where("source").equals("mal").toArray()).filter((i) => !i.cover && !custom.has(i.key));
    if (!todo.length) return;
  }
  log(`MAL: pidiendo la portada de ${todo.length} títulos uno a uno`);
  const out = new BatchWriter();
  let found = 0;
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return log(`MAL: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
      const cover = malPicture(await malGet(`/v2/${it.type}/${it.extra.malId}?fields=main_picture`, s.malClientId));
      if (cover) {
        found++;
        await out.put({ ...it, cover });
      }
      if ((n + 1) % 20 === 0 || n + 1 === todo.length) log(`MAL: ${n + 1}/${todo.length} (${found} portadas)`);
    }
  } finally {
    await out.flush();
  }
}

/**
 * Manga del Excel: si la serie está en tu lista de MAL se copia su portada; si no, se busca en
 * MAL (/v2/manga?q=) y se usa la del resultado cuyo título coincida.
 */
export async function portadasMangaExcel(s: Settings, log: Log, stop: Stopper) {
  const all = await db.items.toArray();
  const malManga = all.filter((i) => i.source === "mal" && i.type === "manga");
  const custom = await customCoverKeys();
  const mangas = all.filter((i) => i.source === "excel" && i.type === "manga" && !i.cover && !custom.has(i.key));

  const copies = mangas.flatMap((it) => {
    const cover = malSeries(it, malManga)?.cover;
    return cover ? [{ ...it, cover }] : [];
  });
  await putInBatches(copies);
  const copied = copies.length;
  if (copied) log(`manga: ${copied} portadas copiadas de tu lista de MAL`);

  const todo = mangas.filter((i) => !malSeries(i, malManga) && i.extra.malSearchV !== MAL_SEARCH_V);
  if (!todo.length) return;
  if (!s.malClientId) return log(`manga: ${todo.length} series sin portada. Pon el Client ID de MAL en Ajustes para buscarlas.`);
  log(`manga: buscando ${todo.length} series en MAL`);
  const out = new BatchWriter();
  let found = 0;
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return log(`manga: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
      const best = await buscarMangaEnMal(it.title, s.malClientId);
      const cover = malPicture(best);
      if (cover) found++;
      await out.put({ ...it, cover, extra: { ...it.extra, malSearchV: MAL_SEARCH_V, malId: best?.id ?? it.extra.malId } });
      if ((n + 1) % 10 === 0 || n + 1 === todo.length) log(`manga: ${n + 1}/${todo.length} (${found} portadas)`);
    }
  } finally {
    await out.flush();
  }
}

/** Busca una serie en MAL y devuelve el resultado cuyo título (o título alternativo) coincide; exacto mejor que parcial. */
async function buscarMangaEnMal(title: string, clientId: string) {
  const q = cleanTitle(title);
  if (q.length < 3) return undefined; // MAL exige al menos 3 caracteres en la búsqueda
  const js = await malGet(`/v2/manga?${qs({ q, limit: 3, fields: "alternative_titles,main_picture" })}`, clientId);
  return ((js?.data ?? []) as any[])
    .map(({ node }) => {
      const alt = node.alternative_titles ?? {};
      const titles: string[] = [node.title, alt.en, alt.ja, ...(alt.synonyms ?? [])].filter(Boolean);
      return { node, m: Math.max(0, ...titles.map((t) => titleMatch(q, t))) };
    })
    .filter((x) => x.m > 0)
    .sort((a, b) => b.m - a.m)[0]?.node;
}

/** Películas: póster de TMDB para las que ya tienen tmdbId y no tienen portada; las no completadas se completan. */
export async function portadasPeliculas(s: Settings, log: Log, stop: Stopper) {
  const custom = await customCoverKeys();
  const movies = (await db.items.where("source").equals("letterboxd").toArray()).filter((i) => !custom.has(i.key));
  const withId = movies.filter((i) => i.extra.tmdbId && !i.cover);
  const pending = movies.filter((i) => !i.extra.tmdbDone);
  if (!withId.length && !pending.length) return;
  if (!s.tmdbKey) return log(`películas: ${withId.length + pending.length} sin póster. Falta la API key de TMDB (Ajustes).`);
  if (withId.length && !(await completarPosters(s.tmdbKey, withId, log, stop))) return log("películas: detenido. Pulsa de nuevo para reanudar.");
  if (pending.length) await completarPeliculas(s.tmdbKey, log, stop); // incluye el póster
}

/** Libros (y mangas sin portada en MAL): Open Library y, si no, la miniatura de Wikipedia. Una petición por segundo. */
export async function portadasLibros(log: Log, stop: Stopper) {
  const custom = await customCoverKeys();
  const todo = (await db.items.where("source").equals("excel").toArray()).filter((i) => !i.cover && !custom.has(i.key) && i.extra.coverV !== COVER_V);
  if (!todo.length) return;
  log(`libros: buscando la portada de ${todo.length} títulos en Open Library y Wikipedia (1 petición por segundo)`);
  const out = new BatchWriter();
  let found = 0;
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return log(`libros: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
      const cover = await buscarPortadaLibro(it);
      if (cover) found++;
      await out.put({ ...it, cover, extra: { ...it.extra, coverV: COVER_V } });
      if ((n + 1) % 5 === 0 || n + 1 === todo.length) log(`libros: portadas ${n + 1}/${todo.length} (${found} encontradas)`);
    }
  } finally {
    await out.flush();
  }
  // Como en la app: los mangas del Excel que se muestran fusionados con MAL no cuentan
  const sin = fusionarManga(await db.items.toArray()).filter((i) => i.source === "excel" && !i.cover && !custom.has(i.key));
  log(sin.length ? `libros sin portada (${sin.length}): ${sin.map((i) => i.title).join(" · ")}` : "libros: todos tienen portada");
}

/** Cuántas portadas faltan por categoría. */
export async function resumenPortadas(log: Log) {
  const custom = await customCoverKeys();
  const all = fusionarManga(await db.items.toArray()).filter((i) => !custom.has(i.key));
  const parts = ITEM_TYPES.map((t) => `${TYPE_LABEL[t]} ${all.filter((i) => i.type === t && !i.cover).length}`);
  log(`Portadas que faltan: ${parts.join(" · ")}. Las que no aparezcan se pueden poner a mano desde la ficha («Poner portada»).`);
}

/**
 * Botón «Descargar portadas»: solo lo que no tiene portada, de lo más rápido a lo más lento
 * (MAL, manga del Excel, películas y libros). Se puede detener y reanudar.
 */
export async function descargarPortadas(s: Settings, log: Log, stop: Stopper) {
  await step("limpieza", log, stop, () => limpiarBaseDeDatos(log));
  await step("limpieza", log, stop, arreglarUrlsOpenLibrary);
  await step("MAL", log, stop, () => portadasMal(s, log, stop));
  await step("manga", log, stop, () => portadasMangaExcel(s, log, stop));
  await step("películas", log, stop, () => portadasPeliculas(s, log, stop));
  await step("libros", log, stop, () => portadasLibros(log, stop));
  await resumenPortadas(log);
}

