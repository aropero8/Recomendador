import { apiGet, cleanTitle, englishTitle, firstAuthor, OL, olBestCover, olCover, olSearch, titleMatch, wikiThumb } from "../ingest/books";
import { malGet, malPicture } from "../ingest/mal";
import { getJson, HttpError, qs } from "../lib/http";
import type { Settings } from "../settings";
import type { Item } from "../types";

/** Una portada posible para elegir a mano. */
export interface Candidate {
  url: string;
  label: string;
}

const T = "https://api.themoviedb.org/3";
const tmdbImg = (path?: string | null) => (path ? `https://image.tmdb.org/t/p/w342${path}` : undefined);
const LANG: Record<string, string> = { es: "en español", en: "en inglés" };
const MAX = 24;

async function tmdb(path: string, key: string) {
  try {
    return await getJson(`${T}${path}${path.includes("?") ? "&" : "?"}${qs({ api_key: key })}`, { strict: true });
  } catch (e) {
    if (e instanceof HttpError && e.status === 401) throw new Error("TMDB rechaza la API key. Revísala en Ajustes.");
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

/** Películas: todos los pósters de TMDB (primero en español) o, si no se encontró la película, los de una búsqueda. */
async function peliculas(it: Item, s: Settings): Promise<Candidate[]> {
  if (!s.tmdbKey) throw new Error("Para buscar pósters hace falta la API key de TMDB (Ajustes).");
  const out: Candidate[] = [];
  if (it.extra.tmdbId) {
    const js = await tmdb(`/movie/${it.extra.tmdbId}/images?include_image_language=es,en,null`, s.tmdbKey);
    const rank = (l: string | null) => (l === "es" ? 0 : l === "en" ? 1 : 2);
    for (const p of [...(js?.posters ?? [])].sort((a: any, b: any) => rank(a.iso_639_1) - rank(b.iso_639_1))) {
      const url = tmdbImg(p.file_path);
      if (url) out.push({ url, label: p.iso_639_1 ? `Póster ${LANG[p.iso_639_1] ?? p.iso_639_1}` : "Póster sin texto" });
    }
  }
  if (out.length < 4) {
    const js = await tmdb(`/search/movie?${qs({ query: it.title, year: it.extra.year ?? undefined })}`, s.tmdbKey);
    for (const r of (js?.results ?? []).slice(0, 8)) {
      const url = tmdbImg(r.poster_path);
      if (url) out.push({ url, label: `${r.title}${r.release_date ? ` (${r.release_date.slice(0, 4)})` : ""}` });
    }
  }
  return out;
}

/** Anime y manga: la portada y las imágenes extra de MAL; si no está en tu lista, una búsqueda en MAL. */
async function mal(it: Item, s: Settings): Promise<Candidate[]> {
  if (!s.malClientId) throw new Error("Para buscar en MyAnimeList hace falta el Client ID (Ajustes).");
  const out: Candidate[] = [];
  if (it.extra.malId) {
    const js = await malGet(`/v2/${it.type}/${it.extra.malId}?fields=main_picture,pictures`, s.malClientId);
    const pics = [js?.main_picture, ...(js?.pictures ?? [])].filter(Boolean);
    pics.forEach((p: any, n: number) => {
      const url = p.large ?? p.medium;
      if (url) out.push({ url, label: n === 0 ? "Portada de MAL" : `Imagen ${n + 1} de MAL` });
    });
  }
  if (out.length < 4 && it.type === "manga") {
    const q = cleanTitle(it.title);
    if (q.length >= 3) {
      const js = await malGet(`/v2/manga?${qs({ q, limit: 8, fields: "main_picture" })}`, s.malClientId);
      for (const { node } of js?.data ?? []) {
        const url = malPicture(node);
        if (url) out.push({ url, label: node.title });
      }
    }
  }
  return out;
}

/**
 * Libros (y manga del Excel): portadas de Open Library de la obra y de sus ediciones (primero las
 * españolas) y la miniatura de Wikipedia. Open Library va a una petición por segundo.
 */
async function libros(it: Item): Promise<Candidate[]> {
  const title = cleanTitle(it.title);
  const author = firstAuthor(it);
  const out: Candidate[] = [];
  if (it.extra.synopsisUrl) {
    const t = await wikiThumb(it.extra.synopsisUrl).catch(() => undefined);
    if (t) out.push({ url: t, label: "Wikipedia" });
  }
  // La misma comparación que «Descargar portadas» (título de la obra o de la edición); si no sale
  // ninguna portada, también con el título en inglés de Wikipedia y con la búsqueda general
  let docs = await olSearch(title, author, "campos");
  const esUrl: string | undefined = it.extra.synopsisUrl;
  if (!olBestCover(docs) && esUrl?.startsWith("https://es.wikipedia.org/")) {
    const en = await englishTitle(esUrl).catch(() => undefined);
    if (en && titleMatch(en, title) !== 2) docs = [...docs, ...(await olSearch(en, author, "campos"))];
  }
  if (!olBestCover(docs)) docs = [...docs, ...(await olSearch(title, author, "general"))];
  const byWho = (d: any) => (d.author_name?.length ? `, ${d.author_name[0]}` : "");
  // Primero las ediciones en español que han coincidido con la búsqueda, después cada obra y sus otras ediciones
  for (const d of docs)
    for (const e of d.editions?.docs ?? []) {
      const url = (e.language ?? []).includes("spa") ? olCover(e.cover_i) : undefined;
      if (url) out.push({ url, label: `Edición en español: ${e.title}${byWho(d)}` });
    }
  for (const d of docs) {
    const url = olCover(d.cover_i);
    if (url) out.push({ url, label: `${d.title}${byWho(d)}` });
    for (const e of d.editions?.docs ?? []) {
      const eu = olCover(e.cover_i);
      if (eu) out.push({ url: eu, label: `Edición: ${e.title}${byWho(d)}` });
    }
  }
  // Ediciones de la obra más parecida: suele haber portadas de ediciones en español
  const work = docs[0]?.key;
  if (work) {
    const js = await apiGet(`${OL}${work}/editions.json?limit=50`);
    const eds = ((js?.entries ?? []) as any[]).filter((e) => e.covers?.some((c: number) => c > 0));
    const spa = (e: any) => (e.languages ?? []).some((l: any) => l.key === "/languages/spa");
    eds.sort((a, b) => Number(spa(b)) - Number(spa(a)));
    for (const e of eds) {
      const url = olCover(e.covers.find((c: number) => c > 0));
      if (url) out.push({ url, label: `${spa(e) ? "Edición en español" : "Edición"}${e.publishers?.[0] ? `, ${e.publishers[0]}` : ""}${e.publish_date ? ` (${e.publish_date})` : ""}` });
    }
  }
  return out;
}

/** Portadas posibles para un título, sin repetir y como mucho MAX. */
export async function buscarCandidatas(it: Item, s: Settings): Promise<Candidate[]> {
  const found =
    it.type === "movie"
      ? await peliculas(it, s)
      : it.source === "mal"
        ? await mal(it, s)
        : it.type === "manga"
          ? [...(s.malClientId ? await mal(it, s).catch(() => []) : []), ...(await libros(it))]
          : await libros(it);
  const seen = new Set<string>(it.cover ? [it.cover] : []);
  return found.filter((c) => !seen.has(c.url) && seen.add(c.url)).slice(0, MAX);
}
