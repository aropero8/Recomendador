import { liveQuery } from "dexie";
import { useEffect, useState } from "react";
import { db } from "../db";
import type { RecoRequest, RecoSource } from "../reco/gemini";
import { addFeedback, type LastRuns } from "../reco/recommend";
import type { Reco } from "../reco/verify";
import { timeAgo } from "../sync";
import { ITEM_TYPES, type Item, type ItemType } from "../types";
import Cover from "./Cover";
import { IconCategory, IconExternal, IconSparkle } from "./icons";

const WHAT: Record<ItemType, string> = { anime: "Anime", manga: "Manga", movie: "Película", book: "Libro" };
const PLURAL: Record<ItemType, string> = { anime: "anime", manga: "manga", movie: "películas", book: "libros" };
const SOURCES: [RecoSource, string][] = [
  ["pending", "Pendientes"],
  ["new", "Algo nuevo"],
  ["both", "Ambos"],
];
const SITE: Record<Reco["source"], string> = { biblioteca: "tu biblioteca", mal: "MyAnimeList", tmdb: "TMDB", openlibrary: "Open Library" };

interface Props {
  items: Item[]; // tu biblioteca tal como se muestra
  initialType?: ItemType;
  busy: boolean;
  onRecommend: (req: RecoRequest) => void;
  onCopyProfile: () => void;
  onAddBook: (r: Reco) => void;
  onOpenItem: (r: Reco) => void;
}

/** Para reutilizar la portada con iniciales de la biblioteca. */
const asItem = (r: Reco): Item => ({ key: r.id, source: "app", type: r.type, title: r.title, synopsis: "", genres: [], userScore: null, status: "plan", extra: {}, cover: r.cover });

/** Dónde añadirlo a pendientes: los libros en la app; el resto, en MAL o Letterboxd. */
function addLink(r: Reco): [string, string] | null {
  if (r.type === "movie" && r.extId) return ["Añadir en Letterboxd", `https://letterboxd.com/tmdb/${r.extId}/`];
  if ((r.type === "anime" || r.type === "manga") && r.url) return ["Añadir en MyAnimeList", r.url];
  return null;
}

