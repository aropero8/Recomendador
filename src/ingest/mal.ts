import { Capacitor } from "@capacitor/core";
import { bulkUpsert } from "../db";
import { getJson, HttpError, qs } from "../lib/http";
import type { Item, Log, Status } from "../types";

// La API de MAL no permite CORS: en el navegador (desarrollo) pasamos por el proxy de Vite;
// en Android, CapacitorHttp hace la petición nativa y no hay CORS.
const ORIGIN = "https://api.myanimelist.net";
const BASE = Capacitor.isNativePlatform() ? ORIGIN : "/mal-api";

const STATUS: Record<string, Status> = {
  completed: "read",
  watching: "reading",
  reading: "reading",
  plan_to_watch: "plan",
  plan_to_read: "plan",
  dropped: "dropped",
  on_hold: "other",
};

async function fetchList(kind: "anime" | "manga", user: string, clientId: string, log: Log) {
  const out: any[] = [];
  let url: string | null =
    `${BASE}/v2/users/${encodeURIComponent(user)}/${kind}list?` +
    qs({ fields: "list_status,synopsis,genres,alternative_titles,title", limit: 1000, nsfw: "true" });
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

export async function importMal(user: string, clientId: string, log: Log) {
  if (!user.trim()) throw new Error("Falta tu usuario de MyAnimeList (pestaña Ajustes).");
  if (!clientId.trim()) throw new Error("Falta el Client ID de MyAnimeList (pestaña Ajustes).");
  for (const kind of ["anime", "manga"] as const) {
    const entries = await fetchList(kind, user.trim(), clientId.trim(), log);
    const items = entries.map(({ node: m, list_status: ls }): Item => {
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
        extra: { malId: m.id, altTitles: [...new Set([m.title, alt.en, alt.ja, ...(alt.synonyms ?? [])].filter(Boolean))] },
      };
    });
    await bulkUpsert(items);
    log(`${kind}: ${entries.length} importados`);
  }
}
