import { useEffect, useMemo, useRef, useState } from "react";
import { norm } from "../lib/text";
import { Item, ItemType, Status } from "../types";
import Cover from "./Cover";

const STATUS_FILTERS: [Status | "all", string][] = [
  ["all", "Todo"],
  ["read", "Terminado"],
  ["reading", "En curso"],
  ["plan", "Pendiente"],
];
type Sort = "score" | "title" | "recent";
const SORTS: [Sort, string][] = [
  ["score", "Mejor nota"],
  ["title", "A-Z"],
  ["recent", "Recientes"],
];
const PAGE = 60; // portadas que se añaden cada vez que se llega al final

/** Fecha para «Recientes»: la que traiga la importación o, en libros, el año de lectura. */
const when = (i: Item) => Date.parse(i.extra.date ?? "") || (i.extra.yearRead ? Date.UTC(i.extra.yearRead, 0, 1) : 0);

export const scoreText = (s: number) => s.toFixed(1).replace(".0", "");

interface Props {
  items: Item[];
  type: ItemType;
  onOpen: (key: string) => void;
}

export default function Category({ items, type, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const shown = useMemo(() => {
    const q = norm(query);
    const xs = items.filter(
      (i) => i.type === type && (status === "all" || i.status === status) && (!q || norm(i.title).includes(q)),
    );
    const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title, "es");
    return xs.sort(
      sort === "title"
        ? byTitle
        : sort === "recent"
          ? (a, b) => when(b) - when(a) || byTitle(a, b)
          : (a, b) => (b.userScore ?? -1) - (a.userScore ?? -1) || byTitle(a, b),
    );
  }, [items, type, status, query, sort]);

  useEffect(() => setLimit(PAGE), [type, status, query, sort]);

  // Scroll infinito: al acercarse al final se añaden más portadas
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, limit]);

  const rated = shown.filter((i) => i.userScore != null);
  const avg = rated.length ? rated.reduce((a, i) => a + i.userScore!, 0) / rated.length : null;

  return (
    <div className="stack">
      <div className="filters">
        <input type="search" placeholder="Buscar por título" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips" role="group" aria-label="Estado">
          {STATUS_FILTERS.map(([s, label]) => (
            <button key={s} className={`chip ${status === s ? `on ${type}` : ""}`} onClick={() => setStatus(s)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips" role="group" aria-label="Orden">
          {SORTS.map(([s, label]) => (
            <button key={s} className={`chip ${sort === s ? `on ${type}` : ""}`} onClick={() => setSort(s)}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">
          {shown.length} {shown.length === 1 ? "título" : "títulos"}
          {avg != null && ` · nota media ${avg.toFixed(1)} (${rated.length} con nota)`}
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="empty">No hay títulos con estos filtros.</p>
      ) : (
        <ul className="grid">
          {shown.slice(0, limit).map((i) => (
            <li key={i.key}>
              <button className="card" onClick={() => onOpen(i.key)}>
                <div className="card-cover">
                  <Cover item={i} />
                  {i.userScore != null && <span className={`badge ${type}`}>{scoreText(i.userScore)}</span>}
                </div>
                <span className="card-title">{i.title}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {limit < shown.length && <div ref={sentinel} className="sentinel" aria-hidden />}
    </div>
  );
}
