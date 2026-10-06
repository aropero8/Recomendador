import { useCallback, useEffect, useState } from "react";
import { db } from "./db";
import { loadSettings, saveSettings, Settings } from "./settings";
import { ITEM_TYPES, TYPE_LABEL } from "./types";
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
  const [counts, setCounts] = useState({} as Counts);
  const [version, setVersion] = useState(0); // fuerza a recargar la biblioteca tras importar

  const addLog = useCallback((m: string) => setLog((l) => [...l.slice(-60), m]), []);

  const refresh = useCallback(async () => {
    const all = await db.items.toArray();
    const c = {} as Counts;
    for (const t of ITEM_TYPES) {
      const xs = all.filter((i) => i.type === t);
      c[t] = { total: xs.length, rated: xs.filter((i) => i.userScore != null).length };
    }
    setCounts(c);
    setVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    loadSettings().then(setSettings);
    refresh();
  }, [refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      addLog(`Error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      refresh();
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
        {tab === "library" && <Library key={version} goData={() => setTab("data")} />}
        {tab === "data" && <Data settings={settings} counts={counts} log={log} busy={busy} run={run} addLog={addLog} />}
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
