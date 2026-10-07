import { liveQuery } from "dexie";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestPersistence } from "./backup";
import { useUserCovers } from "./covers/user";
import { db, isQuotaError, limpiarBaseDeDatos, quotaMessage, StorageInfo, storageInfo, Stopper } from "./db";
import { completarLibros } from "./ingest/books";
import { portadasLibros } from "./ingest/covers";
import { actualizarAnimeManga, actualizarPeliculas, actualizarTodo } from "./ingest/update";
import { addBook, BookInput, deleteBook, markAsRead, updateBook } from "./libros";
import { fusionarManga } from "./merge";
import { useNav, View } from "./nav";
import { loadSettings, saveSettings, Settings } from "./settings";
import { loadSyncTimes, SyncTimes, timeAgo } from "./sync";
import { Item, ITEM_TYPES, ItemType, Log, TYPE_LABEL } from "./types";
import BookForm from "./ui/BookForm";
import Category from "./ui/Category";
import Data, { Counts } from "./ui/Data";
import Detail from "./ui/Detail";
import Home from "./ui/Home";
import { IconBack, IconData, IconRefresh, IconSettings } from "./ui/icons";
import SettingsTab from "./ui/SettingsTab";

const TITLE: Partial<Record<View["v"], string>> = { data: "Datos", settings: "Ajustes" };

/** Categorías que se actualizan desde su fuente (los libros se apuntan a mano). */
const UPDATABLE: Partial<Record<ItemType, "mal" | "letterboxd">> = { anime: "mal", manga: "mal", movie: "letterboxd" };

type SyncFn = (s: Settings, log: Log, stop: Stopper) => Promise<string>;

