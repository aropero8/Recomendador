import { Capacitor } from "@capacitor/core";
import { bulkUpsert, db } from "../db";
import { getJson, HttpError, qs } from "../lib/http";
import { noChanges, summary } from "../sync";
import type { Item, Log, Status } from "../types";

// La API de MAL no permite CORS: en el navegador (desarrollo) pasamos por el proxy de Vite;
// en Android, CapacitorHttp hace la petición nativa y no hay CORS.
const ORIGIN = "https://api.myanimelist.net";
const BASE = Capacitor.isNativePlatform() ? ORIGIN : "/mal-api";

/** Portada de MAL: la grande si la hay. */
export const malPicture = (m: any): string | undefined => m?.main_picture?.large ?? m?.main_picture?.medium;

/** GET a la API de MAL (ruta desde /v2). Devuelve null si no existe (404). */
export async function malGet(path: string, clientId: string) {
  try {
    return await getJson(`${BASE}${path}`, { headers: { "X-MAL-CLIENT-ID": clientId }, strict: true, delay: 300 });
  } catch (e) {
    if (e instanceof HttpError && (e.status === 400 || e.status === 401)) throw new Error("MyAnimeList rechaza el Client ID. Revísalo en Ajustes.");
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

const STATUS: Record<string, Status> = {
  completed: "read",
  watching: "reading",
  reading: "reading",
  plan_to_watch: "plan",
  plan_to_read: "plan",
  dropped: "dropped",
  on_hold: "other",
};

const FIELDS = "list_status,synopsis,genres,alternative_titles,title,main_picture";
const TOTALS = { anime: "num_episodes", manga: "num_chapters,num_volumes" }; // para el progreso «12/24»

async function fetchList(kind: "anime" | "manga", user: string, clientId: string, log: Log) {
  const out: any[] = [];
  let url: string | null =
    `${BASE}/v2/users/${encodeURIComponent(user)}/${kind}list?` +
    qs({ fields: `${FIELDS},${TOTALS[kind]}`, limit: 1000, nsfw: "true" });
  for (let page = 1; url; page++) {
    let js: any;
    try {
      js = await getJson(url, { headers: { "X-MAL-CLIENT-ID": clientId }, strict: true, delay: 300 });
    } catch (e) {
      if (e instanceof HttpError && (e.status === 400 || e.status === 401))
        throw new Error("MyAnimeList rechaza el Client ID. Revísalo en Ajustes.");
      if (e instanceof HttpError && (e.status === 403 || e.status === 404))
        throw new Error(`No se pudo leer tu lista de ${kind}. ¿El usuario existe y la lista es pública?`);
      throw e;
    }
    if (!js) throw new Error(`No se pudo conectar con MyAnimeList (lista de ${kind}).`);
    out.push(...js.data);
    log(`${kind}: página ${page} (${out.length} entradas)`);
    // paging.next es una URL absoluta de api.myanimelist.net: la pasamos por el mismo BASE
    url = js.paging?.next ? BASE + js.paging.next.slice(ORIGIN.length) : null;
  }
  return out;
}

/** Progreso de tu lista: episodios vistos (anime) o capítulos y tomos leídos (manga), con el total si se conoce. */
function progress(kind: "anime" | "manga", m: any, ls: any) {
  return kind === "anime"
    ? { episodes: ls?.num_episodes_watched ?? 0, totalEpisodes: m.num_episodes || null }
    : { chapters: ls?.num_chapters_read ?? 0, totalChapters: m.num_chapters || null, volumes: ls?.num_volumes_read ?? 0, totalVolumes: m.num_volumes || null };
}

function toItem(kind: "anime" | "manga", { node: m, list_status: ls }: any): Item {
  const alt = m.alternative_titles ?? {};
  return {
    key: `${kind}:mal:${m.id}`,
    source: "mal",
    type: kind,
    title: alt.en || m.title,
    synopsis: m.synopsis ?? "",
    genres: (m.genres ?? []).map((g: any) => g.name),
    userScore: ls?.score ? Number(ls.score) : null, // 0 = sin nota
    status: STATUS[ls?.status] ?? "other",
    extra: {
      malId: m.id,
      altTitles: [...new Set([m.title, alt.en, alt.ja, ...(alt.synonyms ?? [])].filter(Boolean))],
      date: ls?.finish_date ?? ls?.updated_at,
      progress: progress(kind, m, ls),
      coverChecked: true, // ya se pidió main_picture (lo que falte lo vuelve a pedir «Descargar portadas»)
    },
    cover: malPicture(m),
  };
}

/**
 * Vuelve a leer tus listas de MAL y aplica solo los cambios: añade lo nuevo, actualiza nota, estado
 * y progreso, y quita lo que ya no está en la lista. Nunca pierde la sinopsis ni la portada que ya
 * hubiera (las elegidas a mano van en otra tabla y no se tocan). Devuelve los cambios y las claves nuevas.
 */
export async function actualizarMal(user: string, clientId: string, log: Log) {
  if (!user.trim()) throw new Error("Falta tu usuario de MyAnimeList (pestaña Ajustes).");
  if (!clientId.trim()) throw new Error("Falta el Client ID de MyAnimeList (pestaña Ajustes).");
  const changes = noChanges();
  const added: string[] = [];
  for (const kind of ["anime", "manga"] as const) {
    const fresh = (await fetchList(kind, user.trim(), clientId.trim(), log)).map((e) => toItem(kind, e));
    const old = await db.items.where("source").equals("mal").filter((i) => i.type === kind).toArray();
    const before = new Map(old.map((i) => [i.key, i]));
    for (const it of fresh) {
      const o = before.get(it.key);
      if (!o) {
        changes.added++;
        added.push(it.key);
        continue;
      }
      if (o.userScore !== it.userScore) changes.scores++;
      if (o.status !== it.status) changes.statuses++;
      // (los guardados antes de leer el progreso no cuentan como cambio)
      if (o.extra.progress && JSON.stringify(o.extra.progress) !== JSON.stringify(it.extra.progress)) changes.progress++;
    }
    await bulkUpsert(fresh, (item, o) => ({
      ...item,
      synopsis: item.synopsis || o.synopsis,
      genres: item.genres.length ? item.genres : o.genres,
      cover: item.cover ?? o.cover, // la conseguida pidiendo el título suelto
      extra: { ...o.extra, ...item.extra },
    }));

    const keep = new Set(fresh.map((i) => i.key));
    const gone = old.filter((i) => !keep.has(i.key)).map((i) => i.key);
    if (gone.length && !fresh.length) log(`${kind}: MAL devuelve tu lista vacía; no quito nada por si es un error. Revisa el usuario en Ajustes.`);
    else if (gone.length) {
      await db.items.bulkDelete(gone);
      changes.removed += gone.length;
    }
    log(`${kind}: ${fresh.length} en tu lista de MAL`);
  }
  return { changes, added };
}

/** Importación desde Datos: lo mismo que actualizar. */
export async function importMal(user: string, clientId: string, log: Log) {
  const { changes } = await actualizarMal(user, clientId, log);
  log(`MAL: ${summary(changes)}`);
}
