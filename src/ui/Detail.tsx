import { useEffect, useRef, useState } from "react";
import type { Settings } from "../settings";
import { today } from "../libros";
import { isBookSource, Item, STATUS_LABEL, TYPE_LABEL } from "../types";
import Cover from "./Cover";
import CoverPicker from "./CoverPicker";
import { scoreText } from "./format";
import { IconBack, IconCheck, IconEdit, IconExternal, IconImage, IconTrash } from "./icons";

const SOURCE_LABEL: Record<string, string> = {
  "wikipedia-es": "Wikipedia (CC BY-SA)",
  "wikipedia-en": "Wikipedia en inglés (CC BY-SA)",
  openlibrary: "Open Library",
  "openlibrary-frase": "Open Library (primera frase del libro)",
};

const LONG_SYNOPSIS = 420; // a partir de aquí se recorta con «Leer más»

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

/** Línea bajo el título: año y dirección de una película, autor de un libro. */
function subtitle(i: Item) {
  if (i.type === "movie") return [i.extra.year, i.extra.director].filter(Boolean).join(" · ");
  return isBookSource(i) ? i.extra.author ?? "" : "";
}

/** Datos extra según el tipo: [etiqueta, valor] sin los vacíos (ni los que ya van bajo el título). */
function facts(i: Item): [string, string][] {
  const e = i.extra;
  const list = (xs?: string[]) => (xs?.length ? xs.join(", ") : "");
  const rows: [string, unknown][] =
    i.type === "movie"
      ? [
          ["Reparto", list(e.cast)],
          ["Dónde verla en España", list(e.providersEs)],
          ["Te gustó", e.liked ? "Sí ♥" : ""],
        ]
      : isBookSource(i)
        ? [
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
  const [expanded, setExpanded] = useState(false);
  const [bgFailed, setBgFailed] = useState(false);
  const [scrolled, setScrolled] = useState(false); // la cabecera se vuelve opaca al bajar
  const [error, setError] = useState("");
  useEffect(() => box.current?.focus(), [item?.key]);
  useEffect(() => {
    setPicking(false);
    setMarking(false);
    setConfirmDelete(false);
    setExpanded(false);
    setError("");
  }, [item?.key]);
  useEffect(() => setBgFailed(false), [item?.cover]);
  const act = async (fn: () => Promise<void>) => {
    setError("");
    try {
      await fn();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const sub = item ? subtitle(item) : "";
  const long = (item?.synopsis.length ?? 0) > LONG_SYNOPSIS;

  return (
    <div
      className={`detail ${item?.type ?? ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={item?.title ?? "Ficha"}
      ref={box}
      tabIndex={-1}
      onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 48)}
    >
      {/* Fondo: la portada desenfocada sobre el color de la categoría */}
      <div className="hero-bg" aria-hidden>
        {item?.cover && !bgFailed && <img src={item.cover} alt="" referrerPolicy="no-referrer" onError={() => setBgFailed(true)} />}
      </div>
      <header className={`top ${scrolled ? "scrolled" : ""}`}>
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
              {!picking && (
                <button className="cover-edit" onClick={() => setPicking(true)} aria-label={item.cover ? "Cambiar portada" : "Poner portada"} title={item.cover ? "Cambiar portada" : "Poner portada"}>
                  <IconImage />
                </button>
              )}
            </div>
            {item.extra.customCover && !picking && <p className="hint center">Portada elegida por ti</p>}
          </div>

          <div className="detail-main">
            {picking && <CoverPicker item={item} settings={settings} custom={!!item.extra.customCover} onClose={() => setPicking(false)} />}

            <div className="detail-head">
              <h1>{item.title}</h1>
              {sub && <p className="detail-sub">{sub}</p>}
              <p className="detail-meta">
                {item.userScore != null && (
                  <span className="score" aria-label={`Nota ${scoreText(item.userScore)}`}>
                    ★ {scoreText(item.userScore)}
                  </span>
                )}
                <span className={`status-pill ${item.status}`}>{STATUS_LABEL[item.status]}</span>
              </p>
            </div>

            {isBookSource(item) && (
              <div className="book-actions">
                {marking ? (
                  <div className="panel">
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
                  <div className="panel" role="alert">
                    <p>¿Eliminar «{item.title}» de tu biblioteca? No se puede deshacer{item.source === "excel" ? " (y no volverá al reimportar el Excel)" : ""}.</p>
                    <div className="row2">
                      <button className="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</button>
                      <button className="danger" onClick={() => act(() => onDelete(item.key))}>Eliminar</button>
                    </div>
                  </div>
                ) : (
                  <div className="row-actions">
                    {item.status === "plan" && (
                      <button onClick={() => { setScore(null); setDate(today()); setMarking(true); }}>
                        <IconCheck /> Marcar como leído
                      </button>
                    )}
                    <button className="tonal" onClick={() => onEdit(item.key)}>
                      <IconEdit /> Editar
                    </button>
                    <button className="ghost danger-text" onClick={() => setConfirmDelete(true)}>
                      <IconTrash /> Eliminar
                    </button>
                  </div>
                )}
                {error && <p className="warn" role="alert">{error}</p>}
              </div>
            )}

            {item.genres.length > 0 && (
              <ul className="tags">
                {[...new Set(item.genres)].slice(0, 12).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            )}

            {item.synopsis ? (
              <div className="synopsis-box">
                <p className={`synopsis ${long && !expanded ? "clamped" : ""}`}>{item.synopsis}</p>
                {long && (
                  <button className="link" onClick={() => setExpanded((x) => !x)} aria-expanded={expanded}>
                    {expanded ? "Leer menos" : "Leer más"}
                  </button>
                )}
              </div>
            ) : (
              <p className="hint">Sin sinopsis todavía. Prueba «Completar datos» en Datos.</p>
            )}
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
            {item.extra.userEdits && <p className="hint">Has editado este libro en la app: al reimportar el Excel se conservan tus cambios.</p>}

            {links(item).length > 0 && (
              <ul className="links">
                {links(item).map(([label, href]) => (
                  <li key={href}>
                    <a href={href} target="_blank" rel="noopener noreferrer">
                      <span>{label}</span>
                      <IconExternal />
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </article>
      )}
    </div>
  );
}
