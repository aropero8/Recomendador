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
      extra: { year: r["Year"] ? parseInt(r["Year"], 10) : null, liked: liked.has(uri) },
    };
  });
  // Se conservan los datos de TMDB que ya hubiera
  await bulkUpsert(items, (item, old) => ({
    ...item,
    synopsis: old.synopsis,
    genres: old.genres,
    extra: { ...old.extra, ...item.extra },
  }));
  log(`películas: ${items.length} importadas. Usa «Completar datos» para traer sinopsis y géneros de TMDB.`);
}

/** Trae sinopsis, géneros, director, reparto y plataformas de TMDB. Se puede detener y reanudar. */
export async function completarPeliculas(tmdbKey: string, log: Log, stop: Stopper) {
  if (!tmdbKey) throw new Error("Falta la API key de TMDB (pestaña Ajustes).");
  const todo = (await db.items.where("source").equals("letterboxd").toArray()).filter((i) => !i.extra.tmdbDone);
  if (!todo.length) return log("películas: no queda nada por completar");
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
        extra: {
          ...it.extra,
          tmdbDone: true,
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
