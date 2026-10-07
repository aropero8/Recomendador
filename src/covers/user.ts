import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { db, UserCover } from "../db";

const MAX_SIDE = 480; // px del lado mayor: de sobra para la ficha y ligero (unos 30-60 KB)

/** Reduce la imagen y la convierte a JPEG; en el móvil una foto de la cámara pasa de varios MB a unos KB. */
async function shrink(file: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo procesar la imagen."))), "image/jpeg", 0.82));
}

export const isImageUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) && s.length < 2000;

export async function setCoverUrl(key: string, url: string) {
  if (!isImageUrl(url)) throw new Error("Pega un enlace que empiece por http:// o https://");
  await db.covers.put({ key, url: url.trim(), updatedAt: new Date().toISOString() });
}

export async function setCoverFile(key: string, file: File) {
  if (!file.type.startsWith("image/")) throw new Error("El archivo no es una imagen.");
  await db.covers.put({ key, blob: await shrink(file), updatedAt: new Date().toISOString() });
}

export const removeCover = (key: string) => db.covers.delete(key);

/** Claves con portada elegida a mano (para que «Descargar portadas» no las busque). */
export async function customCoverKeys() {
  return new Set(await db.covers.toCollection().primaryKeys());
}

/**
 * Portadas elegidas a mano como clave -> URL para mostrar. Las fotos subidas se sirven con
 * object URLs, que se liberan al cambiar.
 */
export function useUserCovers() {
  const [map, setMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let urls: string[] = [];
    const sub = liveQuery(() => db.covers.toArray()).subscribe({
      next: (rows: UserCover[]) => {
        urls.forEach((u) => URL.revokeObjectURL(u));
        urls = [];
        const m = new Map<string, string>();
        for (const r of rows) {
          if (r.blob) {
            const u = URL.createObjectURL(r.blob);
            urls.push(u);
            m.set(r.key, u);
          } else if (r.url) m.set(r.key, r.url);
        }
        setMap(m);
      },
      error: () => setMap(new Map()),
    });
    return () => {
      sub.unsubscribe();
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);
  return map;
}

// ---------- copia de seguridad ----------

export interface CoverBackup {
  key: string;
  url?: string;
  dataUrl?: string;
  updatedAt: string;
}

const toDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

export async function exportCovers(): Promise<CoverBackup[]> {
  const rows = await db.covers.toArray();
  return Promise.all(rows.map(async (r) => ({ key: r.key, url: r.url, dataUrl: r.blob ? await toDataUrl(r.blob) : undefined, updatedAt: r.updatedAt })));
}

export async function importCovers(rows: CoverBackup[]) {
  const ok: UserCover[] = [];
  for (const r of rows ?? []) {
    if (typeof r?.key !== "string") continue;
    if (r.dataUrl?.startsWith("data:image/")) ok.push({ key: r.key, blob: await (await fetch(r.dataUrl)).blob(), updatedAt: r.updatedAt });
    else if (r.url && isImageUrl(r.url)) ok.push({ key: r.key, url: r.url, updatedAt: r.updatedAt });
  }
  await db.covers.bulkPut(ok);
  return ok.length;
}
