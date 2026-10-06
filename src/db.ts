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
