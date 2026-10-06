import JSZip from "jszip";
import Papa from "papaparse";
import { db, upsert } from "../db";
import { getJson, qs } from "../lib/http";
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
    const js = await getJson(`${T}/search/movie?${qs({ api_key: key, ...p })}`, { delay: 60 });
    const r = js?.results?.[0];
    if (r) return r.id as number;
  }
  return null;
}

export async function importLetterboxd(file: File, tmdbKey: string, log: Log) {
  if (!tmdbKey) throw new Error("Falta la API key de TMDB (pestaña Ajustes).");
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

  let n = 0;
  for (const { r, status } of films) {
    const uri = r["Letterboxd URI"];
    const key = `movie:lb:${uri.split("/").pop()}`;
    const year = r["Year"] ? parseInt(r["Year"], 10) : null;
    const old = await db.items.get(key);

    let synopsis = old?.synopsis ?? "";
    let genres = old?.genres ?? [];
    let extra: Record<string, any> = old?.extra ?? {};

    if (!old || !old.synopsis) {
      const id = await findMovie(tmdbKey, r["Name"], year);
      if (id) {
        const d = await getJson(
          `${T}/movie/${id}?${qs({ api_key: tmdbKey, language: "en-US", append_to_response: "credits,watch/providers" })}`,
          { delay: 60 },
        );
        if (d) {
          synopsis = d.overview ?? "";
          genres = (d.genres ?? []).map((g: any) => g.name);
          extra = {
            tmdbId: id,
            director: (d.credits?.crew ?? []).filter((c: any) => c.job === "Director").map((c: any) => c.name).join(", "),
            cast: (d.credits?.cast ?? []).slice(0, 5).map((c: any) => c.name),
            providersEs: (d["watch/providers"]?.results?.ES?.flatrate ?? []).map((p: any) => p.provider_name),
          };
        }
      }
    }

    const item: Item = {
      key,
      source: "letterboxd",
      type: "movie",
      title: r["Name"],
      synopsis,
      genres,
      userScore: score.get(uri) ?? null,
      status,
      extra: { ...extra, year, liked: liked.has(uri) },
    };
    await upsert(item);
    if (++n % 25 === 0) log(`películas: ${n}/${films.length}`);
  }
  log(`películas: ${films.length} importadas`);
}
