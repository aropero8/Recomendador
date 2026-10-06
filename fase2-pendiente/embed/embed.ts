import { db } from "../db";
import type { Item, Log } from "../types";

let worker: Worker | null = null;
let nextId = 1;
let onModel: ((msg: string) => void) | null = null;
const pending = new Map<number, { res: (v: number[][]) => void; rej: (e: Error) => void }>();

export function setModelListener(fn: ((msg: string) => void) | null) {
  onModel = fn;
}

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        if (m.p?.status === "progress") onModel?.(`Descargando modelo: ${Math.round(m.p.progress ?? 0)}%`);
        else if (m.p?.status === "ready") onModel?.("Modelo listo");
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.type === "done") p.res(m.vectors);
      else p.rej(new Error(m.message));
    };
  }
  return worker;
}

function embed(texts: string[]): Promise<number[][]> {
  const id = nextId++;
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    getWorker().postMessage({ id, texts });
  });
}

/** E5 pide el prefijo "passage: " para los documentos. */
export const itemText = (i: Item) =>
  `passage: ${i.title}. ${i.genres.slice(0, 8).join(", ")}. ${i.synopsis}`.slice(0, 1800);

export async function embedPending(log: Log) {
  const todo = (await db.items.toArray()).filter((i) => !i.embedding);
  if (!todo.length) return log("Todo tiene ya su embedding.");
  const noSyn = todo.filter((i) => !i.synopsis).length;
  if (noSyn) log(`${noSyn} elementos sin sinopsis: se usará solo título y géneros.`);

  const BATCH = 16;
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    const vecs = await embed(chunk.map(itemText));
    await Promise.all(chunk.map((it, k) => db.items.update(it.key, { embedding: Float32Array.from(vecs[k]) })));
    log(`embeddings: ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
  }
}
