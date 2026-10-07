import { Capacitor } from "@capacitor/core";
import JSZip from "jszip";
import Papa from "papaparse";
import { BatchWriter, bulkUpsert, db, putInBatches, Stopper } from "../db";
import { getJson, HttpError, qs } from "../lib/http";
import { norm } from "../lib/text";
import { noChanges } from "../sync";
import type { Item, Log, Status } from "../types";

// El RSS de Letterboxd no permite CORS: en el navegador (desarrollo) pasa por el proxy de Vite (/lb-rss);
// en Android va directo (CapacitorHttp).
const LB_ORIGIN = "https://letterboxd.com";
const LB_BASE = Capacitor.isNativePlatform() ? LB_ORIGIN : "/lb-rss";
const NS_LB = "https://letterboxd.com";
const NS_TMDB = "https://themoviedb.org";

/** Clave para emparejar la misma película venga del ZIP o del RSS (que no comparten identificador). */
const titleYear = (title: string, year: unknown) => `${norm(title)}|${year ?? ""}`;

type Row = Record<string, string>;
const T = "https://api.themoviedb.org/3";

async function csv(zip: JSZip, name: string): Promise<Row[]> {
  const f = zip.file(name);
  if (!f) return [];
  return Papa.parse<Row>(await f.async("string"), { header: true, skipEmptyLines: true }).data;
}

async function findMovie(key: string, title: string, year: number | null) {
  for (const p of [{ query: title, year: year ?? undefined }, { query: title }]) {
    let js: any;
    try {
      js = await getJson(`${T}/search/movie?${qs({ api_key: key, ...p })}`, { delay: 60, strict: true });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw new Error("TMDB rechaza la API key. Revísala en Ajustes.");
      throw e;
    }
    const r = js?.results?.[0];
    if (r) return r.id as number;
  }
  return null;
}

/** Lee el ZIP y guarda todas las películas de golpe; los datos de TMDB se completan después. */
export async function importLetterboxd(file: File, log: Log) {
  const zip = await JSZip.loadAsync(file);
  const [ratings, watched, watchlist, likes] = await Promise.all([
    csv(zip, "ratings.csv"),
    csv(zip, "watched.csv"),
    csv(zip, "watchlist.csv"),
    csv(zip, "likes/films.csv"),
  ]);

  const score = new Map<string, number>();
  for (const r of ratings) {
    const v = parseFloat(r["Rating"]);
    if (!isNaN(v)) score.set(r["Letterboxd URI"], v * 2); // 0.5-5 -> 1-10
  }
  const liked = new Set(likes.map((r) => r["Letterboxd URI"]));
  const films = [
    ...watched.map((r) => ({ r, status: "read" as Status })),
    ...watchlist.map((r) => ({ r, status: "plan" as Status })),
  ];

  // Películas añadidas antes desde el RSS (clave con el id de TMDB): se reutiliza su clave para no repetirlas
  const existing = await db.items.where("source").equals("letterboxd").toArray();
  const keys = new Set(existing.map((i) => i.key));
  const fromRss = new Map(existing.filter((i) => i.key.startsWith("movie:lb:tmdb")).map((i) => [titleYear(i.title, i.extra.year), i.key]));

  const items: Item[] = films.map(({ r, status }) => {
    const uri = r["Letterboxd URI"];
    const zipKey = `movie:lb:${uri.split("/").pop()}`;
    const year = r["Year"] ? parseInt(r["Year"], 10) : null;
    return {
      key: keys.has(zipKey) ? zipKey : fromRss.get(titleYear(r["Name"], year)) ?? zipKey,
      source: "letterboxd",
      type: "movie",
      title: r["Name"],
      synopsis: "",
      genres: [],
      userScore: score.get(uri) ?? null,
      status,
      extra: { year, liked: liked.has(uri), date: r["Date"] || undefined },
    };
  });
  // Se conservan los datos de TMDB que ya hubiera
  await bulkUpsert(items, (item, old) => ({
    ...item,
    synopsis: old.synopsis,
    genres: old.genres,
    cover: old.cover,
    extra: { ...old.extra, ...item.extra },
  }));
  log(`películas: ${items.length} importadas. Usa «Completar datos» para traer sinopsis, géneros y pósters de TMDB.`);
}

// ---------- RSS ----------

