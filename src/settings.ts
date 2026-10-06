import { Preferences } from "@capacitor/preferences";

export interface Settings {
  malUser: string;
  malClientId: string;
  tmdbKey: string;
  booksKey: string; // opcional (Google Books)
  sheets: string; // pestañas de "Sin leer" a usar, separadas por comas
}

const DEFAULTS: Settings = { malUser: "", malClientId: "", tmdbKey: "", booksKey: "", sheets: "" };

export async function loadSettings(): Promise<Settings> {
  const { value } = await Preferences.get({ key: "settings" });
  return { ...DEFAULTS, ...(value ? JSON.parse(value) : {}) };
}

export async function saveSettings(s: Settings) {
  await Preferences.set({ key: "settings", value: JSON.stringify(s) });
}
