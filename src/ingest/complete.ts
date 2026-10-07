import type { Stopper } from "../db";
import type { Settings } from "../settings";
import type { Log } from "../types";
import { completarLibros } from "./books";
import { arreglarUrlsOpenLibrary, portadasLibros, portadasMal, portadasMangaExcel, portadasPeliculas, resumenPortadas, step } from "./covers";

/**
 * Botón «Completar datos»: busca todo lo que falte, de lo más rápido a lo más lento.
 * 1. Películas: sinopsis, géneros y póster de TMDB (necesita la API key).
 * 2. Portadas de MAL y de los mangas del Excel.
 * 3. Sinopsis de los libros (las portadas que aparezcan de paso se guardan).
 * 4. Portadas de los libros que aún no tengan.
 * Cada paso es independiente: si uno falla se apunta y se sigue.
 */
export async function completarDatos(s: Settings, log: Log, stop: Stopper) {
  await arreglarUrlsOpenLibrary();
  await step("películas", log, stop, () => portadasPeliculas(s, log, stop));
  await step("MAL", log, stop, () => portadasMal(s, log, stop));
  await step("manga", log, stop, () => portadasMangaExcel(s, log, stop));
  await step("libros", log, stop, () => completarLibros(log, stop));
  await step("libros", log, stop, () => portadasLibros(log, stop));
  await resumenPortadas(log);
}
