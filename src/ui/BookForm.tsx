import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { BOOK_STATUS, BookInput, bookToInput, findDuplicate, FORMATS, Suggestion, suggestBooks, today } from "../libros";
import type { Item } from "../types";
import { IconBack } from "./icons";

const PRIORITIES: [number, string][] = [
  [1, "1 · Máxima"],
  [2, "2 · Alta"],
  [3, "3 · Media"],
  [4, "4 · Baja"],
  [5, "5 · Muy baja"],
];

interface Props {
  item?: Item; // editar; sin item, añadir
  items: Item[]; // para avisar si ya existe
  onSave: (b: BookInput) => Promise<void>;
  onCancel: () => void;
}

/** Formulario para apuntar un libro o editarlo, con sugerencias de Open Library mientras escribes el título. */
export default function BookForm({ item, items, onSave, onCancel }: Props) {
  const [b, setB] = useState<BookInput>(() =>
    item ? bookToInput(item) : { title: "", author: "", status: "read", score: null, date: today(), format: "Papel", priority: 3 },
  );
  const [sugs, setSugs] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState<Suggestion | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const typing = useRef(false); // solo se sugiere mientras escribes, no al abrir para editar ni tras elegir
  const seq = useRef(0); // para descartar respuestas viejas
  const set = <K extends keyof BookInput>(k: K, v: BookInput[K]) => setB((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    const q = b.title.trim();
    if (!typing.current || q.length < 3) {
      setSugs([]);
      return;
    }
    const n = ++seq.current;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await suggestBooks(q);
        if (n === seq.current) setSugs(r);
      } catch {
        if (n === seq.current) setSugs([]);
      } finally {
        if (n === seq.current) setSearching(false);
      }
    }, 600);
    return () => clearTimeout(t);
  }, [b.title]);

  const pick = (s: Suggestion) => {
    typing.current = false;
    seq.current++;
    setSugs([]);
    setSearching(false);
    setPicked(s);
    // Al añadir rellena autor y páginas; al editar, solo lo que esté vacío
    setB((x) => ({
      ...x,
      author: item && x.author ? x.author : s.author || x.author,
      pages: item && x.pages ? x.pages : s.pages ?? x.pages,
      cover: s.cover,
      olKey: s.key,
    }));
  };

  const dup = useMemo(
    () => (item ? undefined : findDuplicate(items, b.title.trim(), b.author.trim())),
    [items, item, b.title, b.author],
  );
  useEffect(() => setConfirmDup(false), [dup?.key]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (!b.title.trim()) return setError("Escribe el título.");
    if (dup && !confirmDup) return setConfirmDup(true);
    setSaving(true);
    try {
      await onSave({ ...b, score: b.status === "read" && b.score != null ? Math.round(b.score * 2) / 2 : null });
    } catch (err: any) {
      setError(err?.message ?? String(err));
      setSaving(false);
    }
  };

  const formats = b.format && !FORMATS.includes(b.format) ? [...FORMATS, b.format] : FORMATS; // los del Excel pueden ser otros

  return (
    <div className="detail sheet book" role="dialog" aria-modal="true" aria-label={item ? "Editar libro" : "Añadir libro"}>
      <header className="top">
        <button className="icon" onClick={onCancel} aria-label="Volver">
          <IconBack />
        </button>
        <span className="top-title">{item ? "Editar libro" : "Añadir libro"}</span>
      </header>
      <form className="narrow book-form stack" onSubmit={submit}>
        <label>
          Título
          <input
            value={b.title}
            onChange={(e) => {
              typing.current = true;
              setPicked(null);
              set("title", e.target.value);
            }}
            autoFocus={!item}
            autoComplete="off"
            required
          />
        </label>
        {(searching || sugs.length > 0) && (
          <ul className="suggestions" aria-label="Sugerencias de Open Library">
            {searching && !sugs.length && <li className="hint">Buscando en Open Library…</li>}
            {sugs.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => pick(s)}>
                  {s.cover ? <img src={s.cover} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="sug-ph" />}
                  <span>
                    <strong>{s.title}</strong>
                    <small>{[s.author, s.year, s.pages && `${s.pages} págs.`].filter(Boolean).join(" · ")}</small>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {picked && (
          <p className="hint picked">
            {picked.cover && <img src={picked.cover} alt="" referrerPolicy="no-referrer" />}
            Datos de Open Library: «{picked.title}». Al guardar se busca también la sinopsis.
          </p>
        )}
        <label>
          Autor
          <input value={b.author} onChange={(e) => set("author", e.target.value)} autoComplete="off" />
        </label>

        <div className="field">
          <span>Estado</span>
          <div className="chips" role="radiogroup" aria-label="Estado">
            {BOOK_STATUS.map(([s, label]) => (
              <button key={s} type="button" role="radio" aria-checked={b.status === s} className={`chip ${b.status === s ? "on book" : ""}`} onClick={() => set("status", s)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {b.status === "read" && (
          <div className="row2">
            <label>
              Nota (0-10)
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={10}
                step={0.5}
                value={b.score ?? ""}
                onChange={(e) => set("score", e.target.value === "" ? null : Math.min(10, Math.max(0, Number(e.target.value))))}
              />
            </label>
            <label>
              Fecha de lectura
              <input type="date" value={b.date} max={today()} onChange={(e) => set("date", e.target.value)} />
            </label>
          </div>
        )}

        <div className="row2">
          <label>
            Páginas
            <input type="number" inputMode="numeric" min={1} value={b.pages ?? ""} onChange={(e) => set("pages", e.target.value ? Number(e.target.value) : undefined)} />
          </label>
          <label>
            Formato
            <select value={b.format ?? ""} onChange={(e) => set("format", e.target.value || undefined)}>
              <option value="">—</option>
              {formats.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
        </div>

        {b.status === "plan" && (
          <label>
            Prioridad
            <select value={b.priority ?? ""} onChange={(e) => set("priority", e.target.value ? Number(e.target.value) : null)}>
              <option value="">—</option>
              {PRIORITIES.map(([n, label]) => (
                <option key={n} value={n}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}

        {dup && confirmDup && (
          <p className="warn" role="alert">
            Ya tienes «{dup.title}»{dup.extra.author ? ` de ${dup.extra.author}` : ""}. Pulsa «Añadir igualmente» si es otro ejemplar o edición.
          </p>
        )}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions row2">
          <button type="button" className="ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Guardando…" : dup && confirmDup ? "Añadir igualmente" : item ? "Guardar cambios" : "Añadir libro"}
          </button>
        </div>
      </form>
    </div>
  );
}
