/**
 * Copia texto al portapapeles. navigator.clipboard necesita un contexto seguro y a veces falla en
 * el WebView de Android: entonces se usa el método antiguo con un textarea oculto.
 */
export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    if (!ok) throw new Error("No se pudo copiar al portapapeles.");
  }
}
