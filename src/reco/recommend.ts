import { getMeta, setMeta, type Stopper } from "../db";
import type { Settings } from "../settings";
import type { SyncResult } from "../sync";
import { isBookSource, type Item, type ItemType, type Log } from "../types";
import { askGemini, buildPrompt, type Feedback, type RecoRequest } from "./gemini";
import { findAnchors, fromMap, neighbors, titleKey, type Neighbor } from "./ocean";
import { categoryProfile, label } from "./profile";
import { recoId, verify, type Reco, type Verified } from "./verify";

// Historial y últimas recomendaciones, en la tabla meta (sin cambiar el esquema de la base de datos).

const FEEDBACK = "recoFeedback";
const LAST = "recoLast";

/** Unas recomendaciones ya hechas, para volver a verlas sin gastar peticiones. */
export interface RecoRun {
  at: string;
  request: RecoRequest;
  recos: Reco[];
  dropped: Verified["dropped"];
  map?: { anchors: number; candidates: number }; // si se usó el mapa: favoritos encontrados y libros propuestos
}
export type LastRuns = Partial<Record<ItemType, RecoRun>>;

export const loadFeedback = () => getMeta<Feedback[]>(FEEDBACK, []);
export const loadLastRuns = () => getMeta<LastRuns>(LAST, {});

async function saveRun(run: RecoRun) {
  await setMeta(LAST, { ...(await loadLastRuns()), [run.request.type]: run });
}

/** Cambia una recomendación guardada (al añadirla a pendientes) o la quita (null). */
export async function updateSavedReco(type: ItemType, id: string, next: Reco | null) {
  const runs = await loadLastRuns();
  const run = runs[type];
  if (!run) return;
  const recos = next ? run.recos.map((r) => (r.id === id ? next : r)) : run.recos.filter((r) => r.id !== id);
  await setMeta(LAST, { ...runs, [type]: { ...run, recos } });
}

/** «Ya lo he visto» o «No me interesa»: no se vuelve a recomendar y se manda a Gemini como contexto. */
export async function addFeedback(reco: Reco, kind: Feedback["kind"]) {
  const all = (await loadFeedback()).filter((f) => recoId(f.type, f.title) !== reco.id);
  await setMeta(FEEDBACK, [...all, { type: reco.type, title: reco.title, kind, at: new Date().toISOString() }]);
  await updateSavedReco(reco.type, reco.id, null);
}

const PLURAL: Record<ItemType, string> = { anime: "anime", manga: "manga", movie: "películas", book: "libros" };

/** Se usa el mapa: libros, opción marcada y no solo de pendientes (el mapa propone libros nuevos). */
export const usesMap = (req: RecoRequest) => req.type === "book" && !!req.ocean && req.source !== "pending";

/**
 * Candidatos de «An Ocean of Books»: los libros de otros autores más cerca de tus 8 libros favoritos.
 * Si el mapa falla o no encuentra nada, se sigue sin él.
 */
async function mapCandidates(items: Item[], log: Log) {
  const books = items.filter(isBookSource);
  const favs = categoryProfile(items, "book")
    .top.slice(0, 8)
    .map((i) => ({ title: i.title, author: i.extra.author, label: label(i) }));
  const mine = new Set(books.flatMap((i) => [i.title, ...(i.extra.altTitles ?? [])]).map(titleKey));
  try {
    log("Buscando tus libros favoritos en «An Ocean of Books»…");
    const anchors = await findAnchors(favs);
    const cands = anchors.length ? await neighbors(anchors, 6, (b) => mine.has(titleKey(b.title))) : [];
    log(anchors.length ? `El mapa propone ${cands.length} libros cerca de ${anchors.length} de tus favoritos.` : "Ninguno de tus favoritos está en el mapa: se sigue sin él.");
    return { anchors: anchors.length, cands };
  } catch {
    log("No se pudo consultar «An Ocean of Books»: se sigue sin el mapa.");
    return { anchors: 0, cands: [] as Neighbor[] };
  }
}

/** Perfil -> (mapa) -> Gemini -> verificación; guarda el resultado y devuelve el resumen para el banner. */
export async function recomendar(items: Item[], req: RecoRequest, s: Settings, log: Log, stop: Stopper): Promise<SyncResult> {
  const feedback = await loadFeedback();
  const map = usesMap(req) ? await mapCandidates(items, log) : null;
  if (stop.stopped) return { text: "Recomendaciones canceladas" };
  log("Pidiendo recomendaciones a Gemini…");
  const suggestions = await askGemini(s, buildPrompt(items, req, feedback, map?.cands), req.type);
  if (stop.stopped) return { text: "Recomendaciones canceladas" };
  log(`Gemini propone ${suggestions.length}; comprobando que existen…`);
  const v = await verify(items, suggestions, feedback, s, log, stop);
  const recos = map?.cands.length ? v.recos.map((r) => (!r.inPending && fromMap(map.cands, [r.title, r.originalTitle], r.author) ? { ...r, fromMap: true } : r)) : v.recos;
  await saveRun({
    at: new Date().toISOString(),
    request: req,
    recos,
    dropped: v.dropped,
    ...(map && { map: { anchors: map.anchors, candidates: map.cands.length } }),
  });

  const { seen, feedback: fb, unverified } = v.dropped;
  const out = [
    seen && `${seen} ya ${seen === 1 ? "visto o leído" : "vistos o leídos"}`,
    fb && `${fb} de tu historial`,
    unverified.length && `${unverified.length} sin poder comprobar`,
  ].filter(Boolean);
  const fromMapCount = recos.filter((r) => r.fromMap).length;
  return {
    text:
      `Recomendaciones de ${PLURAL[req.type]}: ${recos.length}${out.length ? ` (descartadas: ${out.join(", ")})` : ""}` +
      (map?.cands.length ? `; ${fromMapCount} del mapa` : ""),
  };
}
