import { liveQuery } from "dexie";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestPersistence } from "./backup";
import { db, isQuotaError, limpiarBaseDeDatos, quotaMessage, StorageInfo, storageInfo, Stopper } from "./db";
import { useNav, View } from "./nav";
import { loadSettings, saveSettings, Settings } from "./settings";
import { Item, ITEM_TYPES, TYPE_LABEL } from "./types";
import Category from "./ui/Category";
import Data, { Counts } from "./ui/Data";
import Detail from "./ui/Detail";
import Home from "./ui/Home";
import { IconBack, IconData, IconSettings } from "./ui/icons";
import SettingsTab from "./ui/SettingsTab";

const TITLE: Partial<Record<View["v"], string>> = { data: "Datos", settings: "Ajustes" };

export default function App() {
  const { view, go, back } = useNav();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [stoppable, setStoppable] = useState(false); // hay un proceso largo que se puede detener
  const stopper = useRef<Stopper>({ stopped: false });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const main = useRef<HTMLElement>(null);
  const prev = useRef<View>(view);

  const addLog = useCallback((m: string) => setLog((l) => [...l.slice(-60), m]), []);

  useEffect(() => {
    loadSettings().then(setSettings);
    // Pide almacenamiento persistente, corrige registros mal guardados y mide el espacio usado
    requestPersistence()
      .catch(() => null)
      .then(() => limpiarBaseDeDatos(addLog))
      .catch(async (e) => addLog(isQuotaError(e) ? await quotaMessage() : `Error al revisar la base de datos: ${e?.message ?? e}`))
      .then(() => storageInfo())
      .then(setStorage, () => setStorage(null));
    // Se actualiza solo cada vez que cambia la base de datos (también durante una importación)
    const sub = liveQuery(() => db.items.toArray()).subscribe({
      next: setItems,
      error: (e) => addLog(`Error leyendo la biblioteca: ${e?.message ?? e}`),
    });
    return () => sub.unsubscribe();
  }, [addLog]);

  // Al cambiar de pantalla se vuelve arriba, salvo al abrir o cerrar una ficha (la categoría conserva su scroll)
  useEffect(() => {
    const p = prev.current.v;
    if (!((p === "cat" && view.v === "item") || (p === "item" && view.v === "cat"))) main.current?.scrollTo(0, 0);
    prev.current = view;
  }, [view]);

  // Escape cierra la ficha (teclado)
  useEffect(() => {
    if (view.v !== "item") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [view.v, back]);

  const counts = useMemo(() => {
    const c = {} as Counts;
    for (const t of ITEM_TYPES) {
      const xs = (items ?? []).filter((i) => i.type === t);
      c[t] = {
        total: xs.length,
        rated: xs.filter((i) => i.userScore != null).length,
        synopsis: xs.filter((i) => i.synopsis).length,
        cover: xs.filter((i) => i.cover).length,
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
      addLog(isQuotaError(e) ? await quotaMessage() : `Error: ${e?.message ?? e}`);
    } finally {
      setBusy(false);
      setStoppable(false);
      storageInfo().then(setStorage, () => null);
    }
  };

  if (!settings) return null;

  const catType = view.v === "cat" || view.v === "item" ? view.type : null;
  const title = catType ? TYPE_LABEL[catType] : TITLE[view.v];

  return (
    <div className="app">
      <header className="top">
        {view.v === "home" ? (
          <span className="brand">Recomendador</span>
        ) : (
          <>
            <button className="icon" onClick={back} aria-label="Volver">
              <IconBack />
            </button>
            <span className="top-title">
              {catType && <span className={`dot ${catType}`} />} {title}
            </span>
          </>
        )}
        <div className="actions">
          <button className={`icon ${view.v === "data" ? "on" : ""}`} onClick={() => view.v !== "data" && go({ v: "data" })} aria-label="Datos" title="Datos">
            <IconData />
          </button>
          <button
            className={`icon ${view.v === "settings" ? "on" : ""}`}
            onClick={() => view.v !== "settings" && go({ v: "settings" })}
            aria-label="Ajustes"
            title="Ajustes"
          >
            <IconSettings />
          </button>
        </div>
      </header>

      <main ref={main} className={catType ? "wide" : ""}>
        {view.v === "home" && <Home items={items} openCategory={(type) => go({ v: "cat", type })} openData={() => go({ v: "data" })} />}
        {catType && <Category items={items ?? []} type={catType} onOpen={(key) => go({ v: "item", type: catType, key })} />}
        {view.v === "data" && (
          <div className="narrow">
            <Data
              settings={settings}
              counts={counts}
              log={log}
              busy={busy}
              run={run}
              addLog={addLog}
              stoppable={stoppable}
              storage={storage}
              onStop={() => (stopper.current.stopped = true)}
            />
          </div>
        )}
        {view.v === "settings" && (
          <div className="narrow">
            <SettingsTab
              settings={settings}
              onSave={async (s) => {
                await saveSettings(s);
                setSettings(s);
                addLog("Ajustes guardados");
              }}
            />
          </div>
        )}
      </main>

      {view.v === "item" && <Detail item={items?.find((i) => i.key === view.key)} onBack={back} />}
    </div>
  );
}
