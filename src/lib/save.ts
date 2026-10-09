import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const toBase64 = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(",")[1] ?? ""); // quita «data:...;base64,»
    r.onerror = () => rej(r.error);
    r.readAsDataURL(b);
  });

/**
 * Guarda un archivo generado por la app (copia de seguridad, libros en Excel).
 * En el navegador lo descarga con <a download>, que no funciona en el WebView de Android: allí
 * se escribe en la caché de la app y se abre «Compartir» para guardarlo en Drive, en Descargas o
 * mandarlo. Devuelve false si se cerró «Compartir» sin elegir nada.
 */
export async function saveFile(name: string, blob: Blob): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return true;
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(blob), directory: Directory.Cache });
  try {
    await Share.share({ title: name, files: [uri], dialogTitle: "Guardar o compartir" });
    return true;
  } catch (e: any) {
    if (/cancel/i.test(String(e?.message ?? e))) return false; // cerraste «Compartir»
    throw e;
  }
}
