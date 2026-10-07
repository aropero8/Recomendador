import { FormEvent, useEffect, useState } from "react";
import { buscarCandidatas, Candidate } from "../covers/candidates";
import { removeCover, setCoverFile, setCoverUrl } from "../covers/user";
import type { Settings } from "../settings";
import type { Item } from "../types";

interface Props {
  item: Item;
  settings: Settings;
  custom: boolean; // ya tiene una portada elegida a mano
  onClose: () => void;
}

/** Elegir portada: propuestas de las fuentes gratuitas, un enlace pegado o una foto (galería o cámara). */
export default function CoverPicker({ item, settings, custom, onClose }: Props) {
  const [found, setFound] = useState<Candidate[] | null>(null);
  const [error, setError] = useState("");
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setFound(null);
    buscarCandidatas(item, settings).then(
      (c) => alive && setFound(c),
      (e) => {
        if (!alive) return;
        setFound([]);
        setError(e?.message ?? String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [item.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (fn: () => Promise<unknown>) => {
    setSaving(true);
    setError("");
    try {
      await fn();
      onClose();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  const onUrl = (e: FormEvent) => {
    e.preventDefault();
    save(() => setCoverUrl(item.key, url));
  };

  return (
    <section className="picker" aria-label="Elegir portada">
      <div className="picker-head">
        <h2>Elegir portada</h2>
        <button className="ghost" onClick={onClose}>
          Cerrar
        </button>
      </div>

      {found === null ? (
        <p className="hint">Buscando portadas…</p>
      ) : found.length ? (
        <ul className="picker-grid">
          {found.map((c) => (
            <li key={c.url}>
              <button className="picker-option" disabled={saving} onClick={() => save(() => setCoverUrl(item.key, c.url))} title={c.label}>
                <img src={c.url} alt={c.label} loading="lazy" referrerPolicy="no-referrer" onError={(e) => (e.currentTarget.closest("li")!.hidden = true)} />
                <span>{c.label}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        !error && <p className="hint">No he encontrado otras portadas. Pega un enlace o sube una foto.</p>
      )}

      <form className="picker-url" onSubmit={onUrl}>
        <label>
          Enlace de una imagen
          <input type="url" inputMode="url" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} autoCapitalize="none" />
        </label>
        <button disabled={saving || !url.trim()}>Usar enlace</button>
      </form>

      <label className="picker-file">
        <input type="file" accept="image/*" disabled={saving} onChange={(e) => e.target.files?.[0] && save(() => setCoverFile(item.key, e.target.files![0]))} />
        <span>Subir una foto</span>
      </label>
      <p className="hint">Puedes hacerle una foto a tu ejemplar. Se reduce y se guarda solo en este dispositivo.</p>

      {custom && (
        <button className="ghost" disabled={saving} onClick={() => save(() => removeCover(item.key))}>
          Volver a la portada automática
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
