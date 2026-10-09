import type { Stopper } from "../db";
import { apiGet, authorMatch, cleanTitle, OL, olBestCover, olSearch, titleMatch } from "../ingest/books";
import { malGet, malPicture } from "../ingest/mal";
import { getJson, HttpError, qs } from "../lib/http";
import { norm } from "../lib/text";
import type { Settings } from "../settings";
import { MissingSettings } from "../sync";
import type { Item, ItemType, Log } from "../types";
import type { Feedback, Suggestion } from "./gemini";

// Comprueba que cada recomendación existe de verdad (MAL, TMDB u Open Library) y trae su portada,
// enlace y sinopsis. Lo que no se encuentra con seguridad se descarta, igual que lo que ya has
// visto o leído y lo que marcaste como visto o «no me interesa».

export interface Reco {
  id: string; // tipo|título normalizado: para no repetir y para «Ya lo he visto» / «No me interesa»
  type: ItemType;
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  author?: string | null;
  reason: string;
  inPending: boolean; // está en tus pendientes
  fromMap?: boolean; // libros: sale de los candidatos de «An Ocean of Books»
  libraryKey?: string; // su ficha en tu biblioteca
  cover?: string;
  url?: string; // MAL, TMDB u Open Library
  synopsis?: string;
  source: "biblioteca" | "mal" | "tmdb" | "openlibrary";
  extId?: number | string; // id de MAL o TMDB, o clave de la obra en Open Library
}

export interface Verified {
  recos: Reco[];
  dropped: { seen: number; feedback: number; unverified: string[] };
}

export const recoId = (type: ItemType, title: string) => `${type}|${norm(cleanTitle(title)).replace(/[^a-z0-9]+/g, " ").trim()}`;

const names = (s: Suggestion) => [s.title, s.originalTitle].filter((t): t is string => !!t && !!t.trim());
const sameTitle = (a: string[], b: (string | null | undefined)[]) => a.some((x) => b.some((y) => !!y && titleMatch(cleanTitle(x), cleanTitle(y)) === 2));
const yearOk = (want: number | null | undefined, got: number | null | undefined) => !want || !got || Math.abs(want - got) <= 1;
const yearOf = (date?: string | null) => (date ? Number(String(date).slice(0, 4)) || null : null);

/** El título en tu biblioteca (mismo tipo, mismo título u original y, si se sabe, año o autor parecidos). */
function inLibrary(items: Item[], s: Suggestion) {
  return items.find(
    (i) =>
      i.type === s.type &&
      sameTitle(names(s), [i.title, ...(i.extra.altTitles ?? [])]) &&
      yearOk(s.year, i.extra.year) &&
      (!s.author || !i.extra.author || authorMatch(s.author, [i.extra.author])),
  );
}

// ---------- fuentes ----------

async function tmdb(s: Suggestion, key: string): Promise<Partial<Reco> | null> {
  if (!key) throw new MissingSettings("Para comprobar las películas recomendadas falta en Ajustes: API key de TMDB.");
  for (const q of names(s)) {
    let js: any;
    try {
      js = await getJson(`https://api.themoviedb.org/3/search/movie?${qs({ api_key: key, query: q, language: "es-ES" })}`, { delay: 60, strict: true });
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) throw new MissingSettings("TMDB rechaza la API key. Revísala en Ajustes.");
      throw e;
    }
    const r = (js?.results ?? []).find((r: any) => sameTitle(names(s), [r.title, r.original_title]) && yearOk(s.year, yearOf(r.release_date)));
    if (r)
      return {
        title: r.title,
        originalTitle: r.original_title !== r.title ? r.original_title : s.originalTitle,
        year: yearOf(r.release_date) ?? s.year,
        cover: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : undefined,
        url: `https://www.themoviedb.org/movie/${r.id}`,
        synopsis: r.overview || undefined,
        source: "tmdb",
        extId: r.id,
      };
  }
  return null;
}

