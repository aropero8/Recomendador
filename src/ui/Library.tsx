import { useMemo, useState } from "react";
import { ITEM_TYPES, Item, ItemType, Status, TYPE_LABEL } from "../types";

const STATUS_LABEL: Record<Status, string> = {
  read: "Terminado",
  reading: "En curso",
  plan: "Pendiente",
  dropped: "Abandonado",
  other: "En pausa",
};
const STATUS_FILTERS: [Status | "all", string][] = [
  ["all", "Todo"],
  ["read", "Terminado"],
  ["reading", "En curso"],
  ["plan", "Pendiente"],
];
const LIMIT = 150;

export default function Library({ items, goData }: { items: Item[] | null; goData: () => void }) {
  const [type, setType] = useState<ItemType | "all">("all");
  const [status, setStatus] = useState<Status | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"score" | "title">("score");
  const [all, setAll] = useState(false);

  const shown = useMemo(() => {
    if (!items) return [];
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (type === "all" || i.type === type) && (status === "all" || i.status === status))
      .filter((i) => !q || i.title.toLowerCase().includes(q))
      .sort((a, b) =>
        sort === "title" ? a.title.localeCompare(b.title) : (b.userScore ?? -1) - (a.userScore ?? -1),
      );
  }, [items, type, status, query, sort]);

  if (items && items.length === 0) {
    return (
      <div className="empty">
        <p>Tu biblioteca está vacía. Importa tus listas de MyAnimeList, Letterboxd y tus Excel.</p>
        <button onClick={goData}>Ir a Datos</button>
      </div>
    );
  }

  const rated = shown.filter((i) => i.userScore != null);
  const avg = rated.length ? rated.reduce((a, i) => a + i.userScore!, 0) / rated.length : null;
  const visible = all ? shown : shown.slice(0, LIMIT);

  return (
    <div className="stack">
      <section>
        <input placeholder="Buscar por título" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="chips">
          <button className={`chip ${type === "all" ? "on" : ""}`} onClick={() => setType("all")}>
            Todo
          </button>
          {ITEM_TYPES.map((t) => (
            <button key={t} className={`chip ${t} ${type === t ? "on" : ""}`} onClick={() => setType(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="chips">
          {STATUS_FILTERS.map(([s, label]) => (
            <button key={s} className={`chip ${status === s ? "on" : ""}`} onClick={() => setStatus(s)}>
              {label}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={`chip ${sort === "score" ? "on" : ""}`} onClick={() => setSort("score")}>
            Mejor nota
          </button>
          <button className={`chip ${sort === "title" ? "on" : ""}`} onClick={() => setSort("title")}>
            A-Z
          </button>
        </div>
        <p className="hint">
          {shown.length} títulos{avg != null && `, nota media ${avg.toFixed(1)} (${rated.length} con nota)`}
        </p>
      </section>

      <ol className="recs">
        {visible.map((i) => (
          <li key={i.key}>
            <div className="row">
              <span className={`dot ${i.type}`} />
              <strong>{i.title}</strong>
              {i.userScore != null && <span className="match">{i.userScore.toFixed(1).replace(".0", "")}</span>}
            </div>
            <p className="meta">
              {STATUS_LABEL[i.status]}
              {i.genres.length > 0 && ` · ${i.genres.slice(0, 3).join(", ")}`}
            </p>
          </li>
        ))}
      </ol>
      {!all && shown.length > LIMIT && <button onClick={() => setAll(true)}>Mostrar los {shown.length}</button>}
    </div>
  );
}
