import Dexie, { Table } from "dexie";
import type { Item } from "./types";

class DB extends Dexie {
  items!: Table<Item, string>;
  constructor() {
    super("recomendador");
    this.version(1).stores({ items: "key,type,source,status" });
  }
}

export const db = new DB();

/** Guarda un item conservando el embedding si el texto no ha cambiado. */
export async function upsert(item: Item) {
  const old = await db.items.get(item.key);
  if (old?.embedding && old.synopsis === item.synopsis && old.title === item.title) {
    item.embedding = old.embedding;
  }
  await db.items.put(item);
}

/**
 * Como upsert, pero para muchos items en una sola transacción.
 * `merge` permite conservar datos del item anterior (sinopsis ya completadas, etc.).
 */
export async function bulkUpsert(items: Item[], merge?: (item: Item, old: Item) => Item) {
  await db.transaction("rw", db.items, async () => {
    const olds = await db.items.bulkGet(items.map((i) => i.key));
    const out = items.map((item, i) => {
      const old = olds[i];
      if (!old) return item;
      const m = merge ? merge(item, old) : item;
      if (old.embedding && old.synopsis === m.synopsis && old.title === m.title) m.embedding = old.embedding;
      return m;
    });
    await db.items.bulkPut(out);
  });
}

/** Control para detener un proceso largo (completar sinopsis…) y reanudarlo después. */
export interface Stopper {
  stopped: boolean;
}
