import { db, upsert } from "../db";
import { getJson } from "../lib/http";
import { norm } from "../lib/text";
import type { Item, Log, Status } from "../types";

const BASE = "https://api.jikan.moe/v4";
const CODES: Record<number, Status> = { 1: "reading", 2: "read", 3: "other", 4: "dropped", 6: "plan" };

function mapStatus(v: unknown): Status {
  if (typeof v === "number") return CODES[v] ?? "other";
  const s = norm(v);
  if (s.includes("complet")) return "read";
  if (s.includes("plan")) return "plan";
  if (s.includes("drop")) return "dropped";
  if (s.includes("watching") || s.includes("reading")) return "reading";
  return "other";
}

async function fetchList(kind: "anime" | "manga", user: string, log: Log) {
  const out: any[] = [];
  for (let page = 1; ; page++) {
    const js = await getJson(`${BASE}/users/${encodeURIComponent(user)}/${kind}list?page=${page}`, { delay: 500 });
    if (!js) throw new Error(`No se pudo leer tu lista de ${kind}. ¿El perfil de MAL es público?`);
    out.push(...js.data);
    log(`${kind}: página ${page} (${out.length} entradas)`);
    if (!js.pagination?.has_next_page) break;
  }
  return out;
}

export async function importMal(user: string, log: Log) {
  if (!user.trim()) throw new Error("Falta tu usuario de MyAnimeList (pestaña Ajustes).");
  for (const kind of ["anime", "manga"] as const) {
    const entries = await fetchList(kind, user, log);
    let n = 0;
    for (const e of entries) {
      const m = e[kind];
      const key = `${kind}:mal:${m.mal_id}`;
      const old = await db.items.get(key);

      let synopsis = old?.synopsis ?? "";
      let genres = old?.genres ?? [];
      let title: string = old?.title ?? m.title;
      let altTitles: string[] = old?.extra.altTitles ?? [];

      if (!old || !old.synopsis) {
        const d = (await getJson(`${BASE}/${kind}/${m.mal_id}`, { delay: 500 }))?.data;
        if (d) {
          synopsis = d.synopsis ?? "";
          genres = [...(d.genres ?? []), ...(d.themes ?? []), ...(d.demographics ?? [])].map((g: any) => g.name);
          title = d.title_english || d.title;
          altTitles = [d.title, d.title_english, ...(d.title_synonyms ?? [])].filter(Boolean);
        }
      }

      const item: Item = {
        key,
        source: "mal",
        type: kind,
        title,
        synopsis,
        genres,
        userScore: e.score ? Number(e.score) : null, // 0 = sin nota
        status: mapStatus(e.watching_status ?? e.reading_status ?? e.status),
        extra: { malId: m.mal_id, altTitles },
      };
      await upsert(item);
      if (++n % 25 === 0) log(`${kind}: ${n}/${entries.length}`);
    }
    log(`${kind}: ${entries.length} importados`);
  }
}
