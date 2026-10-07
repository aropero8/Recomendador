import JSZip from "jszip";
import Papa from "papaparse";
import { bulkUpsert, db, Stopper } from "../db";
import { getJson, HttpError, qs } from "../lib/http";
import type { Item, Log, Status } from "../types";

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

  const items: Item[] = films.map(({ r, status }) => {
    const uri = r["Letterboxd URI"];
    return {
      key: `movie:lb:${uri.split("/").pop()}`,
      source: "letterboxd",
      type: "movie",
      title: r["Name"],
      synopsis: "",
      genres: [],
      userScore: score.get(uri) ?? null,
      status,
      extra: { year: r["Year"] ? parseInt(r["Year"], 10) : null, liked: liked.has(uri), date: r["Date"] || undefined },
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

const poster = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);

/** Películas ya completadas antes de guardar pósters: solo se pide /movie/{tmdbId}, sin volver a buscarlas. */
export async function completarPosters(tmdbKey: string, todo: Item[], log: Log, stop: Stopper) {
  log(`películas: buscando el póster de ${todo.length} ya completadas`);
  let found = 0;
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
    await db.items.update(it.key, { cover, extra: { ...it.extra, posterChecked: true } });
    if ((n + 1) % 50 === 0 || n + 1 === todo.length) log(`películas: pósters ${n + 1}/${todo.length} (${found} encontrados)`);
  }
  return true;
}

/** Trae sinopsis, géneros, póster, director, reparto y plataformas de TMDB. Se puede detener y reanudar. */
export async function completarPeliculas(tmdbKey: string, log: Log, stop: Stopper) {
  if (!tmdbKey) throw new Error("Falta la API key de TMDB (pestaña Ajustes).");
  const all = await db.items.where("source").equals("letterboxd").toArray();
  const posters = all.filter((i) => i.extra.tmdbDone && i.extra.tmdbId && !i.cover && !i.extra.posterChecked);
  const todo = all.filter((i) => !i.extra.tmdbDone);
  if (!todo.length && !posters.length) return log("películas: no queda nada por completar");
  if (posters.length && !(await completarPosters(tmdbKey, posters, log, stop)))
    return log("películas: detenido. Pulsa de nuevo para reanudar.");
  if (!todo.length) return;
  log(`películas: completando ${todo.length} con TMDB`);

  let found = 0;
  for (const [n, it] of todo.entries()) {
    if (stop.stopped) return log(`películas: detenido en ${n}/${todo.length}. Pulsa de nuevo para reanudar.`);
    const id = await findMovie(tmdbKey, it.title, it.extra.year);
    const d =
      id &&
      (await getJson(
        `${T}/movie/${id}?${qs({ api_key: tmdbKey, language: "en-US", append_to_response: "credits,watch/providers" })}`,
        { delay: 60 },
      ));
    if (d) {
      found++;
      await db.items.update(it.key, {
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
        embedding: undefined,
      });
    } else {
      await db.items.update(it.key, { extra: { ...it.extra, tmdbDone: true } });
    }
    if ((n + 1) % 10 === 0 || n + 1 === todo.length) log(`películas: ${n + 1}/${todo.length} (${found} encontradas en TMDB)`);
  }
}
