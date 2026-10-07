import { db, Stopper } from "../db";
import type { Settings } from "../settings";
import type { Log } from "../types";
import { completarLibros } from "./books";
import { completarPeliculas } from "./letterboxd";
import { importMal } from "./mal";

/**
 * Botón «Completar datos»: busca lo que falte, de lo más rápido a lo más lento.
 * 1. Portadas de MAL: vuelve a leer las listas (son pocas peticiones).
 * 2. Películas: sinopsis, géneros y póster de TMDB (necesita la API key).
 * 3. Libros: sinopsis y portadas (Wikipedia y Open Library, una petición por segundo).
 * Cada paso es independiente: si uno falla (clave mal puesta, sin conexión...) se apunta y se sigue.
 */
export async function completarDatos(s: Settings, log: Log, stop: Stopper) {
  const all = await db.items.toArray();
  const step = async (name: string, fn: () => Promise<void>) => {
    if (stop.stopped) return;
    try {
      await fn();
    } catch (e: any) {
      log(`${name}: ${e?.message ?? e} Sigo con lo demás.`);
    }
  };

  // Importados antes de guardar portadas (sin coverChecked): se vuelven a leer las listas una vez
  if (all.some((i) => i.source === "mal" && !i.cover && !i.extra.coverChecked)) {
    if (s.malUser && s.malClientId) {
      await step("MAL", async () => {
        log("MAL: faltan portadas; vuelvo a leer tus listas");
        await importMal(s.malUser, s.malClientId, log);
      });
    } else log("MAL: faltan portadas. Pon tu usuario y Client ID en Ajustes y vuelve a pulsar.");
  }

  if (all.some((i) => i.source === "letterboxd" && (!i.extra.tmdbDone || (!i.cover && i.extra.tmdbId && !i.extra.posterChecked)))) {
    if (s.tmdbKey) await step("películas", () => completarPeliculas(s.tmdbKey, log, stop));
    else log("películas: falta la API key de TMDB (Ajustes); las salto.");
  }

  if (all.some((i) => i.source === "excel")) await step("libros", () => completarLibros(log, stop));
}
