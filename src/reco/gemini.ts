import type { Settings } from "../settings";
import { MissingSettings } from "../sync";
import { isBookSource, ITEM_TYPES, type Item, type ItemType } from "../types";
import type { Neighbor } from "./ocean";
import { label, profileText } from "./profile";

// Recomendaciones con Gemini (API de Google AI Studio, nivel gratuito). Se envían tu perfil, tus
// pendientes y los títulos que ya has visto o leído de la categoría; nada más (ver README).

/** Modelo Flash estable con nivel gratuito (documentación de Google, octubre de 2026). Se puede cambiar en Ajustes. */
export const DEFAULT_MODEL = "gemini-3.8-flash";
const API = "https://generativelanguage.googleapis.com/v1beta/models";

export type RecoSource = "pending" | "new" | "both";

export interface RecoRequest {
  type: ItemType;
  source: RecoSource; // de mis pendientes, algo nuevo o ambos
  wish: string; // lo que me apetece (opcional)
  allTastes: boolean; // basado en todos mis gustos (recomendaciones cruzadas)
  ocean?: boolean; // libros: candidatos de «An Ocean of Books» (experimental)
}

/** Lo que devuelve Gemini (antes de verificar). */
export interface Suggestion {
  title: string;
  originalTitle?: string | null;
  year?: number | null;
  author?: string | null; // autor, director o estudio
  type: ItemType;
  fromPending: boolean;
  reason: string; // en español, 1-2 frases
}

/** «Ya lo he visto» y «No me interesa» de recomendaciones anteriores. */
export interface Feedback {
  type: ItemType;
  title: string;
  kind: "seen" | "dismissed";
  at: string;
}

const SCHEMA = {
  type: "ARRAY",
  items: {
    type: "OBJECT",
    properties: {
      title: { type: "STRING", description: "Título con el que se publicó en España si existe; si no, el original" },
      originalTitle: { type: "STRING", nullable: true, description: "Título original" },
      year: { type: "INTEGER", nullable: true, description: "Año de publicación o estreno" },
      author: { type: "STRING", nullable: true, description: "Autor (libros y manga), director (películas) o estudio (anime)" },
      type: { type: "STRING", enum: ITEM_TYPES },
      fromPending: { type: "BOOLEAN", description: "true si está en mi lista de pendientes" },
      reason: { type: "STRING", description: "Por qué me puede gustar, en español, 1-2 frases, citando títulos míos que se parecen" },
    },
    required: ["title", "type", "fromPending", "reason"],
    propertyOrdering: ["title", "originalTitle", "year", "author", "type", "fromPending", "reason"],
  },
};

const PLURAL: Record<ItemType, string> = { anime: "animes", manga: "mangas", movie: "películas", book: "libros" };
const SEEN: Record<ItemType, string> = { anime: "YA VISTOS", manga: "YA LEÍDOS", movie: "YA VISTAS", book: "YA LEÍDOS" };
const COUNT = 8; // se piden algunos de más: la verificación descarta los que no encuentra

const SYSTEM =
  "Eres un recomendador personal de anime, manga, películas y libros. Recomiendas títulos reales que existen, " +
  "con su título y año correctos, que encajen con los gustos del usuario. No recomiendas nada de lo que ya ha " +
  "visto o leído ni lo que ha descartado. Respondes solo con el JSON pedido; los textos, en español.";

/** Los libros cercanos a tus favoritos en el mapa, agrupados por favorito. */
function mapText(cands: Neighbor[]) {
  const byAnchor = new Map<string, Neighbor[]>();
  for (const c of cands) byAnchor.set(c.near, [...(byAnchor.get(c.near) ?? []), c]);
  return [
    `## CANDIDATOS DEL MAPA (${cands.length})`,
    "Libros de otros autores que están cerca de mis favoritos en «An Ocean of Books», un mapa de Google que coloca " +
      "los libros según lo parecido de su texto. El mapa no siempre acierta: recomienda solo los que encajen de verdad " +
      "con mi perfil (con su título en España si existe) y, si ninguno encaja, ignóralos.",
    ...[...byAnchor].map(([near, cs]) => `- Cerca de ${near}: ${cs.map((c) => (c.author ? `${c.title} (${c.author})` : c.title)).join(" · ")}`),
  ].join("\n");
}