/** «Recomiéndame»: qué quieres, de dónde y lo que te apetece; debajo, las últimas recomendaciones de esa categoría. */
export default function Recommend({ items, initialType, busy, onRecommend, onCopyProfile, onAddBook, onOpenItem }: Props) {
  const [type, setType] = useState<ItemType>(initialType ?? "book");
  const [source, setSource] = useState<RecoSource>("both");
  const [wish, setWish] = useState("");
  const [allTastes, setAllTastes] = useState(false);
  const [ocean, setOcean] = useState(false);
  const [runs, setRuns] = useState<LastRuns>({});

  // Las últimas recomendaciones se guardan en meta: se ven al momento cuando llegan unas nuevas
  useEffect(() => {
    const sub = liveQuery(() => db.meta.get("recoLast")).subscribe({ next: (m) => setRuns((m?.value as LastRuns) ?? {}), error: () => setRuns({}) });
    return () => sub.unsubscribe();
  }, []);

  const pending = items.filter((i) => i.type === type && i.status === "plan").length;
  const run = runs[type];

  return (
    <div className={`narrow stack reco cat-scope ${type}`}>
      <section>
        <h2>¿Qué te apetece?</h2>
        <div className="type-picker" role="radiogroup" aria-label="Qué quieres">
          {ITEM_TYPES.map((t) => (
            <button key={t} role="radio" aria-checked={type === t} className={`type-option ${t} ${type === t ? "on" : ""}`} onClick={() => setType(t)}>
              <IconCategory type={t} />
              {WHAT[t]}
            </button>
          ))}
        </div>
        <div className="segmented" role="radiogroup" aria-label="De dónde">
          {SOURCES.map(([s, text]) => (
            <button key={s} role="radio" aria-checked={source === s} className={source === s ? "on" : ""} onClick={() => setSource(s)}>
              {text}
            </button>
          ))}
        </div>
        {source === "pending" && !pending && <p className="hint">No tienes {PLURAL[type]} pendientes: elige «Algo nuevo» o «Ambos».</p>}
        <label>
          Lo que te apetece (opcional)
          <textarea rows={2} value={wish} onChange={(e) => setWish(e.target.value)} placeholder="«algo corto y oscuro», «parecido a Steins;Gate»…" />
        </label>
        <label className="switch-row">
          <span>
            Basado en todos mis gustos
            <small>También anime, manga, películas y libros: recomendaciones cruzadas</small>
          </span>
          <input type="checkbox" role="switch" checked={allTastes} onChange={(e) => setAllTastes(e.target.checked)} />
        </label>
        {type === "book" && source !== "pending" && (
          <label className="switch-row">
            <span>
              Pistas de «An Ocean of Books» (experimental)
              <small>Libros cercanos a tus favoritos en un mapa de Google; Gemini elige los que encajan</small>
            </span>
            <input type="checkbox" role="switch" checked={ocean} onChange={(e) => setOcean(e.target.checked)} />
          </label>
        )}
        <button
          className="big"
          disabled={busy || (source === "pending" && !pending)}
          onClick={() => onRecommend({ type, source, wish, allTastes, ...(type === "book" && source !== "pending" && ocean && { ocean: true }) })}
        >
          <IconSparkle /> Recomiéndame {PLURAL[type]}
        </button>
        <button className="ghost" onClick={onCopyProfile}>
          Copiar mi perfil
        </button>
        <p className="hint">Para pegarlo en cualquier chat de IA (ChatGPT, Gemini, Claude…) si no quieres gastar peticiones aquí.</p>
      </section>

      {run && (
        <section className="reco-results">
          <div>
            <h2>Últimas recomendaciones de {PLURAL[type]}</h2>
            <p className="hint">
              {timeAgo(run.at)}
              {run.request.wish.trim() && ` · «${run.request.wish.trim()}»`}
              {run.request.allTastes && " · basado en todos tus gustos"}
              {run.map &&
                (run.map.candidates
                  ? ` · con el mapa (${run.map.candidates} libros cerca de ${run.map.anchors} de tus favoritos)`
                  : " · el mapa no encontró libros cerca de tus favoritos")}
            </p>
          </div>
          {!run.recos.length && <p className="empty">No queda ninguna. Pide unas nuevas.</p>}
          <ul className="reco-list">
            {run.recos.map((r) => {
              const link = addLink(r);
              return (
                <li key={r.id} className={`reco-card ${r.type}`}>
                  <div className="reco-top">
                    <div className="reco-cover">
                      <Cover item={asItem(r)} />
                    </div>
                    <div className="reco-body">
                      <strong>{r.title}</strong>
                      <span className="hint">{[r.originalTitle !== r.title && r.originalTitle, r.year, r.author].filter(Boolean).join(" · ")}</span>
                      {r.inPending && <span className="pill">En tus pendientes</span>}
                      {r.fromMap && <span className="pill">Del mapa</span>}
                      <p className="reco-reason">{r.reason}</p>
                    </div>
                  </div>
                  {r.synopsis && (
                    <details>
                      <summary>Sinopsis</summary>
                      <p>{r.synopsis}</p>
                    </details>
                  )}
                  <div className="row-actions">
                    {r.inPending && r.libraryKey ? (
                      <button className="tonal" onClick={() => onOpenItem(r)}>
                        Ver ficha
                      </button>
                    ) : r.type === "book" ? (
                      <button onClick={() => onAddBook(r)}>Añadir a pendientes</button>
                    ) : (
                      link && (
                        <a className="button-link" href={link[1]} target="_blank" rel="noopener noreferrer">
                          {link[0]} <IconExternal />
                        </a>
                      )
                    )}
                    <button className="ghost" onClick={() => addFeedback(r, "seen")}>
                      Ya lo he visto
                    </button>
                    <button className="ghost" onClick={() => addFeedback(r, "dismissed")}>
                      No me interesa
                    </button>
                  </div>
                  {r.url && r.source !== "biblioteca" && (
                    <a className="reco-site" href={r.url} target="_blank" rel="noopener noreferrer">
                      Ver en {SITE[r.source]}
                    </a>
                  )}
                </li>
              );
            })}
          </ul>
          {run.dropped.unverified.length > 0 && (
            <p className="hint">No se pudieron comprobar (descartadas): {run.dropped.unverified.join(" · ")}</p>
          )}
        </section>
      )}
    </div>
  );
}
