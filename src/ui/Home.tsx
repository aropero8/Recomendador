import { useMemo } from "react";
import { SyncTimes, timeAgo } from "../sync";
import { Item, ItemType, ITEM_TYPES, TYPE_LABEL } from "../types";
import Cover from "./Cover";

const byScore = (a: Item, b: Item) => (b.userScore ?? -1) - (a.userScore ?? -1) || a.title.localeCompare(b.title);

/** Mosaico: los 3 mejor puntuados que tengan portada (o los 3 mejor puntuados si ninguno la tiene). */
function topCovers(xs: Item[]) {
  const withCover = xs.filter((i) => i.cover).sort(byScore);
  return (withCover.length ? withCover : [...xs].sort(byScore)).slice(0, 3);
}

interface Props {
  items: Item[] | null;
  openCategory: (t: ItemType) => void;
  openData: () => void;
  syncTimes: SyncTimes;
  busy: boolean;
  onUpdateAll: () => void;
}

export default function Home({ items, openCategory, openData, syncTimes, busy, onUpdateAll }: Props) {
  const groups = useMemo(() => {
    const g = {} as Record<ItemType, Item[]>;
    for (const t of ITEM_TYPES) g[t] = [];
    for (const i of items ?? []) g[i.type]?.push(i);
    return g;
  }, [items]);

  return (
    <div className="narrow stack">
      <h1 className="welcome">Bienvenido de nuevo</h1>
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
                <span>{items === null ? "…" : n ? `${n} ${n === 1 ? "título" : "títulos"}` : "Vacío · Importar"}</span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="update-all">
        <button className="ghost" disabled={busy} onClick={onUpdateAll}>
          Actualizar todo
        </button>
        <p className="hint">
          MyAnimeList: {syncTimes.mal ? `actualizado ${timeAgo(syncTimes.mal)}` : "sin actualizar"} · Letterboxd:{" "}
          {syncTimes.letterboxd ? `actualizado ${timeAgo(syncTimes.letterboxd)}` : "sin actualizar"}
        </p>
      </div>
    </div>
  );
}