/** El prompt: perfil, pendientes, lo ya visto o leído (solo títulos), lo descartado, lo que te apetece y, en libros, los candidatos del mapa. */
export function buildPrompt(items: Item[], req: RecoRequest, feedback: Feedback[], mapCands: Neighbor[] = []) {
  const { type } = req;
  const mine = items.filter((i) => i.type === type);
  const pending = mine.filter((i) => i.status === "plan");
  const seen = [
    ...mine.filter((i) => i.status !== "plan").map((i) => i.title),
    ...feedback.filter((f) => f.type === type && f.kind === "seen").map((f) => f.title),
  ];
  const dismissed = feedback.filter((f) => f.type === type && f.kind === "dismissed").map((f) => f.title);
  const what = PLURAL[type];
  const pendingLabel = (i: Item) => `${label(i)}${isBookSource(i) && i.extra.priority ? ` [prioridad ${i.extra.priority}]` : ""}`;

  const howMany = req.source === "pending" ? Math.min(COUNT, pending.length) : COUNT;
  const mode =
    req.source === "pending"
      ? `Elige SOLO de mi lista de PENDIENTES (fromPending = true). En los libros, la prioridad 1 es la más alta.`
      : req.source === "new"
        ? `Recomienda títulos que NO estén en mis pendientes ni en lo ya ${type === "movie" ? "visto" : "leído o visto"} (fromPending = false).`
        : `Mezcla títulos de mis PENDIENTES (fromPending = true) con títulos nuevos que no tenga (fromPending = false).`;

  return [
    `Recomiéndame ${howMany} ${what}, de mejor a peor encaje. ${mode}`,
    req.allTastes
      ? `Básate en TODOS mis gustos (anime, manga, películas y libros): vale recomendar ${what} que encajen con lo que me gusta de otras categorías.`
      : `Básate en mis gustos de ${what}.`,
    req.wish.trim() ? `Lo que me apetece ahora: «${req.wish.trim()}».` : null,
    `Todas las recomendaciones son de tipo "${type}". En «reason» explica en 1-2 frases por qué me puede gustar, citando títulos de mi perfil que se parezcan.`,
    "",
    profileText(items, req.allTastes ? ITEM_TYPES : [type]),
    "",
    `## PENDIENTES (${pending.length})`,
    pending.length ? pending.map(pendingLabel).join(" · ") : "(ninguno)",
    "",
    `## ${SEEN[type]}: no los recomiendes (${seen.length})`,
    seen.length ? seen.join(" · ") : "(ninguno)",
    dismissed.length ? `\n## NO ME INTERESAN: no los recomiendes\n${dismissed.join(" · ")}` : null,
    mapCands.length ? `\n${mapText(mapCands)}` : null,
  ]
    .filter((l) => l !== null)
    .join("\n");
}

/** Se ha agotado la cuota gratuita (429). */
export class GeminiQuota extends Error {}

/** Mensaje claro para cada error de la API de Gemini. */
async function apiError(r: Response, model: string): Promise<Error> {
  const body = await r.json().catch(() => null);
  const err = body?.error ?? {};
  const text = `${err.status ?? ""} ${err.message ?? ""} ${JSON.stringify(err.details ?? "")}`;
  if (r.status === 429) {
    // Límite por minuto (esperar un poco) o diario (hasta mañana)
    if (/PerMinute/i.test(text) && !/PerDay/i.test(text))
      return new GeminiQuota("Demasiadas peticiones seguidas a Gemini: espera un minuto y vuelve a probar.");
    return new GeminiQuota("Has llegado al límite gratuito de hoy, prueba mañana o usa «Copiar mi perfil».");
  }
  if (/API_KEY_INVALID|API key not valid/i.test(text) || r.status === 401)
    return new MissingSettings("Gemini rechaza la API key. Revísala en Ajustes.");
  if (r.status === 404)
    return new MissingSettings(`El modelo «${model}» no existe o ya no está disponible. Cámbialo en Ajustes (o déjalo vacío para usar ${DEFAULT_MODEL}).`);
  if (r.status === 403) return new MissingSettings(`Gemini no permite usar esta API key (${err.message ?? "403"}). Revísala en Ajustes.`);
  if (r.status >= 500) return new Error(`Gemini no responde ahora mismo (${r.status}). Prueba en un momento.`);
  return new Error(`Gemini responde ${r.status}: ${err.message ?? "error desconocido"}`);
}

/** Pide las recomendaciones a Gemini y devuelve la lista (sin verificar). */
export async function askGemini(s: Settings, prompt: string, type: ItemType): Promise<Suggestion[]> {
  const key = s.geminiKey.trim();
  if (!key) throw new MissingSettings("Para pedir recomendaciones falta en Ajustes: API key de Gemini (gratuita en Google AI Studio).");
  const model = s.geminiModel.trim() || DEFAULT_MODEL;
  let r: Response;
  try {
    r = await fetch(`${API}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key }, // en la cabecera, no en la URL
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: SCHEMA },
      }),
    });
  } catch {
    throw new Error("No se pudo conectar con Gemini. ¿Hay conexión?");
  }
  if (!r.ok) throw await apiError(r, model);

  const js = await r.json();
  if (js.promptFeedback?.blockReason) throw new Error(`Gemini ha bloqueado la petición (${js.promptFeedback.blockReason}). Prueba a escribirla de otra forma.`);
  const cand = js.candidates?.[0];
  const text: string = (cand?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  if (!text.trim()) throw new Error(`Gemini no ha devuelto recomendaciones${cand?.finishReason ? ` (${cand.finishReason})` : ""}. Prueba otra vez.`);
  let list: unknown;
  try {
    list = JSON.parse(text);
  } catch {
    throw new Error("La respuesta de Gemini no tiene el formato esperado. Prueba otra vez.");
  }
  if (!Array.isArray(list)) throw new Error("La respuesta de Gemini no tiene el formato esperado. Prueba otra vez.");
  return list
    .filter((x: any) => typeof x?.title === "string" && x.title.trim() && typeof x?.reason === "string")
    .map((x: any) => ({
      title: x.title.trim(),
      originalTitle: typeof x.originalTitle === "string" && x.originalTitle.trim() ? x.originalTitle.trim() : null,
      year: Number.isInteger(Number(x.year)) && Number(x.year) > 0 ? Number(x.year) : null, // a veces llega como texto
      author: typeof x.author === "string" && x.author.trim() ? x.author.trim() : null,
      type, // la categoría pedida, aunque el modelo diga otra cosa
      fromPending: x.fromPending === true,
      reason: x.reason.trim(),
    }));
}
