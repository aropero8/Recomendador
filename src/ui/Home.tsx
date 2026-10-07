import { useMemo } from "react";
import { Item, ItemType, ITEM_TYPES, TYPE_LABEL } from "../types";
import Cover from "./Cover";
import { progress, scoreText, titles, when } from "./format";
import { IconChevron, IconData, IconSettings, IconSparkle } from "./icons";

const byScore = (a: Item, b: Item) => (b.userScore ?? -1) - (a.userScore ?? -1) || a.title.localeCompare(b.title);
const byRecent = (a: Item, b: Item) => when(b) - when(a);

/** Mosaico: los 3 mejor puntuados que tengan portada (o los 3 mejor puntuados si ninguno la tiene). */
function topCovers(xs: Item[]) {
  const withCover = xs.filter((i) => i.cover).sort(byScore);
  return (withCover.length ? withCover : [...xs].sort(byScore)).slice(0, 3);
}

function greeting() {
  const h = new Date().getHours();
  return h >= 6 && h < 14 ? "Buenos días" : h >= 14 && h < 21 ? "Buenas tardes" : "Buenas noches";
}

interface Props {
  items: Item[] | null;
  openCategory: (t: ItemType) => void;
  openItem: (i: Item) => void;
  openData: () => void;
  openSettings: () => void;
  onRecommend: () => void;
}

export default function Home({ items, openCategory, openItem, openData, openSettings, onRecommend }: Props) {
  const groups = useMemo(() => {
    const g = {} as Record<ItemType, Item[]>;
    for (const t of ITEM_TYPES) g[t] = [];
    for (const i of items ?? []) g[i.type]?.push(i);
    return g;
  }, [items]);

  // Estanterías: lo que tienes a medias y lo último que has terminado
  const shelves = useMemo(() => {
    const xs = items ?? [];
    return [
      { title: "Continúa", items: xs.filter((i) => i.status === "reading").sort(byRecent).slice(0, 20) },
      { title: "Terminado hace poco", items: xs.filter((i) => i.status === "read" && when(i)).sort(byRecent).slice(0, 20) },
    ].filter((s) => s.items.length);
  }, [items]);

  const empty = items !== null && items.length === 0;

  return (
    <div className="narrow stack home-page">
      <div className="hello">
        <h1 className="welcome">{greeting()}</h1>
        <p className="hint">{items === null ? "Cargando tu biblioteca…" : empty ? "Tu biblioteca está vacía" : `${titles(items.length)} en tu biblioteca`}</p>
      </div>

      {empty && (
        <section className="onboarding">
          <h2>Empieza en dos pasos</h2>
          <button className="step" onClick={openSettings}>
            <span className="step-n">1</span>
            <span className="step-text">
              <strong>Tus cuentas</strong>
              <small>Usuario de MyAnimeList y Letterboxd, claves de MAL y TMDB</small>
            </span>
            <IconSettings />
          </button>
          <button className="step" onClick={openData}>
            <span className="step-n">2</span>
            <span className="step-text">
              <strong>Importa tus listas</strong>
              <small>MyAnimeList, Letterboxd y tus Excel de libros</small>
            </span>
            <IconData />
          </button>
        </section>
      )}

      {!empty && items !== null && (
        <button className="reco-hero" onClick={onRecommend}>
          <span className="reco-hero-icon">
            <IconSparkle />
          </span>
          <span className="reco-hero-text">
            <strong>Recomiéndame</strong>
            <small>Anime, manga, películas o libros según tus gustos</small>
          </span>
          <IconChevron />
        </button>
      )}

      <div className="tiles">
        {ITEM_TYPES.map((t) => {
          const n = groups[t].length;
          return (
            <button key={t} className={`tile ${t}`} onClick={() => (n ? openCategory(t) : openData())}>
              <div className="mosaic">
                {topCovers(groups[t]).map((i) => (
                  <Cover key={i.key} item={i} eager />
                ))}
              </div>
              <div className="tile-text">
                <strong>{TYPE_LABEL[t]}</strong>
                <span>{items === null ? "…" : n ? titles(n) : "Vacío · Importar"}</span>
              </div>
            </button>
          );
        })}
      </div>

      {shelves.map((s) => (
        <section key={s.title} className="shelf" aria-label={s.title}>
          <h2>{s.title}</h2>
          <ul className="shelf-row">
            {s.items.map((i) => {
              const p = progress(i);
              return (
                <li key={i.key}>
                  <button className={`card ${i.type}`} onClick={() => openItem(i)}>
                    <div className="card-cover">
                      <Cover item={i} />
                      {i.userScore != null && <span className="badge">{scoreText(i.userScore)}</span>}
                      {i.status === "reading" && p != null && (
                        <span className="bar" aria-label={`${Math.round(p * 100)} %`}>
                          <span style={{ width: `${p * 100}%` }} />
                        </span>
                      )}
                    </div>
                    <span className="card-title">{i.title}</span>
                    <span className="card-type">{TYPE_LABEL[i.type]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {!empty && items !== null && (
        <button className="row-link" onClick={openData}>
          <IconData />
          <span>Importar, completar datos y copias de seguridad</span>
          <IconChevron />
        </button>
      )}
    </div>
  );
}
