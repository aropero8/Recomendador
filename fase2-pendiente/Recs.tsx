import { useState } from "react";
import { Rec, recommend } from "../recommend";
import { ITEM_TYPES, ItemType, TYPE_LABEL } from "../types";
import type { Counts } from "./Data";

export default function Recs({ counts, goData }: { counts: Counts; goData: () => void }) {
  const [target, setTarget] = useState<ItemType>("anime");
  const [basis, setBasis] = useState<"same" | "all">("all");
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [loading, setLoading] = useState(false);

  const analyzed = ITEM_TYPES.reduce((a, t) => a + (counts[t]?.embedded ?? 0), 0);
  if (analyzed === 0) {
    return (
      <div className="empty">
        <p>Todavía no hay nada que analizar. Importa tus listas y pulsa «Analizar mi biblioteca».</p>
        <button onClick={goData}>Ir a Datos</button>
      </div>
    );
  }

  const go = async () => {
    setLoading(true);
    setRecs(await recommend(target, basis === "same" ? [target] : "all"));
    setLoading(false);
  };

  return (
    <div className="stack">
      <section>
        <h2>¿Qué te apetece?</h2>
        <div className="chips">
          {ITEM_TYPES.map((t) => (
            <button key={t} className={`chip ${t} ${target === t ? "on" : ""}`} onClick={() => setTarget(t)}>
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="chips">
          <button className={`chip ${basis === "all" ? "on" : ""}`} onClick={() => setBasis("all")}>
            Según todos mis gustos
          </button>
          <button className={`chip ${basis === "same" ? "on" : ""}`} onClick={() => setBasis("same")}>
            Solo según {TYPE_LABEL[target].toLowerCase()}
          </button>
        </div>
        <button disabled={loading} onClick={go}>
          Recomiéndame
        </button>
        <p className="hint">Solo se recomienda lo que tienes pendiente (plan to watch, watchlist y libros sin leer).</p>
      </section>

      {recs && recs.length === 0 && (
        <p className="empty">
          No hay pendientes analizados en esta categoría, o aún no tienes notas para calcular tu gusto.
        </p>
      )}

      <ol className="recs">
        {recs?.map((r) => (
          <li key={r.item.key}>
            <div className="row">
              <span className={`dot ${r.item.type}`} />
              <strong>{r.item.title}</strong>
              <span className="match">{Math.round(r.score * 100)}%</span>
            </div>
            {r.because.length > 0 && <p className="why">Se parece a {r.because.join(" y ")}</p>}
            {r.item.genres.length > 0 && <p className="meta">{r.item.genres.slice(0, 4).join(", ")}</p>}
          </li>
        ))}
      </ol>
    </div>
  );
}