export interface RssFilm {
  tmdbId: number;
  title: string;
  year: number | null;
  rating: number | null; // 0-10
  date?: string; // watchedDate
  liked: boolean;
}

/**
 * Lee el RSS público de un usuario (las últimas ~50 entradas del diario). Las listas y otras
 * entradas sin película se saltan; si una película sale varias veces (vuelta a verla) queda la más
 * reciente, y la nota de la última entrada que la tenga.
 */
export async function leerRss(user: string): Promise<RssFilm[]> {
  const u = user.trim().replace(/^https?:\/\/(www\.)?letterboxd\.com\//, "").replace(/^@/, "").split("/")[0];
  if (!u) throw new Error("Falta tu usuario de Letterboxd (Ajustes).");
  let r: Response;
  try {
    r = await fetch(`${LB_BASE}/${encodeURIComponent(u)}/rss/`);
  } catch {
    throw new Error("No se pudo conectar con Letterboxd.");
  }
  if (r.status === 404) throw new Error(`Letterboxd no encuentra el usuario «${u}». Revísalo en Ajustes.`);
  if (!r.ok) throw new Error(`Letterboxd responde ${r.status}. Prueba más tarde.`);
  const xml = new DOMParser().parseFromString(await r.text(), "application/xml");
  if (xml.getElementsByTagName("parsererror").length || !xml.getElementsByTagName("channel").length)
    throw new Error("El RSS de Letterboxd no tiene el formato esperado.");

  const text = (el: Element, ns: string, tag: string) => el.getElementsByTagNameNS(ns, tag)[0]?.textContent?.trim() ?? "";
  const films = new Map<number, RssFilm>();
  for (const it of Array.from(xml.getElementsByTagName("item"))) {
    const tmdbId = parseInt(text(it, NS_TMDB, "movieId"), 10);
    if (!tmdbId) continue;
    const stars = parseFloat(text(it, NS_LB, "memberRating"));
    const f: RssFilm = {
      tmdbId,
      title: text(it, NS_LB, "filmTitle"),
      year: parseInt(text(it, NS_LB, "filmYear"), 10) || null,
      rating: isNaN(stars) ? null : stars * 2, // 0,5-5 estrellas -> 1-10
      date: text(it, NS_LB, "watchedDate") || undefined,
      liked: text(it, NS_LB, "memberLike") === "Yes",
    };
    const prev = films.get(tmdbId);
    if (!prev || (f.date ?? "") > (prev.date ?? "")) films.set(tmdbId, { ...f, rating: f.rating ?? prev?.rating ?? null });
    else if (prev.rating == null) prev.rating = f.rating;
  }
  return [...films.values()];
}

/**
 * Aplica el RSS: añade las películas nuevas, actualiza la nota de las que ya estén y pasa a vistas
 * las que estuvieran en la watchlist. No toca sinopsis, géneros ni portadas.
 */
export async function actualizarDesdeRss(user: string, log: Log) {
  const films = await leerRss(user);
  log(`películas: ${films.length} en el RSS de Letterboxd`);
  const all = await db.items.where("source").equals("letterboxd").toArray();
  const byTmdb = new Map(all.filter((i) => i.extra.tmdbId).map((i) => [i.extra.tmdbId as number, i]));
  const byTitle = new Map(all.map((i) => [titleYear(i.title, i.extra.year), i]));
  const changes = noChanges();
  const added: string[] = [];
  const out: Item[] = [];
  for (const f of films) {
    const o = byTmdb.get(f.tmdbId) ?? byTitle.get(titleYear(f.title, f.year));
    if (!o) {
      const key = `movie:lb:tmdb${f.tmdbId}`;
      added.push(key);
      out.push({
        key,
        source: "letterboxd",
        type: "movie",
        title: f.title,
        synopsis: "",
        genres: [],
        userScore: f.rating,
        status: "read",
        extra: { year: f.year, tmdbId: f.tmdbId, date: f.date, liked: f.liked },
      });
      continue;
    }
    const upd: Item = { ...o, extra: { ...o.extra, tmdbId: o.extra.tmdbId ?? f.tmdbId, liked: f.liked || !!o.extra.liked } };
    let changed = upd.extra.tmdbId !== o.extra.tmdbId || upd.extra.liked !== !!o.extra.liked;
    if (f.rating != null && f.rating !== o.userScore) {
      upd.userScore = f.rating;
      changes.scores++;
      changed = true;
    }
    if (o.status !== "read") {
      upd.status = "read"; // estaba en la watchlist y ya la has visto
      changes.statuses++;
      changed = true;
    }
    if (f.date && (!o.extra.date || f.date > o.extra.date)) {
      upd.extra.date = f.date;
      changed = true;
    }
    if (changed) out.push(upd);
  }
  await putInBatches(out);
  changes.added = added.length;
  return { changes, added };
}

const poster = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);

