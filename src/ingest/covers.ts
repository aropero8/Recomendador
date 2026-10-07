import { db, Stopper } from "../db";
import { qs } from "../lib/http";
import type { Settings } from "../settings";
import { ITEM_TYPES, Log, TYPE_LABEL } from "../types";
import { buscarPortadaLibro, cleanTitle, malSeries, titleMatch } from "./books";
import { completarPeliculas, completarPosters } from "./letterboxd";
import { importMal, malGet, malPicture } from "./mal";

// Versión de la búsqueda de portadas del Excel: lo marcado con otra versión se vuelve a intentar
const COVER_V = 2;

/** Ejecuta un paso; si falla (clave mal puesta, sin conexión...) lo apunta y deja seguir con el siguiente. */
export async function step(name: string, log: Log, stop: Stopper, fn: () => Promise<unknown>) {
  if (stop.stopped) return;
  try {
    await fn();
  } catch (e: any) {
    log(`${name}: ${e?.message ?? e} Sigo con lo demás.`);
  }
}

/** Portadas de Open Library guardadas sin ?default=false (versiones anteriores): se corrigen sin peticiones. */
export async function arreglarUrlsOpenLibrary() {
  const fix = (await db.items.toArray()).filter((i) => i.cover?.startsWith("https://covers.openlibrary.org/") && !i.cover.includes("default=false"));
  if (fix.length) await db.items.bulkPut(fix.map((i) => ({ ...i, cover: `${i.cover}?default=false` })));
}

