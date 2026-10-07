import { useEffect, useRef, useState } from "react";
import type { Settings } from "../settings";
import { today } from "../libros";
import { isBookSource, Item, STATUS_LABEL, TYPE_LABEL } from "../types";
import { scoreText } from "./Category";
import Cover from "./Cover";
import CoverPicker from "./CoverPicker";
import { IconBack } from "./icons";

const SOURCE_LABEL: Record<string, string> = {
  "wikipedia-es": "Wikipedia (CC BY-SA)",
  "wikipedia-en": "Wikipedia en inglés (CC BY-SA)",
  openlibrary: "Open Library",
  "openlibrary-frase": "Open Library (primera frase del libro)",
};

const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });

/** Progreso de MAL: «12 / 24 episodios», «50 / 120 capítulos · 5 / 12 tomos». */
function progressText(i: Item) {
  const p = i.extra.progress;
  if (!p) return "";
  const of = (n: number, total: number | null, unit: string) => `${n}${total ? ` / ${total}` : ""} ${unit}`;
  if (i.type === "anime") return p.episodes || p.totalEpisodes ? of(p.episodes, p.totalEpisodes, "episodios") : "";
  return [p.chapters || p.totalChapters ? of(p.chapters, p.totalChapters, "capítulos") : "", p.volumes || p.totalVolumes ? of(p.volumes, p.totalVolumes, "tomos") : ""]
    .filter(Boolean)
    .join(" · ");
}

/** Datos extra según el tipo: [etiqueta, valor] sin los vacíos. */
function facts(i: Item): [string, string][] {
  const e = i.extra;
  const list = (xs?: string[]) => (xs?.length ? xs.join(", ") : "");
  const rows: [string, unknown][] =
    i.type === "movie"
      ? [
          ["Año", e.year],
          ["Dirección", e.director],
          ["Reparto", list(e.cast)],
          ["Dónde verla en España", list(e.providersEs)],
          ["Te gustó", e.liked ? "Sí ♥" : ""],
        ]
      : isBookSource(i)
        ? [
            ["Autor", e.author],
            ["Tomos", e.volumes > 1 ? e.volumes : ""],
            ["Páginas", e.pages],
            ["Formato", e.format],
            i.status === "read" && e.date ? ["Leído el", longDate(e.date)] : ["Leído en", i.status === "plan" ? "" : e.yearRead],
            ["Prioridad", e.priority],
          ]
        : [
            ["Progreso", progressText(i)],
            ["Otros títulos", list((e.altTitles ?? []).filter((t: string) => t !== i.title))],
            ["En papel (tu Excel)", e.paper ? `${e.paper.volumes} ${e.paper.volumes === 1 ? "tomo leído" : "tomos leídos"}${e.paper.score != null ? `, nota media ${scoreText(e.paper.score)}` : ""}` : ""],
          ];
  return rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, String(v)]);
}

function links(i: Item): [string, string][] {
  const e = i.extra;
  const out: [string, string][] = [];
  if (e.synopsisUrl) out.push([`Sinopsis: ${SOURCE_LABEL[e.synopsisSource] ?? "fuente"}`, e.synopsisUrl]);
  if (e.malId) out.push(["Ver en MyAnimeList", `https://myanimelist.net/${i.type}/${e.malId}`]);
  if (e.tmdbId) out.push(["Ver en TMDB", `https://www.themoviedb.org/movie/${e.tmdbId}`]);
  return out;
}

interface Props {
  item: Item | undefined;
  settings: Settings;
  onBack: () => void;
  onEdit: (key: string) => void;
  onMarkRead: (key: string, score: number | null, date: string) => Promise<void>;
  onDelete: (key: string) => Promise<void>;
}

