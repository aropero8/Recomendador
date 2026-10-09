import { useEffect, useMemo, useRef, useState } from "react";
import { norm } from "../lib/text";
import { Item, ItemType, Status, TYPE_LABEL } from "../types";
import Cover from "./Cover";
import { progress, scoreText, titles, when } from "./format";
import { IconRefresh, IconSearch, IconSort } from "./icons";

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

interface Props {
  items: Item[];
  type: ItemType;
  onOpen: (key: string) => void;
  update: {
    label: string; // «MyAnimeList»
    description: string; // «Actualiza anime y manga desde MyAnimeList»
    updated: string; // «actualizado hace 2 días»
    busy: boolean;
    onClick: () => void;
  };
  openData: () => void;
}

export default function Category({ items, type, onOpen, update, openData }: Props) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status | "all">("all");
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const all = useMemo(() => items.filter((i) => i.type === type), [items, type]);
  const shown = useMemo(() => {
    const q = norm(query);
    const xs = all.filter((i) => (status === "all" || i.status === status) && (!q || norm(i.title).includes(q)));
    const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title, "es");
    return xs.sort(
      sort === "title"
        ? byTitle
        : sort === "recent"
          ? (a, b) => when(b) - when(a) || byTitle(a, b)
          : (a, b) => (b.userScore ?? -1) - (a.userScore ?? -1) || byTitle(a, b),
    );
  }, [all, status, query, sort]);

  useEffect(() => setLimit(PAGE), [status, query, sort]);

  // Scroll infinito: al acercarse al final se añaden más portadas
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => es[0].isIntersecting && setLimit((l) => l + PAGE), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown.length, limit]);

  // Cuántos hay de cada estado, para las pestañas
  const byStatus = useMemo(() => {
    const c: Partial<Record<Status | "all", number>> = { all: all.length };
    for (const i of all) c[i.status] = (c[i.status] ?? 0) + 1;
    return c;
  }, [all]);

  const rated = shown.filter((i) => i.userScore != null);
  const avg = rated.length ? rated.reduce((a, i) => a + i.userScore!, 0) / rated.length : null;
  const filtered = query !== "" || status !== "all";

  return (
    <div className={`stack category ${type}`}>
      <div className="sync-row">
        <span className="hint">
          {update.label} · {update.updated}
        </span>
        <button className="text-btn" disabled={update.busy} onClick={update.onClick} title={update.description}>
          <IconRefresh /> Actualizar
        </button>
      </div>

      <label className="search">
        <IconSearch />
        <input
          type="search"
          enterKeyHint="search"
          placeholder={`Buscar en ${TYPE_LABEL[type]}`}
          aria-label="Buscar por título"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        />
      </label>

      <div className="chips scroll" role="group" aria-label="Estado">
        {STATUS_FILTERS.map(([s, label]) => (
          <button key={s} className={`chip ${status === s ? "on" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {label}
            <span className="chip-n">{byStatus[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className="summary">
        <span className="hint">
          {titles(shown.length)}
          {avg != null && ` · media ${scoreText(avg)}`}
        </span>
        <label className="sort">
          <IconSort />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
            {SORTS.map(([s, label]) => (
              <option key={s} value={s}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {all.length === 0 ? (
        <div className="empty">
          <p>Aún no hay nada en {TYPE_LABEL[type]}.</p>
          <div className="row-actions center">
            <button className="tonal" disabled={update.busy} onClick={update.onClick}>
              Actualizar desde {update.label}
            </button>
            <button className="ghost" onClick={openData}>
              Ir a Datos
            </button>
          </div>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty">
          <p>No hay títulos con estos filtros.</p>
          {filtered && (
            <button
              className="ghost"
              onClick={() => {
                setQuery("");
                setStatus("all");
              }}
            >
              Quitar filtros
            </button>
          )}
        </div>
      ) : (
        <ul className="grid">
          {shown.slice(0, limit).map((i) => {
            const p = i.status === "reading" ? progress(i) : null;
            return (
              <li key={i.key}>
                <button className="card" onClick={() => onOpen(i.key)}>
                  <div className="card-cover">
                    <Cover item={i} />
                    {i.userScore != null && <span className="badge">{scoreText(i.userScore)}</span>}
                    {p != null && (
                      <span className="bar" aria-label={`${Math.round(p * 100)} %`}>
                        <span style={{ width: `${p * 100}%` }} />
                      </span>
                    )}
                  </div>
                  <span className="card-title">{i.title}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {limit < shown.length && <div ref={sentinel} className="sentinel" aria-hidden />}
    </div>
  );
}