/** Anime y manga de tu lista de MAL sin portada: se vuelve a pedir (MAL es rápido, sin límite de 1/s). */
export async function portadasMal(s: Settings, log: Log, stop: Stopper) {
  let todo = (await db.items.where("source").equals("mal").toArray()).filter((i) => !i.cover);
  if (!todo.length) return;
  if (!s.malUser || !s.malClientId) return log(`MAL: ${todo.length} sin portada. Pon tu usuario y Client ID en Ajustes.`);
  // Importados antes de guardar portadas: releer las listas es más rápido (una petición por cada 1.000)
  if (todo.some((i) => !i.extra.coverChecked)) {
    log("MAL: vuelvo a leer tus listas para traer las portadas");
    await importMal(s.malUser, s.malClientId, log);
    todo = (await db.items.where("source").equals("mal").toArray()).filter((i) => !i.cover);
    if (!todo.length) return;
  }
  log(`MAL: pidiendo la portada de ${todo.length} títulos uno a uno`);
  let found = 0;
  for (const [n, it] of todo.entries()) {
    if (stop.stopped) return log(`MAL: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
    const cover = malPicture(await malGet(`/v2/${it.type}/${it.extra.malId}?fields=main_picture`, s.malClientId));
    if (cover) {
      found++;
      await db.items.update(it.key, { cover });
    }
    if ((n + 1) % 20 === 0 || n + 1 === todo.length) log(`MAL: ${n + 1}/${todo.length} (${found} portadas)`);
  }
}

/**
 * Manga del Excel: si la serie está en tu lista de MAL se copia su portada; si no, se busca en
 * MAL (/v2/manga?q=) y se usa la del resultado cuyo título coincida.
 */
export async function portadasMangaExcel(s: Settings, log: Log, stop: Stopper) {
  const all = await db.items.toArray();
  const malManga = all.filter((i) => i.source === "mal" && i.type === "manga");
  const mangas = all.filter((i) => i.source === "excel" && i.type === "manga" && !i.cover);

  let copied = 0;
  for (const it of mangas) {
    const cover = malSeries(it, malManga)?.cover;
    if (cover) {
      copied++;
      await db.items.update(it.key, { cover });
    }
  }
  if (copied) log(`manga: ${copied} portadas copiadas de tu lista de MAL`);

  const todo = mangas.filter((i) => !malSeries(i, malManga) && i.extra.malSearchV !== COVER_V);
  if (!todo.length) return;
  if (!s.malClientId) return log(`manga: ${todo.length} series sin portada. Pon el Client ID de MAL en Ajustes para buscarlas.`);
  log(`manga: buscando ${todo.length} series en MAL`);
  let found = 0;
  for (const [n, it] of todo.entries()) {
    if (stop.stopped) return log(`manga: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
    const q = cleanTitle(it.title);
    let best: any;
    if (q.length >= 3) {
      // MAL exige al menos 3 caracteres en la búsqueda
      const js = await malGet(`/v2/manga?${qs({ q, limit: 3, fields: "alternative_titles,main_picture" })}`, s.malClientId);
      best = ((js?.data ?? []) as any[])
        .map(({ node }) => {
          const alt = node.alternative_titles ?? {};
          const titles: string[] = [node.title, alt.en, alt.ja, ...(alt.synonyms ?? [])].filter(Boolean);
          return { node, m: Math.max(0, ...titles.map((t) => titleMatch(q, t))) };
        })
        .filter((x) => x.m > 0)
        .sort((a, b) => b.m - a.m)[0]?.node;
    }
    const cover = malPicture(best);
    if (cover) found++;
    await db.items.update(it.key, { cover, extra: { ...it.extra, malSearchV: COVER_V, malId: best?.id ?? it.extra.malId } });
    if ((n + 1) % 10 === 0 || n + 1 === todo.length) log(`manga: ${n + 1}/${todo.length} (${found} portadas)`);
  }
}

/** Películas: póster de TMDB para las que ya tienen tmdbId y no tienen portada; las no completadas se completan. */
export async function portadasPeliculas(s: Settings, log: Log, stop: Stopper) {
  const movies = await db.items.where("source").equals("letterboxd").toArray();
  const withId = movies.filter((i) => i.extra.tmdbId && !i.cover);
  const pending = movies.filter((i) => !i.extra.tmdbDone);
  if (!withId.length && !pending.length) return;
  if (!s.tmdbKey) return log(`películas: ${withId.length + pending.length} sin póster. Falta la API key de TMDB (Ajustes).`);
  if (withId.length && !(await completarPosters(s.tmdbKey, withId, log, stop))) return log("películas: detenido. Pulsa de nuevo para reanudar.");
  if (pending.length) await completarPeliculas(s.tmdbKey, log, stop); // incluye el póster
}

/** Libros (y mangas sin portada en MAL): Open Library y, si no, la miniatura de Wikipedia. Una petición por segundo. */
export async function portadasLibros(log: Log, stop: Stopper) {
  const todo = (await db.items.where("source").equals("excel").toArray()).filter((i) => !i.cover && i.extra.coverV !== COVER_V);
  if (!todo.length) return;
  log(`libros: buscando la portada de ${todo.length} títulos en Open Library y Wikipedia (1 petición por segundo)`);
  let found = 0;
  for (const [n, it] of todo.entries()) {
    if (stop.stopped) return log(`libros: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
    const cover = await buscarPortadaLibro(it);
    if (cover) found++;
    await db.items.update(it.key, { cover, extra: { ...it.extra, coverV: COVER_V } });
    if ((n + 1) % 5 === 0 || n + 1 === todo.length) log(`libros: portadas ${n + 1}/${todo.length} (${found} encontradas)`);
  }
}

/** Cuántas portadas faltan por categoría. */
export async function resumenPortadas(log: Log) {
  const all = await db.items.toArray();
  const parts = ITEM_TYPES.map((t) => `${TYPE_LABEL[t]} ${all.filter((i) => i.type === t && !i.cover).length}`);
  log(`Portadas que faltan: ${parts.join(" · ")}`);
}

/**
 * Botón «Descargar portadas»: solo lo que no tiene portada, de lo más rápido a lo más lento
 * (MAL, manga del Excel, películas y libros). Se puede detener y reanudar.
 */
export async function descargarPortadas(s: Settings, log: Log, stop: Stopper) {
  await arreglarUrlsOpenLibrary();
  await step("MAL", log, stop, () => portadasMal(s, log, stop));
  await step("manga", log, stop, () => portadasMangaExcel(s, log, stop));
  await step("películas", log, stop, () => portadasPeliculas(s, log, stop));
  await step("libros", log, stop, () => portadasLibros(log, stop));
  await resumenPortadas(log);
}