export default function Detail({ item, settings, onBack, onEdit, onMarkRead, onDelete }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  const [marking, setMarking] = useState(false); // «Marcar como leído»: pide nota y fecha
  const [score, setScore] = useState<number | null>(null);
  const [date, setDate] = useState(today());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => box.current?.focus(), [item?.key]);
  useEffect(() => {
    setPicking(false);
    setMarking(false);
    setConfirmDelete(false);
    setError("");
  }, [item?.key]);
  const act = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className="detail" role="dialog" aria-modal="true" aria-label={item?.title ?? "Ficha"} ref={box} tabIndex={-1}>
      <header className="top">
        <button className="icon" onClick={onBack} aria-label="Volver">
          <IconBack />
        </button>
        <span className="top-title">{item ? TYPE_LABEL[item.type] : ""}</span>
      </header>
      {!item ? (
        <p className="empty">Este título ya no está en tu biblioteca.</p>
      ) : (
        <article className="detail-body">
          <div className="detail-side">
            <div className="detail-cover">
              <Cover item={item} eager />
            </div>
            {!picking && (
              <button className="ghost" onClick={() => setPicking(true)}>
                {item.cover ? "Cambiar portada" : "Poner portada"}
              </button>
            )}
            {item.extra.customCover && !picking && <p className="hint center">Portada elegida por ti</p>}
          </div>
          <div className="detail-main">
            {picking && <CoverPicker item={item} settings={settings} custom={!!item.extra.customCover} onClose={() => setPicking(false)} />}
            <h1>{item.title}</h1>
            <p className="detail-meta">
              {item.userScore != null && <span className={`badge big ${item.type}`}>{scoreText(item.userScore)}</span>}
              <span>{STATUS_LABEL[item.status]}</span>
            </p>
            {item.genres.length > 0 && (
              <ul className="tags">
                {[...new Set(item.genres)].slice(0, 12).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}
            {item.synopsis ? <p className="synopsis">{item.synopsis}</p> : <p className="hint">Sin sinopsis todavía. Prueba «Completar datos» en Datos.</p>}
            {item.extra.synopsisSource && !item.extra.synopsisUrl && (
              <p className="hint">Sinopsis: {SOURCE_LABEL[item.extra.synopsisSource] ?? item.extra.synopsisSource}</p>
            )}
            {facts(item).length > 0 && (
              <dl className="facts">
                {facts(item).map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {isBookSource(item) && (
              <div className="book-actions">
                {marking ? (
                  <div className="mark-read">
                    <div className="row2">
                      <label>
                        Nota (0-10)
                        <input type="number" inputMode="decimal" min={0} max={10} step={0.5} value={score ?? ""} autoFocus
                          onChange={(e) => setScore(e.target.value === "" ? null : Math.min(10, Math.max(0, Number(e.target.value))))} />
                      </label>
                      <label>
                        Fecha de lectura
                        <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} />
                      </label>
                    </div>
                    <div className="row2">
                      <button className="ghost" onClick={() => setMarking(false)}>Cancelar</button>
                      <button onClick={() => act(async () => { await onMarkRead(item.key, score == null ? null : Math.round(score * 2) / 2, date); setMarking(false); })}>
                        Guardar como leído
                      </button>
                    </div>
                  </div>
                ) : confirmDelete ? (
                  <div className="confirm" role="alert">
                    <p>¿Eliminar «{item.title}» de tu biblioteca? No se puede deshacer{item.source === "excel" ? " (y no volverá al reimportar el Excel)" : ""}.</p>
                    <div className="row2">
                      <button className="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                      <button className="danger" onClick={() => act(() => onDelete(item.key))}>Eliminar</button>
                    </div>
                  </div>
                ) : (
                  <div className="row-actions">
                    <button className="ghost" onClick={() => onEdit(item.key)}>Editar</button>
                    {item.status === "plan" && (
                      <button className="ghost" onClick={() => { setScore(null); setDate(today()); setMarking(true); }}>Marcar como leído</button>
                    )}
                    <button className="ghost danger-text" onClick={() => setConfirmDelete(true)}>Eliminar</button>
                  </div>
                )}
                {error && <p className="warn" role="alert">{error}</p>}
                {item.extra.userEdits && <p className="hint">Has editado este libro en la app: al reimportar el Excel se conservan tus cambios.</p>}
              </div>
            )}
            {links(item).length > 0 && (
              <p className="links">
                {links(item).map(([label, href]) => (
                  <a key={href} href={href} target="_blank" rel="noopener noreferrer">
                    {label}
                  </a>
                ))}
              </p>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
