import { useState } from "react";
import { importBooks } from "../ingest/books";
import { importLetterboxd } from "../ingest/letterboxd";
import { importMal } from "../ingest/mal";
import type { Settings } from "../settings";
import { ITEM_TYPES, ItemType, Log, TYPE_LABEL } from "../types";

export type Counts = Record<ItemType, { total: number; rated: number }>;

interface Props {
  settings: Settings;
  counts: Counts;
  log: string[];
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  addLog: Log;
}

export default function Data({ settings, counts, log, busy, run, addLog }: Props) {
  const [zip, setZip] = useState<File | null>(null);
  const [leidos, setLeidos] = useState<File | null>(null);
  const [sinLeer, setSinLeer] = useState<File | null>(null);

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
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Anime y manga</h2>
        <p className="hint">Lee tu lista pública de MyAnimeList{settings.malUser ? ` (${settings.malUser})` : ""}. Tarda unos minutos la primera vez.</p>
        <button disabled={busy} onClick={() => run(() => importMal(settings.malUser, addLog))}>
          Importar desde MyAnimeList
        </button>
      </section>

      <section>
        <h2>Películas</h2>
        <p className="hint">Elige el ZIP que exportas desde Letterboxd.</p>
        <input type="file" accept=".zip" onChange={(e) => setZip(e.target.files?.[0] ?? null)} />
        <button disabled={busy || !zip} onClick={() => run(() => importLetterboxd(zip!, settings.tmdbKey, addLog))}>
          Importar películas
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
          onClick={() => run(() => importBooks(leidos!, sinLeer!, settings.sheets, settings.booksKey, addLog))}
        >
          Importar libros
        </button>
      </section>

      {log.length > 0 && (
        <section>
          <h2>Registro</h2>
          <pre className="log">{log.slice(-12).join("\n")}</pre>
        </section>
      )}
    </div>
  );
}
