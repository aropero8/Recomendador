// Tema claro u oscuro: por defecto sigue al sistema; en Ajustes se puede fijar. Es una preferencia
// de este dispositivo, así que va en localStorage (se aplica antes de pintar, sin parpadeo).
export type Theme = "system" | "light" | "dark";

const KEY = "tema";

export function loadTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(t: Theme) {
  const root = document.documentElement;
  if (t === "system") delete root.dataset.theme;
  else root.dataset.theme = t;
  // Color de la barra del navegador (en Android lo pinta el tema del sistema)
  const dark = t === "dark" || (t === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#111216" : "#f5f3ee");
}

export function saveTheme(t: Theme) {
  try {
    if (t === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // sin almacenamiento: se aplica solo en esta sesión
  }
  applyTheme(t);
}
