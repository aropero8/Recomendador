import { Preferences } from "@capacitor/preferences";

export interface Settings {
  malUser: string;
  malClientId: string;
  tmdbKey: string;
  letterboxdUser: string; // para leer su RSS público
  geminiKey: string; // recomendaciones con IA (nivel gratuito de Google AI Studio)
  geminiModel: string; // vacío = el modelo por defecto (ver reco/gemini.ts)
  sheets: string; // pestañas de "Sin leer" a usar, separadas por comas
}

const DEFAULTS: Settings = { malUser: "", malClientId: "", tmdbKey: "", letterboxdUser: "", geminiKey: "", geminiModel: "", sheets: "" };

export async function loadSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: "settings" });
  // booksKey: clave de Google Books de versiones anteriores, ya no se usa
  const { booksKey, ...saved } = value ? JSON.parse(value) : ({} as Record<string, string>);
  return { ...DEFAULTS, ...saved };
}

export async function saveSettings(s: Settings) {
  await Preferences.set({ key: "settings", value: JSON.stringify(s) });
}