/** Películas ya completadas antes de guardar pósters: solo se pide /movie/{tmdbId}, sin volver a buscarlas. */
export async function completarPosters(tmdbKey: string, todo: Item[], log: Log, stop: Stopper) {
  log(`películas: buscando el póster de ${todo.length} ya completadas`);
  const out = new BatchWriter();
  let found = 0;
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return false;
      let d: any = null;
      try {
        d = await getJson(`${T}/movie/${it.extra.tmdbId}?${qs({ api_key: tmdbKey })}`, { delay: 60, strict: true });
      } catch (e) {
        if (e instanceof HttpError && e.status === 401) throw new Error("TMDB rechaza la API key. Revísala en Ajustes.");
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      const cover = poster(d?.poster_path);
      if (cover) found++;
      await out.put({ ...it, cover, extra: { ...it.extra, posterChecked: true } });
      if ((n + 1) % 50 === 0 || n + 1 === todo.length) log(`películas: pósters ${n + 1}/${todo.length} (${found} encontrados)`);
    }
    return true;
  } finally {
    await out.flush();
  }
}

/**
 * Trae sinopsis, géneros, póster, director, reparto y plataformas de TMDB. Se puede detener y
 * reanudar. Con `only` se limita a esas películas (las nuevas de una actualización).
 */
export async function completarPeliculas(tmdbKey: string, log: Log, stop: Stopper, only?: Set<string>) {
  if (!tmdbKey) throw new Error("Falta la API key de TMDB (pestaña Ajustes).");
  const all = (await db.items.where("source").equals("letterboxd").toArray()).filter((i) => !only || only.has(i.key));
  const posters = all.filter((i) => i.extra.tmdbDone && i.extra.tmdbId && !i.cover && !i.extra.posterChecked);
  const todo = all.filter((i) => !i.extra.tmdbDone);
  if (!todo.length && !posters.length) return log("películas: no queda nada por completar");
  if (posters.length && !(await completarPosters(tmdbKey, posters, log, stop)))
    return log("películas: detenido. Pulsa de nuevo para reanudar.");
  if (!todo.length) return;
  log(`películas: completando ${todo.length} con TMDB`);

  const out = new BatchWriter();
  let found = 0;
  try {
    for (const [n, it] of todo.entries()) {
      if (stop.stopped) return log(`películas: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
      // Si ya se sabe su id de TMDB (las que vienen del RSS) no hace falta buscarla
      const id: number | null = it.extra.tmdbId ?? (await findMovie(tmdbKey, it.title, it.extra.year));
      const d =
        id &&
        (await getJson(
          `${T}/movie/${id}?${qs({ api_key: tmdbKey, language: "en-US", append_to_response: "credits,watch/providers" })}`,
          { delay: 60 },
        ));
      if (d) {
        found++;
        await out.put({
          ...it,
          synopsis: d.overview ?? "",
          genres: (d.genres ?? []).map((g: any) => g.name),
          cover: poster(d.poster_path),
          extra: {
            ...it.extra,
            tmdbDone: true,
            posterChecked: true,
            tmdbId: id,
            director: (d.credits?.crew ?? []).filter((c: any) => c.job === "Director").map((c: any) => c.name).join(", "),
            cast: (d.credits?.cast ?? []).slice(0, 5).map((c: any) => c.name),
            providersEs: (d["watch/providers"]?.results?.ES?.flatrate ?? []).map((p: any) => p.provider_name),
          },
        });
      } else {
        await out.put({ ...it, extra: { ...it.extra, tmdbDone: true } });
      }
      if ((n + 1) % 10 === 0 || n + 1 === todo.length) log(`películas: ${n + 1}/${todo.length} (${found} encontradas en TMDB)`);
    }
  } finally {
    await out.flush();
  }
}
