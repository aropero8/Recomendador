import { getMeta, setMeta, type Stopper } from "../db";
import type { Settings } from "../settings";
import type { SyncResult } from "../sync";
import type { Item, ItemType, Log } from "../types";
import { askGemini, buildPrompt, type Feedback, type RecoRequest } from "./gemini";
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

/** Perfil -> Gemini -> verificación; guarda el resultado y devuelve el resumen para el banner. */
export async function recomendar(items: Item[], req: RecoRequest, s: Settings, log: Log, stop: Stopper): Promise<SyncResult> {
  const feedback = await loadFeedback();
  log("Pidiendo recomendaciones a Gemini…");
  const suggestions = await askGemini(s, buildPrompt(items, req, feedback), req.type);
  if (stop.stopped) return { text: "Recomendaciones canceladas" };
  log(`Gemini propone ${suggestions.length}; comprobando que existen…`);
  const v = await verify(items, suggestions, feedback, s, log, stop);
  await saveRun({ at: new Date().toISOString(), request: req, recos: v.recos, dropped: v.dropped });

  const { seen, feedback: fb, unverified } = v.dropped;
  const out = [
    seen && `${seen} ya ${seen === 1 ? "visto o leído" : "vistos o leídos"}`,
    fb && `${fb} de tu historial`,
    unverified.length && `${unverified.length} sin poder comprobar`,
  ].filter(Boolean);
  return { text: `Recomendaciones de ${PLURAL[req.type]}: ${v.recos.length}${out.length ? ` (descartadas: ${out.join(", ")})` : ""}` };
}
