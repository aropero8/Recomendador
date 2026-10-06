import { liveQuery } from "dexie";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { db, Stopper } from "./db";
import { loadSettings, saveSettings, Settings } from "./settings";
import { Item, ITEM_TYPES, TYPE_LABEL } from "./types";
import Data, { Counts } from "./ui/Data";
import Library from "./ui/Library";
import SettingsTab from "./ui/SettingsTab";

type Tab = "library" | "data" | "settings";
const TABS: [Tab, string][] = [
  ["library", "Biblioteca"],
  ["data", "Datos"],
  ["settings", "Ajustes"],
];

export default function App() {
  const [tab, setTab] = useState<Tab>("library");
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [stoppable, setStoppable] = useState(false); // hay un proceso largo que se puede detener
  const stopper = useRef<Stopper>({ stopped: false });

  const addLog = useCallback((m: string) => setLog((l) => [...l.slice(-60), m]), []);

  useEffect(() => {
    loadSettings().then(setSettings);
    // Se actualiza solo cada vez que cambia la base de datos (también durante una importación)
    const sub = liveQuery(() => db.items.toArray()).subscribe({
      next: setItems,
      error: (e) => addLog(`Error leyendo la biblioteca: ${e?.message ?? e}`),
    });
    return () => sub.unsubscribe();
  }, [addLog]);

  const counts = useMemo(() => {
    const c = {} as Counts;
    for (const t of ITEM_TYPES) {
      const xs = (items ?? []).filter((i) => i.type === t);
      c[t] = {
        total: xs.length,
        rated: xs.filter((i) => i.userScore != null).length,
        synopsis: xs.filter((i) => i.synopsis).length,
      };
    }
    return c;
  }, [items]);

  const run = async (fn: (stop: Stopper) => Promise<void>, canStop = false) => {
    stopper.current = { stopped: false };
    setStoppable(canStop);
    setBusy(true);
    try {
      await fn(stopper.current);
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      setStoppable(false);
    }
  };

  if (!settings) return null;

  return (
    <div className="app">
      <header>
        <h1>Recomendador</h1>
        <div className="dots" aria-hidden>
          {ITEM_TYPES.map((t) => (
            <span key={t} className={`dot ${t}`} title={TYPE_LABEL[t]} />
          ))}
        </div>
      </header>

      <main>
        {tab === "library" && <Library items={items} goData={() => setTab("data")} />}
        {tab === "data" && <Data
            settings={settings}
            counts={counts}
            log={log}
            busy={busy}
            run={run}
            addLog={addLog}
            stoppable={stoppable}
            onStop={() => (stopper.current.stopped = true)}
          />}
        {tab === "settings" && (
          <SettingsTab
            settings={settings}
            onSave={async (s) => {
              await saveSettings(s);
              setSettings(s);
              addLog("Ajustes guardados");
            }}
          />
        )}
      </main>

      <nav>
        {TABS.map(([id, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
