import { db, type Stopper } from "../db";
import type { Settings } from "../settings";
import { markSynced, MissingSettings, summary, type SyncResult } from "../sync";
import { BOOK_SOURCES, type Log } from "../types";
import { completarLibros } from "./books";
import { portadasLibros, portadasMal } from "./covers";
import { actualizarDesdeRss, completarPeliculas } from "./letterboxd";
import { actualizarMal } from "./mal";

/** «falta en Ajustes: usuario de MyAnimeList y Client ID». */
function missing(what: string, fields: [string, boolean][]) {
  const lack = fields.filter(([, ok]) => !ok).map(([name]) => name);
  if (lack.length) throw new MissingSettings(`Para actualizar ${what} falta en Ajustes: ${lack.join(" y ")}.`);
}

/** Anime y manga (es la misma lista de MAL): aplica los cambios y busca la portada de los nuevos que no la traigan. */
export async function actualizarAnimeManga(s: Settings, log: Log, stop: Stopper): Promise<SyncResult> {
  missing("anime y manga", [
    ["usuario de MyAnimeList", !!s.malUser.trim()],
    ["Client ID de MyAnimeList", !!s.malClientId.trim()],
  ]);
  const { changes, added } = await actualizarMal(s.malUser, s.malClientId, log);
  await markSynced("mal");
  if (added.length) await portadasMal(s, log, stop, new Set(added)); // la sinopsis ya viene en la lista
  return { text: `Anime y manga: ${summary(changes)}` };
}

/** Películas: lee el RSS de Letterboxd, aplica los cambios y completa con TMDB solo las nuevas. */
export async function actualizarPeliculas(s: Settings, log: Log, stop: Stopper): Promise<SyncResult> {
  missing("películas", [["usuario de Letterboxd", !!s.letterboxdUser.trim()]]);
  const { changes, added } = await actualizarDesdeRss(s.letterboxdUser, log);
  await markSynced("letterboxd");
  const text = `Películas: ${summary(changes, true)}`;
  if (!added.length) return { text };
  if (!s.tmdbKey.trim())
    return { text: `${text}. Falta la API key de TMDB en Ajustes: las nuevas se quedan sin sinopsis ni póster.`, goSettings: true };
  await completarPeliculas(s.tmdbKey, log, stop, new Set(added));
  return { text };
}

/** Libros: busca sinopsis y portadas de los libros a los que les falten (solo la categoría Libros). */
export async function actualizarLibros(_s: Settings, log: Log, stop: Stopper): Promise<SyncResult> {
  const before = await db.items.where("source").anyOf([...BOOK_SOURCES]).filter((i) => i.type === "book").toArray();
  const only = new Set(before.filter((i) => !i.synopsis || !i.cover).map((i) => i.key));
  if (!only.size) {
    await markSynced("books");
    return { text: "Libros: no falta ninguna sinopsis ni portada" };
  }
  await completarLibros(log, stop, only);
  if (!stop.stopped) await portadasLibros(log, stop, only);
  if (!stop.stopped) await markSynced("books");

  const was = new Map(before.map((i) => [i.key, i]));
  const after = (await db.items.bulkGet([...only])).filter((i) => i != null);
  const syn = after.filter((i) => i.synopsis && !was.get(i.key)?.synopsis).length;
  const cov = after.filter((i) => i.cover && !was.get(i.key)?.cover).length;
  const parts = [
    syn && `${syn} ${syn === 1 ? "sinopsis nueva" : "sinopsis nuevas"}`,
    cov && `${cov} ${cov === 1 ? "portada nueva" : "portadas nuevas"}`,
  ].filter(Boolean);
  return { text: `Libros: ${parts.length ? parts.join(", ") : "sin cambios (no se ha encontrado nada nuevo)"}` };
}
