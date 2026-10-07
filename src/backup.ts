import { CoverBackup, exportCovers, importCovers } from "./covers/user";
import { db, putInBatches } from "./db";
import { ITEM_TYPES, type Item, type Log } from "./types";

// Copia de seguridad de la biblioteca en un .json. No incluye las claves de Ajustes
// (por si el archivo se comparte) ni los embeddings (se regeneran y pesan mucho).
const FORMAT = "recomendador-backup";
const VERSION = 3; // 2: portadas elegidas a mano; 3: meta (libros del Excel borrados, fechas de actualización)

export async function exportBackup(log: Log) {
  const items = (await db.items.toArray()).map(({ embedding, ...i }) => i);
  const covers = await exportCovers();
  const meta = await db.meta.toArray();
  const data = { format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(), items, covers, meta };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `backup-recomendador-${data.exportedAt.slice(0, 10)}.json`; // .gitignore: backup*.json
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  log(`Copia exportada: ${items.length} títulos${covers.length ? ` y ${covers.length} portadas elegidas a mano` : ""} (${a.download})`);
}

const isItem = (i: any): i is Item =>
  i && typeof i.key === "string" && typeof i.title === "string" && ITEM_TYPES.includes(i.type) &&
  typeof i.status === "string" && typeof i.source === "string";

/** Carga una copia: añade los títulos que falten y sustituye los que ya existan (misma clave). */
export async function restoreBackup(file: File, log: Log) {
  let data: any;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error("El archivo no es un JSON válido.");
  }
  if (data?.format !== FORMAT || !Array.isArray(data.items)) throw new Error("El archivo no es una copia del Recomendador.");
  if (data.version > VERSION) throw new Error("La copia es de una versión más nueva de la app. Actualiza la app.");

  const items = data.items.filter(isItem).map((i: Item) => ({
    ...i,
    synopsis: i.synopsis ?? "",
    genres: Array.isArray(i.genres) ? i.genres : [],
    userScore: typeof i.userScore === "number" ? i.userScore : null,
    extra: i.extra ?? {},
  }));
  const bad = data.items.length - items.length;
  const existing = new Set(await db.items.toCollection().primaryKeys());
  const replaced = items.filter((i: Item) => existing.has(i.key)).length;
  const date = String(data.exportedAt ?? "").slice(0, 10);

  if (!confirm(`Restaurar la copia del ${date}: ${items.length} títulos (${replaced} sustituirán a los que ya tienes). ¿Continuar?`)) {
    return log("Restauración cancelada");
  }
  await putInBatches(items);
  const covers = Array.isArray(data.covers) ? await importCovers(data.covers as CoverBackup[]) : 0;
  if (Array.isArray(data.meta)) await db.meta.bulkPut(data.meta.filter((m: any) => typeof m?.key === "string"));
  log(`Copia restaurada: ${items.length} títulos${covers ? ` y ${covers} portadas elegidas a mano` : ""}${bad ? ` (${bad} entradas no válidas ignoradas)` : ""}`);
}

/** Pide al navegador que no borre la base de datos cuando le falte espacio. */
export async function requestPersistence(): Promise<boolean | null> {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}
