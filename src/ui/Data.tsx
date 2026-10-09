import { useState } from "react";
import { exportBackup, restoreBackup } from "../backup";
import { mb, StorageInfo, Stopper } from "../db";
import { importBooks } from "../ingest/books";
import { completarDatos } from "../ingest/complete";
import { descargarPortadas } from "../ingest/covers";
import { importLetterboxd } from "../ingest/letterboxd";
import { actualizarAnimeManga, actualizarPeliculas } from "../ingest/update";
import { exportBooksXlsx } from "../libros";
import { markSynced } from "../sync";
import type { Settings } from "../settings";
import { ITEM_TYPES, ItemType, Log, TYPE_LABEL } from "../types";

export type Counts = Record<ItemType, { total: number; rated: number; synopsis: number; cover: number }>;

interface Props {
  settings: Settings;
  counts: Counts;
  log: string[];
  busy: boolean;
  run: (fn: (stop: Stopper) => Promise<void>, canStop?: boolean) => Promise<void>;
  addLog: Log;
  stoppable: boolean;
  onStop: () => void;
  storage: StorageInfo | null;
}

/** Barra pequeña con el porcentaje que ya tiene sinopsis o portada. */
function Meter({ label, n, total }: { label: string; n: number; total: number }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return (
    <span className="meter">
      <span className="meter-text">
        {label} <b>{pct} %</b>
      </span>
      <span className="meter-bar">
        <span style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

export default function Data({ settings, counts, log, busy, run, addLog, stoppable, onStop, storage }: Props) {
  const [zip, setZip] = useState<File | null>(null);
  const [leidos, setLeidos] = useState<File | null>(null);
  const [sinLeer, setSinLeer] = useState<File | null>(null);
  const [backup, setBackup] = useState<File | null>(null);

  return (
    <div className="stack">
      <section>
        <h2>Tu biblioteca</h2>
        <div className="stats">
          {ITEM_TYPES.map((t) => {
            const c = counts[t] ?? { total: 0, rated: 0, synopsis: 0, cover: 0 };
            return (
              <div key={t} className={`stat ${t}`}>
                <span className="stat-name">
                  <span className="dot" /> {TYPE_LABEL[t]}
                </span>
                <strong>{c.total.toLocaleString("es")}</strong>
                <small>{c.rated.toLocaleString("es")} con nota</small>
                <Meter label="Sinopsis" n={c.synopsis} total={c.total} />
                <Meter label="Portada" n={c.cover} total={c.total} />
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2>Actualizar tus listas</h2>
        <p className="hint">
          MyAnimeList{settings.malUser ? ` (${settings.malUser})` : ""}: nuevos, notas, estados y progreso; quita lo que ya no
          esté en la lista. El RSS de Letterboxd{settings.letterboxdUser ? ` (${settings.letterboxdUser})` : ""} trae tus
          últimas ~50 entradas del diario y pasa a vistas las de la watchlist. También desde cada categoría, deslizando hacia
          abajo.
        </p>
        <div className="buttons">
          <button disabled={busy} onClick={() => run(async (stop) => addLog((await actualizarAnimeManga(settings, addLog, stop)).text), true)}>
            Anime y manga (MAL)
          </button>
          <button disabled={busy || !settings.letterboxdUser} onClick={() => run(async (stop) => addLog((await actualizarPeliculas(settings, addLog, stop)).text), true)}>
            Películas (RSS)
          </button>
        </div>
      </section>

      <section>
        <h2>Sinopsis y portadas</h2>
        <p className="hint">
          «Completar datos» busca lo que falte: portadas de MyAnimeList, sinopsis y pósters de TMDB para las películas
          (necesita la API key) y sinopsis y portadas de los libros en Wikipedia y Open Library (una petición por segundo,
          es lo más lento). «Descargar portadas» busca solo portadas. Ambos procesan solo lo pendiente y se pueden detener
          y reanudar.
        </p>
        <div className="buttons">
          <button disabled={busy} onClick={() => run((stop) => completarDatos(settings, addLog, stop), true)}>
            Completar datos
          </button>
          <button className="tonal" disabled={busy} onClick={() => run((stop) => descargarPortadas(settings, addLog, stop), true)}>
            Descargar portadas
          </button>
        </div>
      </section>

      <details className="section">
        <summary>
          <h2>Importar archivos</h2>
          <span className="hint">ZIP de Letterboxd y Excel de libros</span>
        </summary>
        <div className="section-body">
          <p className="hint">
            El ZIP exportado de Letterboxd sincroniza todo el historial (las películas no se duplican).
          </p>
          <label className="file">
            ZIP exportado de Letterboxd
            <input type="file" accept=".zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
          </label>
          <button
            disabled={busy || !zip}
            onClick={() =>
              run(async () => {
                await importLetterboxd(zip!, addLog);
                await markSynced("letterboxd");
              })
            }
          >
            Importar el ZIP
          </button>

          <p className="hint">
            Los libros nuevos se apuntan en Libros («Añadir libro»). El Excel queda como importación inicial: al reimportarlo
            se respetan los cambios hechos en la app y no vuelven los libros que hayas eliminado.
          </p>
          <label className="file">
            Libros leídos (.xlsx)
            <input type="file" accept=".xlsx" onChange={(e) => setLeidos(e.target.files?.[0] ?? null)} />
          </label>
          <label className="file">
            Libros sin leer (.xlsx)
            <input type="file" accept=".xlsx" onChange={(e) => setSinLeer(e.target.files?.[0] ?? null)} />
          </label>
          <button disabled={busy || !leidos || !sinLeer} onClick={() => run(() => importBooks(leidos!, sinLeer!, settings.sheets, addLog))}>
            Importar libros
          </button>
        </div>
      </details>

      <section>
        <h2>Copia de seguridad</h2>
        <p className="hint">
          Tu biblioteca se guarda en este dispositivo
          {storage?.persisted === true && " y está protegida para que no se borre por falta de espacio"}
          {storage?.persisted === false && ", pero el sistema puede borrarla si le falta espacio"}. Exporta una copia para
          no perderla o para pasarla a otro dispositivo (no incluye tus claves de Ajustes).
        </p>
        {storage && (
          <p className="hint">
            Espacio usado: <strong>{mb(storage.usage)} MB</strong> de {mb(storage.quota)} MB disponibles.
          </p>
        )}
        <div className="buttons">
          <button disabled={busy} onClick={() => run(() => exportBackup(addLog))}>
            Exportar copia
          </button>
          <button className="tonal" disabled={busy} onClick={() => run(() => exportBooksXlsx(addLog))}>
            Libros a Excel
          </button>
        </div>
        <label className="file">
          Restaurar una copia (.json)
          <input type="file" accept=".json,application/json" onChange={(e) => setBackup(e.target.files?.[0] ?? null)} />
        </label>
        <button className="tonal" disabled={busy || !backup} onClick={() => run(() => restoreBackup(backup!, addLog))}>
          Restaurar copia
        </button>
      </section>

      {log.length > 0 && (
        <section>
          <h2>Registro</h2>
          <pre className="log">{log.slice(-12).join("\n")}</pre>
          {stoppable && (
            <button className="ghost" onClick={onStop}>
              Detener
            </button>
          )}
        </section>
      )}
    </div>
  );
}