async function mal(s: Suggestion, clientId: string): Promise<Partial<Reco> | null> {
  if (!clientId) throw new MissingSettings(`Para comprobar el ${s.type} recomendado falta en Ajustes: Client ID de MyAnimeList.`);
  for (const q of names(s).map((n) => cleanTitle(n).slice(0, 60)).filter((n) => n.length >= 3)) {
    const js = await malGet(`/v2/${s.type}?${qs({ q, limit: 5, fields: "alternative_titles,main_picture,synopsis,start_date" })}`, clientId);
    const hit = ((js?.data ?? []) as any[])
      .map((d) => d.node)
      .find((m) => {
        const alt = m.alternative_titles ?? {};
        return sameTitle(names(s), [m.title, alt.en, alt.ja, ...(alt.synonyms ?? [])]) && yearOk(s.year, yearOf(m.start_date));
      });
    if (hit)
      return {
        originalTitle: hit.title !== s.title ? hit.title : s.originalTitle,
        year: yearOf(hit.start_date) ?? s.year,
        cover: malPicture(hit),
        url: `https://myanimelist.net/${s.type}/${hit.id}`,
        synopsis: hit.synopsis || undefined,
        source: "mal",
        extId: hit.id,
      };
  }
  return null;
}

async function openLibrary(s: Suggestion): Promise<Partial<Reco> | null> {
  const author = s.author ?? "";
  // Título en español, después el original y, por último, la búsqueda general
  let docs: any[] = [];
  for (const [t, mode] of [...names(s).map((n) => [n, "campos"] as const), [s.title, "general"] as const]) {
    docs = (await olSearch(cleanTitle(t), author, mode)).filter((d) =>
      // con seguridad: el título de la obra o de la edición tiene que coincidir (no basta con el autor)
      sameTitle(names(s), [d.title, ...(d.editions?.docs ?? []).map((e: any) => e.title)]),
    );
    if (docs.length) break;
  }
  const doc = docs[0];
  if (!doc) return null;
  const w = await apiGet(`${OL}${doc.key}.json`);
  const desc = typeof w?.description === "object" ? w.description.value : w?.description;
  return {
    author: s.author ?? doc.author_name?.[0],
    cover: olBestCover(docs),
    url: `https://openlibrary.org${doc.key}`,
    synopsis: desc ? String(desc).trim() : undefined,
    source: "openlibrary",
    extId: doc.key,
  };
}

/**
 * Verifica las recomendaciones. `items` es tu biblioteca tal como se muestra (con las portadas
 * elegidas a mano); `feedback`, lo marcado como visto o «no me interesa».
 */
export async function verify(items: Item[], suggestions: Suggestion[], feedback: Feedback[], s: Settings, log: Log, stop: Stopper): Promise<Verified> {
  const skip = new Set(feedback.map((f) => recoId(f.type, f.title)));
  const done = new Set<string>();
  const out: Verified = { recos: [], dropped: { seen: 0, feedback: 0, unverified: [] } };

  for (const [n, sug] of suggestions.entries()) {
    if (stop.stopped) break;
    const id = recoId(sug.type, sug.title);
    if (done.has(id)) continue;
    done.add(id);
    if (skip.has(id) || (sug.originalTitle && skip.has(recoId(sug.type, sug.originalTitle)))) {
      out.dropped.feedback++;
      continue;
    }
    const base: Reco = { id, type: sug.type, title: sug.title, originalTitle: sug.originalTitle, year: sug.year, author: sug.author, reason: sug.reason, inPending: false, source: "biblioteca" };

    const lib = inLibrary(items, sug);
    if (lib && lib.status !== "plan") {
      out.dropped.seen++; // ya visto o leído
      continue;
    }
    if (lib) {
      // De tus pendientes: tu propia ficha
      out.recos.push({ ...base, title: lib.title, inPending: true, libraryKey: lib.key, cover: lib.cover, synopsis: lib.synopsis || undefined, author: lib.extra.author ?? sug.author, year: lib.extra.year ?? sug.year });
      continue;
    }

    log(`Comprobando ${n + 1}/${suggestions.length}: «${sug.title}»…`);
    const found = sug.type === "movie" ? await tmdb(sug, s.tmdbKey.trim()) : sug.type === "book" ? await openLibrary(sug) : await mal(sug, s.malClientId.trim());
    if (!found) {
      out.dropped.unverified.push(sug.title);
      continue;
    }
    out.recos.push({ ...base, ...found, id, reason: sug.reason, inPending: false });
  }
  return out;
}
