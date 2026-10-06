import { useState } from "react";
import { exportBackup, restoreBackup } from "../backup";
import type { Stopper } from "../db";
import { completarSinopsis, importBooks } from "../ingest/books";
import { completarPeliculas, importLetterboxd } from "../ingest/letterboxd";
import { importMal } from "../ingest/mal";
import type { Settings } from "../settings";
import { ITEM_TYPES, ItemType, Log, TYPE_LABEL } from "../types";

export type Counts = Record<ItemType, { total: number; rated: number; synopsis: number }>;

interface Props {
  settings: Settings;
  counts: Counts;
  log: string[];
  busy: boolean;
  run: (fn: (stop: Stopper) => Promise<void>, canStop?: boolean) => Promise<void>;
  addLog: Log;
  stoppable: boolean;
  onStop: () => void;
  persisted: boolean | null;
}

export default function Data({ settings, counts, log, busy, run, addLog, stoppable, onStop, persisted }: Props) {
  const [zip, setZip] = useState<File | null>(null);
  const [leidos, setLeidos] = useState<File | null>(null);
  const [sinLeer, setSinLeer] = useState<File | null>(null);
  const [backup, setBackup] = useState<File | null>(null);

  return (
    <div className="stack">
      <section>
        <h2>Tu biblioteca</h2>
        <table>
          <thead>
            <tr>
              <th></th>
              <th>Total</th>
              <th>Con nota</th>
              <th>Con sinopsis</th>
            </tr>
          </thead>
          <tbody>
            {ITEM_TYPES.map((t) => (
              <tr key={t}>
                <td>
                  <span className={`dot ${t}`} /> {TYPE_LABEL[t]}
                </td>
                <td>{counts[t]?.total ?? 0}</td>
                <td>{counts[t]?.rated ?? 0}</td>
                <td>{counts[t]?.synopsis ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Anime y manga</h2>
        <p className="hint">Lee tu lista pública de MyAnimeList{settings.malUser ? ` (${settings.malUser})` : ""}.</p>
        <button disabled={busy} onClick={() => run(() => importMal(settings.malUser, settings.malClientId, addLog))}>
          Importar desde MyAnimeList
        </button>
      </section>

      <section>
        <h2>Películas</h2>
        <p className="hint">Elige el ZIP que exportas desde Letterboxd.</p>
        <input type="file" accept=".zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
        <button disabled={busy || !zip} onClick={() => run(() => importLetterboxd(zip!, addLog))}>
          Importar películas
        </button>
        <p className="hint">Después, trae sinopsis y géneros de TMDB. Puedes detenerlo y reanudarlo cuando quieras.</p>
        <button disabled={busy} onClick={() => run((stop) => completarPeliculas(settings.tmdbKey, addLog, stop), true)}>
          Completar datos (películas)
        </button>
      </section>

      <section>
        <h2>Libros y manga en papel</h2>
        <label>
          Libros leídos (.xlsx)
          <input type="file" accept=".xlsx" onChange={(e) => setLeidos(e.target.files?.[0] ?? null)} />
        </label>
        <label>
          Libros sin leer (.xlsx)
          <input type="file" accept=".xlsx" onChange={(e) => setSinLeer(e.target.files?.[0] ?? null)} />
        </label>
        <button
          disabled={busy || !leidos || !sinLeer}
          onClick={() => run(() => importBooks(leidos!, sinLeer!, settings.sheets, addLog))}
        >
          Importar libros
        </button>
        <p className="hint">Después, busca las sinopsis en Wikipedia y Open Library (una petición por segundo). Puedes detenerlo y reanudarlo.</p>
        <button disabled={busy} onClick={() => run((stop) => completarSinopsis(addLog, stop), true)}>
          Completar sinopsis (libros)
        </button>
      </section>

      <section>
        <h2>Copia de seguridad</h2>
        <p className="hint">
          Tu biblioteca se guarda en este navegador
          {persisted === true && " y está protegida para que no se borre por falta de espacio"}
          {persisted === false && ", pero el navegador puede borrarla si le falta espacio"}. Exporta una copia para
          no perderla o para pasarla al móvil (no incluye tus claves de Ajustes).
        </p>
        <button disabled={busy} onClick={() => run(() => exportBackup(addLog))}>
          Exportar copia
        </button>
        <label>
          Restaurar una copia (.json)
          <input type="file" accept=".json,application/json" onChange={(e) => setBackup(e.target.files?.[0] ?? null)} />
        </label>
        <button disabled={busy || !backup} onClick={() => run(() => restoreBackup(backup!, addLog))}>
          Restaurar copia
        </button>
      </section>

      {log.length > 0 && (
        <section>
          <h2>Registro</h2>
          <pre className="log">{log.slice(-12).join("\n")}</pre>
          {stoppable && <button onClick={onStop}>Detener</button>}
        </section>
      )}
    </div>
  );
}