export default function App() {
  const { view, go, back } = useNav();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [stoppable, setStoppable] = useState(false); // hay un proceso largo que se puede detener
  const stopper = useRef<Stopper>({ stopped: false });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [syncTimes, setSyncTimes] = useState<SyncTimes>({});
  const [banner, setBanner] = useState<{ text: string; done: boolean } | null>(null); // progreso y resumen de una actualización
  const main = useRef<HTMLElement>(null);
  const prev = useRef<View>(view);

  const addLog = useCallback((m: string) => setLog((l) => [...l.slice(-60), m]), []);
  const userCovers = useUserCovers();

  // Lo que se muestra: manga repetido (Excel + MAL) fundido y portadas elegidas a mano por encima de las automáticas
  const shown = useMemo(
    () =>
      items &&
      fusionarManga(items).map((i) =>
        userCovers.has(i.key) ? { ...i, cover: userCovers.get(i.key), extra: { ...i.extra, customCover: true } } : i,
      ),
    [items, userCovers],
  );

  useEffect(() => {
    loadSettings().then(setSettings);
    loadSyncTimes().then(setSyncTimes, () => null);
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

  // Al cambiar de pantalla se vuelve arriba, salvo al abrir o cerrar una ficha o un formulario (la categoría conserva su scroll)
  useEffect(() => {
    const overlay = (v: View["v"]) => v === "item" || v === "book";
    const p = prev.current.v;
    if (!((p === "cat" && overlay(view.v)) || (overlay(p) && (view.v === "cat" || overlay(view.v))))) main.current?.scrollTo(0, 0);
    prev.current = view;
  }, [view]);

  // Escape cierra la ficha o el formulario (teclado)
  useEffect(() => {
    if (view.v !== "item" && view.v !== "book") return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [view.v, back]);

  const counts = useMemo(() => {
    const c = {} as Counts;
    for (const t of ITEM_TYPES) {
      const xs = (shown ?? []).filter((i) => i.type === t);
      c[t] = {
        total: xs.length,
        rated: xs.filter((i) => i.userScore != null).length,
        synopsis: xs.filter((i) => i.synopsis).length,
        cover: xs.filter((i) => i.cover).length,
      };
    }
    return c;
  }, [shown]);

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
      loadSyncTimes().then(setSyncTimes, () => null);
    }
  };

  /** Actualización con progreso en la banda superior y, al terminar, su resumen. */
  const sync = (fn: SyncFn) =>
    run(async (stop) => {
      const log = (m: string) => {
        addLog(m);
        setBanner({ text: m, done: false });
      };
      setBanner({ text: "Actualizando…", done: false });
      try {
        const res = await fn(settings!, log, stop);
        setBanner({ text: stop.stopped ? `Detenido. ${res}` : res, done: true });
      } catch (e: any) {
        const msg = isQuotaError(e) ? await quotaMessage() : `Error: ${e?.message ?? e}`;
        addLog(msg);
        setBanner({ text: msg, done: true });
      }
    }, true);

  const saveBook = async (b: BookInput, key?: string) => {
    if (key) {
      await updateBook(key, b);
      back();
      return;
    }
    const newKey = await addBook(b);
    back();
    // Sinopsis (y portada, si la sugerencia no traía) del libro nuevo, en segundo plano
    sync(async (_s, log, stop) => {
      log(`Buscando la sinopsis de «${b.title}»…`);
      const only = new Set([newKey]);
      await completarLibros(log, stop, only);
      await portadasLibros(log, stop, only);
      const it = await db.items.get(newKey);
      return `«${b.title}» añadido${it ? `: ${it.synopsis ? "con sinopsis" : "sin sinopsis"}, ${it.cover ? "con portada" : "sin portada"}` : ""}`;
    });
  };

  if (!settings) return null;

  const catType = view.v === "cat" || view.v === "item" || view.v === "book" ? view.type : null;
  const title = catType ? TYPE_LABEL[catType] : TITLE[view.v];
  const source = catType ? UPDATABLE[catType] : undefined;
  const updateCategory = () => sync(source === "letterboxd" ? actualizarPeliculas : actualizarAnimeManga);

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
          {view.v === "cat" && source && (
            <button className="icon" onClick={updateCategory} disabled={busy} aria-label="Actualizar" title={`Actualizar ${title}`}>
              <IconRefresh />
            </button>
          )}
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

      {banner && (
        <div className={`banner ${banner.done ? "done" : ""}`} role="status" aria-live="polite">
          <span>{banner.text}</span>
          {!banner.done && stoppable && (
            <button className="link" onClick={() => (stopper.current.stopped = true)}>
              Detener
            </button>
          )}
          {banner.done && (
            <button className="link" onClick={() => setBanner(null)} aria-label="Cerrar aviso">
              ✕
            </button>
          )}
        </div>
      )}

      <main ref={main} className={catType ? "wide" : ""}>
        {view.v === "home" && (
          <Home
            items={shown}
            openCategory={(type) => go({ v: "cat", type })}
            openData={() => go({ v: "data" })}
            syncTimes={syncTimes}
            busy={busy}
            onUpdateAll={() => sync(actualizarTodo)}
          />
        )}
        {catType && (
          <Category
            items={shown ?? []}
            type={catType}
            onOpen={(key) => go({ v: "item", type: catType, key })}
            updated={source ? (syncTimes[source] ? `Actualizado ${timeAgo(syncTimes[source])}` : "Sin actualizar") : undefined}
            onAdd={catType === "book" ? () => go({ v: "book", type: "book" }) : undefined}
          />
        )}
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

      {view.v === "item" && (
        <Detail
          item={shown?.find((i) => i.key === view.key)}
          settings={settings}
          onBack={back}
          onEdit={(key) => go({ v: "book", type: view.type, key })}
          onMarkRead={(key, score, date) => markAsRead(key, score, date)}
          onDelete={async (key) => {
            await deleteBook(key);
            back();
          }}
        />
      )}
      {view.v === "book" && (
        <BookForm
          key={view.key ?? "nuevo"}
          item={view.key ? items?.find((i) => i.key === view.key) : undefined}
          items={items ?? []}
          onSave={(b) => saveBook(b, view.key)}
          onCancel={back}
        />
      )}
    </div>
  );
}
