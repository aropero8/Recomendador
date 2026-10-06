import { ChangeEvent, useState } from "react";
import type { Settings } from "../settings";

export default function SettingsTab({ settings, onSave }: { settings: Settings; onSave: (s: Settings) => Promise<void> }) {
  const [s, setS] = useState(settings);
  const set = (k: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => setS({ ...s, [k]: e.target.value });

  return (
    <div className="stack">
      <section>
        <h2>Cuentas</h2>
        <label>
          Usuario de MyAnimeList
          <input value={s.malUser} onChange={set("malUser")} autoCapitalize="none" />
        </label>
        <label>
          API key de TMDB (v3, la corta)
          <input value={s.tmdbKey} onChange={set("tmdbKey")} type="password" autoCapitalize="none" />
        </label>
        <label>
          API key de Google Books (opcional)
          <input value={s.booksKey} onChange={set("booksKey")} type="password" autoCapitalize="none" />
        </label>
        <label>
          Pestañas de «Sin leer» a usar (vacío = todas)
          <input value={s.sheets} onChange={set("sheets")} />
        </label>
        <button onClick={() => onSave(s)}>Guardar ajustes</button>
        <p className="hint">Las claves se guardan solo en este dispositivo.</p>
      </section>

      <section>
        <h2>Créditos</h2>
        <p className="hint">
          Esta aplicación usa la API de TMDB, pero no está avalada ni certificada por TMDB. Datos de anime y manga
          de MyAnimeList a través de Jikan; libros de Google Books y Open Library.
        </p>
      </section>
    </div>
  );
}
