import { ChangeEvent, useState } from "react";
import { DEFAULT_MODEL } from "../reco/gemini";
import type { Settings } from "../settings";
import { loadTheme, saveTheme, Theme } from "../theme";

const THEMES: [Theme, string][] = [
  ["system", "Automático"],
  ["light", "Claro"],
  ["dark", "Oscuro"],
];

export default function SettingsTab({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const [theme, setTheme] = useState(loadTheme);
  const set = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });
  const changed = (Object.keys(s) as (keyof Settings)[]).some((k) => s[k] !== settings[k]);
  const field = { autoCapitalize: "none", autoCorrect: "off", autoComplete: "off", spellCheck: false } as const;

  return (
    <div className="stack">
      <section>
        <h2>Apariencia</h2>
        <div className="segmented" role="radiogroup" aria-label="Tema">
          {THEMES.map(([t, label]) => (
            <button
              key={t}
              role="radio"
              aria-checked={theme === t}
              className={theme === t ? "on" : ""}
              onClick={() => {
                saveTheme(t);
                setTheme(t);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="hint">Automático sigue el modo claro u oscuro del móvil.</p>
      </section>

      <section>
        <h2>Cuentas</h2>
        <label>
          Usuario de MyAnimeList
          <input value={s.malUser} onChange={set("malUser")} {...field} />
        </label>
        <label>
          Client ID de MyAnimeList
          <input value={s.malClientId} onChange={set("malClientId")} type="password" {...field} />
        </label>
        <label>
          Usuario de Letterboxd
          <input value={s.letterboxdUser} onChange={set("letterboxdUser")} placeholder="el de letterboxd.com/usuario" {...field} />
        </label>
        <label>
          API key de TMDB (v3, la corta)
          <input value={s.tmdbKey} onChange={set("tmdbKey")} type="password" {...field} />
        </label>
        <label>
          API key de Gemini (recomendaciones)
          <input value={s.geminiKey} onChange={set("geminiKey")} type="password" {...field} />
        </label>
        <label>
          Modelo de Gemini
          <input value={s.geminiModel} onChange={set("geminiModel")} placeholder={DEFAULT_MODEL} {...field} />
        </label>
        <p className="hint">
          La clave de Gemini es gratuita: créala en Google AI Studio (aistudio.google.com, «Get API key»). Deja el modelo
          vacío para usar {DEFAULT_MODEL}.
        </p>
        <label>
          Pestañas de «Sin leer» a usar (vacío = todas)
          <input value={s.sheets} onChange={set("sheets")} {...field} />
        </label>
        <button disabled={!changed} onClick={() => onSave(s)}>
          Guardar ajustes
        </button>
        <p className="hint">Las claves se guardan solo en este dispositivo.</p>
      </section>

      <section>
        <h2>Créditos</h2>
        <p className="hint">
          Esta aplicación usa la API de TMDB, pero no está avalada ni certificada por TMDB. Datos de anime y manga
          de la API oficial de MyAnimeList; libros de Open Library. Resúmenes de Wikipedia (CC BY-SA). Recomendaciones
          generadas con Gemini (Google): al pedirlas se envía a Google tu perfil de gustos y los títulos de esa categoría.
        </p>
      </section>
    </div>
  );
}
