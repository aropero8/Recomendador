import { getMeta, setMeta } from "./db";

/** Fuentes que se pueden actualizar y la fecha (ISO) de la última vez. */
export type SyncSource = "mal" | "letterboxd";
export type SyncTimes = Partial<Record<SyncSource, string>>;

export const loadSyncTimes = () => getMeta<SyncTimes>("sync", {});

export async function markSynced(source: SyncSource) {
  const t = await loadSyncTimes();
  await setMeta("sync", { ...t, [source]: new Date().toISOString() });
}

const rtf = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** «hace 2 días», «ayer», «hace un momento»; «nunca» si no hay fecha. */
export function timeAgo(iso?: string) {
  if (!iso) return "nunca";
  const secs = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, s] of UNITS) if (Math.abs(secs) >= s) return rtf.format(Math.round(secs / s), unit);
  return "hace un momento";
}

/** Contadores de una actualización y su resumen legible: «3 nuevos, 2 notas cambiadas». */
export interface Changes {
  added: number;
  scores: number;
  statuses: number;
  progress: number;
  removed: number;
}
export const noChanges = (): Changes => ({ added: 0, scores: 0, statuses: 0, progress: 0, removed: 0 });

export function summary(c: Changes) {
  const parts = [
    c.added && `${c.added} ${c.added === 1 ? "nuevo" : "nuevos"}`,
    c.scores && `${c.scores} ${c.scores === 1 ? "nota cambiada" : "notas cambiadas"}`,
    c.statuses && `${c.statuses} ${c.statuses === 1 ? "estado cambiado" : "estados cambiados"}`,
    c.progress && `${c.progress} con progreso nuevo`,
    c.removed && `${c.removed} ${c.removed === 1 ? "quitado" : "quitados"} (ya no están en tu lista)`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "sin cambios";
}
