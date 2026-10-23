import { useEffect, useMemo, useRef, useState } from "react";
import { norm } from "../lib/text";
import { AGAIN_LABEL, inProgress, isAgain, Item, ItemType, Status, TYPE_LABEL } from "../types";
import Cover from "./Cover";
import { progress, scoreText, titles, when } from "./format";
import { IconRefresh, IconSearch, IconSort, IconUser } from "./icons";

type Filter = Status | "all" | "again"; // again: volviendo a ver o releyendo (solo anime y manga)
const STATUS_FILTERS: [Filter, string][] = [
  ["all", "Todo"],
  ["read", "Terminado"],
  ["reading", "En curso"],
  ["plan", "Pendiente"],
];
const matches = (i: Item, f: Filter) => f === "all" || (f === "again" ? isAgain(i) : i.status === f);
type Sort = "score" | "title" | "recent";
const SORTS: [Sort, string][] = [
  ["score", "Mejor nota"],
  ["title", "A-Z"],
  ["recent", "Recientes"],
];
const PAGE = 60; // portadas que se añaden cada vez que se llega al final

/** Autores de un libro («A / B» son dos) y la clave para agruparlos («J.R.R. Tolkien» = «J. R. R. Tolkien»). */
const authorsOf = (i: Item) => String(i.extra.author ?? "").split("/").map((a) => a.trim()).filter(Boolean);
const authorKey = (a: string) => norm(a).replace(/[^a-z0-9]/g, "");

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
  const [status, setStatus] = useState<Filter>("all");
  const [author, setAuthor] = useState(""); // authorKey; "" = todos
  const [sort, setSort] = useState<Sort>("score");
  const [limit, setLimit] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);

  const all = useMemo(() => items.filter((i) => i.type === type), [items, type]);
  const filters = useMemo<[Filter, string][]>(() => {
    const again = AGAIN_LABEL[type];
    return again ? [...STATUS_FILTERS.slice(0, 3), ["again", again], ...STATUS_FILTERS.slice(3)] : STATUS_FILTERS;
  }, [type]);
  useEffect(() => setStatus((s) => (filters.some(([f]) => f === s) ? s : "all")), [filters]);

  // Autores de los libros, por orden alfabético y con cuántos tienes de cada uno
  const authors = useMemo(() => {
    if (type !== "book") return [];
    const m = new Map<string, { name: string; n: number }>();
    for (const i of all)
      for (const a of authorsOf(i)) {
        const k = authorKey(a);
        const x = m.get(k);
        if (x) x.n++;
        else m.set(k, { name: a, n: 1 });
      }
    return [...m].map(([key, x]) => ({ key, ...x })).sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [all, type]);
  useEffect(() => setAuthor((a) => (authors.some((x) => x.key === a) ? a : "")), [authors]);

  const shown = useMemo(() => {
    const q = norm(query);
    const xs = all.filter(
      (i) =>
        matches(i, status) && (!q || norm(i.title).includes(q)) && (!author || authorsOf(i).some((a) => authorKey(a) === author)),
    );
    const byTitle = (a: Item, b: Item) => a.title.localeCompare(b.title, "es");
    return xs.sort(
      sort === "title"
        ? byTitle
        : sort === "recent"
          ? (a, b) => when(b) - when(a) || byTitle(a, b)
          : (a, b) => (b.userScore ?? -1) - (a.userScore ?? -1) || byTitle(a, b),
    );
  }, [all, status, query, author, sort]);

  useEffect(() => setLimit(PAGE), [status, query, author, sort]);

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
    const c: Partial<Record<Filter, number>> = { all: all.length };
    for (const i of all) {
      c[i.status] = (c[i.status] ?? 0) + 1;
      if (isAgain(i)) c.again = (c.again ?? 0) + 1;
    }
    return c;
  }, [all]);

  const rated = shown.filter((i) => i.userScore != null);
  const avg = rated.length ? rated.reduce((a, i) => a + i.userScore!, 0) / rated.length : null;
  const filtered = query !== "" || status !== "all" || author !== "";

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
        {filters.map(([s, label]) => (
          <button key={s} className={`chip ${status === s ? "on" : ""}`} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {label}
            <span className="chip-n">{byStatus[s] ?? 0}</span>
          </button>
        ))}
      </div>

      {authors.length > 0 && (
        <label className={`author-filter ${author ? "on" : ""}`}>
          <IconUser />
          <select value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Autor">
            <option value="">Todos los autores</option>
            {authors.map((a) => (
              <option key={a.key} value={a.key}>
                {a.name} ({a.n})
              </option>
            ))}
          </select>
        </label>
      )}

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
                setAuthor("");
              }}
            >
              Quitar filtros
            </button>
          )}
        </div>
      ) : (
        <ul className="grid">
          {shown.slice(0, limit).map((i) => {
            const p = inProgress(i) ? progress(i) : null;
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
