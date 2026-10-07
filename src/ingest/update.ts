import { isQuotaError, type Stopper } from "../db";
import type { Settings } from "../settings";
import { markSynced, summary } from "../sync";
import type { Log } from "../types";
import { portadasMal } from "./covers";
import { actualizarDesdeRss, completarPeliculas } from "./letterboxd";
import { actualizarMal } from "./mal";

/** Anime y manga: lee tu lista de MAL, aplica los cambios y busca la portada de los nuevos que no la traigan. */
export async function actualizarAnimeManga(s: Settings, log: Log, stop: Stopper) {
  const { changes, added } = await actualizarMal(s.malUser, s.malClientId, log);
  await markSynced("mal");
  if (added.length) await portadasMal(s, log, stop, new Set(added)); // la sinopsis ya viene en la lista
  const res = `Anime y manga: ${summary(changes)}`;
  log(res);
  return res;
}

/** Películas: lee el RSS de Letterboxd, aplica los cambios y completa con TMDB solo las nuevas. */
export async function actualizarPeliculas(s: Settings, log: Log, stop: Stopper) {
  if (!s.letterboxdUser.trim()) throw new Error("Pon tu usuario de Letterboxd en Ajustes (o sube el ZIP en Datos).");
  const { changes, added } = await actualizarDesdeRss(s.letterboxdUser, log);
  await markSynced("letterboxd");
  if (added.length) {
    if (s.tmdbKey) await completarPeliculas(s.tmdbKey, log, stop, new Set(added));
    else log("películas: sin la API key de TMDB las nuevas se quedan sin sinopsis ni póster (Ajustes).");
  }
  const res = `Películas: ${summary(changes)}`;
  log(res);
  return res;
}

/** «Actualizar todo»: cada fuente configurada; si una falla se apunta y se sigue con la otra. */
export async function actualizarTodo(s: Settings, log: Log, stop: Stopper) {
  const steps: [boolean, string, () => Promise<string>][] = [
    [!!(s.malUser && s.malClientId), "Anime y manga", () => actualizarAnimeManga(s, log, stop)],
    [!!s.letterboxdUser, "Películas", () => actualizarPeliculas(s, log, stop)],
  ];
  const todo = steps.filter(([ok]) => ok);
  if (!todo.length) throw new Error("No hay nada que actualizar: pon tu usuario de MAL (con el Client ID) o de Letterboxd en Ajustes.");
  const out: string[] = [];
  for (const [, name, fn] of todo) {
    if (stop.stopped) break;
    try {
      out.push(await fn());
    } catch (e: any) {
      if (isQuotaError(e)) throw e; // sin espacio no tiene sentido seguir
      out.push(`${name}: ${e?.message ?? e}`);
      log(`${name}: ${e?.message ?? e}`);
    }
  }
  return out.join(" · ");
}
