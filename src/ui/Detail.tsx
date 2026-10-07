import { useEffect, useRef, useState } from "react";
import type { Settings } from "../settings";
import { Item, STATUS_LABEL, TYPE_LABEL } from "../types";
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
      : i.source === "excel"
        ? [
            ["Autor", e.author],
            ["Tomos", e.volumes > 1 ? e.volumes : ""],
            ["Páginas", e.pages],
            ["Formato", e.format],
            ["Leído en", i.status === "plan" ? "" : e.yearRead],
            ["Prioridad", e.priority],
          ]
        : [
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
}

export default function Detail({ item, settings, onBack }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [picking, setPicking] = useState(false);
  useEffect(() => box.current?.focus(), [item?.key]);
  useEffect(() => setPicking(false), [item?.key]);

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
