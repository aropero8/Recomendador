import Dexie, { Table } from "dexie";
import type { Item, Log } from "./types";

/**
 * Portada elegida a mano para un título: un enlace o una foto subida (ya reducida, unos 30-60 KB).
 * Va en su propia tabla para que ninguna importación ni «Descargar portadas» la pise.
 */
export interface UserCover {
  key: string; // la misma clave que el item
  url?: string;
  blob?: Blob;
  updatedAt: string;
}

class DB extends Dexie {
  items!: Table<Item, string>;
  covers!: Table<UserCover, string>;
  constructor() {
    super("recomendador");
    this.version(1).stores({ items: "key,type,source,status" });
    this.version(2).stores({ items: "key,type,source,status", covers: "key" });
  }
}

export const db = new DB();

/** Escrituras de lo que se va completando, de 50 en 50 (ni una transacción por item ni una gigante). */
export const BATCH = 50;

const ITEM_FIELDS = new Set(["key", "source", "type", "title", "synopsis", "genres", "userScore", "status", "extra", "cover"]);
const MAX_EXTRA = 10_000; // ningún dato de extra debería pasar de unos pocos KB

/**
 * Deja el item como debe guardarse: cover solo como URL (nunca la imagen), sin embeddings (la Fase 1
 * no los usa) ni campos desconocidos. Devuelve también qué se ha quitado, para avisar.
 */
export function sanitize(item: Item): { item: Item; removed: string[] } {
  const removed: string[] = [];
  const out: any = {};
  for (const [k, v] of Object.entries(item)) {
    if (ITEM_FIELDS.has(k)) out[k] = v;
    else removed.push(k);
  }
  if (out.cover !== undefined && !(typeof out.cover === "string" && /^https?:\/\//.test(out.cover) && out.cover.length < 2000)) {
    removed.push("cover (no era una URL)");
    delete out.cover;
  }
  const big = Object.entries(out.extra ?? {}).filter(([, v]) => JSON.stringify(v ?? "").length > MAX_EXTRA);
  if (big.length) {
    out.extra = { ...out.extra };
    for (const [k] of big) {
      removed.push(`extra.${k}`);
      delete out.extra[k];
    }
  }
  return { item: out, removed };
}

/** Guarda items en lotes de BATCH, saneados. */
export async function putInBatches(items: Item[]) {
  for (let i = 0; i < items.length; i += BATCH) {
    await db.items.bulkPut(items.slice(i, i + BATCH).map((it) => sanitize(it).item));
  }
}

/** Acumula items modificados y los guarda con bulkPut cada BATCH; flush() guarda lo pendiente. */
export class BatchWriter {
  private pending: Item[] = [];
  async put(item: Item) {
    this.pending.push(item);
    if (this.pending.length >= BATCH) await this.flush();
  }
  async flush() {
    if (!this.pending.length) return;
    const chunk = this.pending;
    this.pending = [];
    await putInBatches(chunk);
  }
}

/**
 * Inserta o actualiza muchos items en lotes. `merge` permite conservar datos del item anterior
 * (sinopsis ya completadas, portadas...).
 */
export async function bulkUpsert(items: Item[], merge?: (item: Item, old: Item) => Item) {
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    await db.transaction("rw", db.items, async () => {
      const olds = await db.items.bulkGet(chunk.map((it) => it.key));
      await db.items.bulkPut(chunk.map((it, j) => sanitize(olds[j] && merge ? merge(it, olds[j]!) : it).item));
    });
  }
}

/** Repasa toda la base de datos y corrige lo que no debería estar (ver sanitize). */
export async function limpiarBaseDeDatos(log: Log) {
  const all = await db.items.toArray();
  const fixed: Item[] = [];
  const what = new Map<string, number>();
  for (const it of all) {
    const { item, removed } = sanitize(it);
    if (!removed.length) continue;
    fixed.push(item);
    for (const r of removed) what.set(r, (what.get(r) ?? 0) + 1);
  }
  if (!fixed.length) return;
  const before = all.filter((i) => fixed.some((f) => f.key === i.key)).reduce((a, i) => a + approxSize(i), 0);
  const after = fixed.reduce((a, i) => a + approxSize(i), 0);
  await putInBatches(fixed);
  const det = [...what].map(([k, n]) => `${k}: ${n}`).join(", ");
  log(`Limpieza: ${fixed.length} registros corregidos (${det}); ${Math.round((before - after) / 1024)} KB liberados`);
}

const approxSize = (i: Item) => {
  const blobs = Object.values(i).reduce((a: number, v: any) => a + (v instanceof Blob ? v.size : v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? v.byteLength : 0), 0);
  return JSON.stringify(i, (_, v) => (v instanceof Blob || ArrayBuffer.isView(v) ? undefined : v)).length + blobs;
};

// ---------- espacio ----------

export interface StorageInfo {
  usage: number; // bytes
  quota: number;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  return { usage, quota, persisted };
}

export const mb = (bytes: number) => (bytes / 1048576).toLocaleString("es", { maximumFractionDigits: bytes < 10 * 1048576 ? 1 : 0 });

/** Error de cuota de IndexedDB, venga directo o envuelto por Dexie (inner, o failures de un BulkError). */
export function isQuotaError(e: any, depth = 0): boolean {
  if (!e || depth > 5) return false;
  if (e.name === "QuotaExceededError" || /quota|disk full/i.test(String(e.message ?? ""))) return true;
  const nested = [e.inner, e.cause, ...Object.values(e.failuresByPos ?? e.failures ?? {})];
  return nested.some((x) => isQuotaError(x, depth + 1));
}

/** Mensaje claro para el Registro cuando el navegador no deja guardar más. */
export async function quotaMessage() {
  const s = await storageInfo().catch(() => null);
  const uso = s ? ` (este sitio usa ${mb(s.usage)} MB de ${mb(s.quota)} MB permitidos)` : "";
  return (
    `Sin espacio: el navegador no deja guardar más datos${uso}. Lo ya guardado se conserva y el proceso se ha detenido. ` +
    "Si estás en una ventana de incógnito o de invitado, usa una normal; si no, libera espacio o borra los datos de " +
    "otros proyectos que usen esta misma dirección (localhost:5173) y vuelve a pulsar para reanudar."
  );
}

/** Control para detener un proceso largo (completar sinopsis…) y reanudarlo después. */
export interface Stopper {
  stopped: boolean;
}
