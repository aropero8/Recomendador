import { liveQuery } from "dexie";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { requestPersistence } from "./backup";
import { useUserCovers } from "./covers/user";
import { db, isQuotaError, limpiarBaseDeDatos, quotaMessage, StorageInfo, storageInfo, Stopper } from "./db";
import { completarLibros } from "./ingest/books";
import { portadasLibros } from "./ingest/covers";
import { actualizarAnimeManga, actualizarLibros, actualizarPeliculas } from "./ingest/update";
import { copyText } from "./lib/clipboard";
import { addBook, BookInput, deleteBook, markAsRead, today, updateBook } from "./libros";
import { fusionarManga } from "./merge";
import { isOverlay, useNav, View } from "./nav";
import { profileForChat } from "./reco/profile";
import { recomendar, updateSavedReco } from "./reco/recommend";
import type { Reco } from "./reco/verify";
import { loadSettings, saveSettings, Settings } from "./settings";
import { loadSyncTimes, MissingSettings, SyncResult, SyncSource, SyncTimes, timeAgo } from "./sync";
import { Item, ITEM_TYPES, ItemType, Log, TYPE_LABEL } from "./types";
import BookForm from "./ui/BookForm";
import BottomNav from "./ui/BottomNav";
import Category from "./ui/Category";
import Data, { Counts } from "./ui/Data";
import Detail from "./ui/Detail";
import Home from "./ui/Home";
import Recommend from "./ui/Recommend";
import { IconBack, IconClose, IconData, IconPlus, IconRefresh, IconSettings, IconSparkle } from "./ui/icons";
import { PULL_THRESHOLD, usePullToRefresh } from "./ui/pull";
import SettingsTab from "./ui/SettingsTab";

const TITLE: Partial<Record<View["v"], string>> = { data: "Datos", settings: "Ajustes", reco: "Recomiéndame" };

type SyncFn = (s: Settings, log: Log, stop: Stopper) => Promise<SyncResult>;

/** «Actualizar» de cada categoría: anime y manga comparten la lista de MAL (y la fecha); libros busca sinopsis y portadas. */
const UPDATE: Record<ItemType, { source: SyncSource; label: string; description: string; fn: SyncFn }> = {
  anime: { source: "mal", label: "MyAnimeList", description: "Actualiza anime y manga desde MyAnimeList", fn: actualizarAnimeManga },
  manga: { source: "mal", label: "MyAnimeList", description: "Actualiza anime y manga desde MyAnimeList", fn: actualizarAnimeManga },
  movie: { source: "letterboxd", label: "Letterboxd", description: "Desde el RSS de Letterboxd", fn: actualizarPeliculas },
  book: { source: "books", label: "Sinopsis y portadas", description: "Busca las sinopsis y portadas que falten", fn: actualizarLibros },
};

/** Aviso flotante abajo: progreso y resumen de lo que se está haciendo. autoHide: se cierra solo. */
interface Banner {
  text: string;
  done: boolean;
  goSettings?: boolean; // falta algo en Ajustes
  autoHide?: boolean;
}

export default function App() {
  const { view, go, back, tab } = useNav();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [stoppable, setStoppable] = useState(false); // hay un proceso largo que se puede detener
  const stopper = useRef<Stopper>({ stopped: false });
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [syncTimes, setSyncTimes] = useState<SyncTimes>({});
  const [banner, setBanner] = useState<Banner | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const busyRef = useRef(false);
  const main = useRef<HTMLElement>(null);
  const prev = useRef<View>(view);

  // Lo que hay debajo de la ficha o el formulario: la última pantalla normal
  const baseRef = useRef<View>(view);
  if (!isOverlay(view)) baseRef.current = view;
  const base = baseRef.current;

  // Mientras hay un proceso en marcha, cada paso se ve también en el aviso de abajo
  const addLog = useCallback((m: string) => {
    setLog((l) => [...l.slice(-60), m]);
    if (busyRef.current) setBanner({ text: m, done: false });
  }, []);
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

  // Al cambiar de pantalla se vuelve arriba, salvo al abrir o cerrar una ficha o un formulario (lo de debajo conserva su scroll)
  useEffect(() => {
    if (!isOverlay(prev.current) && !isOverlay(view)) {
      main.current?.scrollTo(0, 0);
      setScrolled(false);
    }
    prev.current = view;
  }, [view]);

  // Escape cierra la ficha o el formulario (teclado)
  useEffect(() => {
    if (!isOverlay(view)) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && back();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [view, back]);

  // Los avisos de confirmación se cierran solos
  useEffect(() => {
    if (!banner?.autoHide) return;
    const t = setTimeout(() => setBanner((b) => (b === banner ? null : b)), 3500);
    return () => clearTimeout(t);
  }, [banner]);

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
    busyRef.current = true;
    try {
      await fn(stopper.current);
    } catch (e: any) {
      addLog(isQuotaError(e) ? await quotaMessage() : `Error: ${e?.message ?? e}`);
    } finally {
      busyRef.current = false;
      setBusy(false);
      setStoppable(false);
      setBanner((b) => (b && !b.done ? { ...b, done: true } : b)); // el último paso queda como resumen
      storageInfo().then(setStorage, () => null);
      loadSyncTimes().then(setSyncTimes, () => null);
    }
  };

  /** Actualización con progreso en el aviso de abajo y, al terminar, su resumen. */
  const sync = (fn: SyncFn) =>
    run(async (stop) => {
      setBanner({ text: "Actualizando…", done: false });
      try {
        const res = await fn(settings!, addLog, stop);
        setSyncTimes(await loadSyncTimes()); // la fecha cambia a la vez que aparece el resumen
        const text = stop.stopped ? `Detenido. ${res.text}` : res.text;
        busyRef.current = false; // el resumen ya no es un paso intermedio
        addLog(text);
        setBanner({ text, done: true, goSettings: res.goSettings });
      } catch (e: any) {
        const ajustes = e instanceof MissingSettings;
        const msg = isQuotaError(e) ? await quotaMessage() : ajustes ? e.message : `Error: ${e?.message ?? e}`;
        busyRef.current = false;
        addLog(msg);
        setBanner({ text: msg, done: true, goSettings: ajustes });
      }
    }, true);

  const saveBook = async (b: BookInput, key?: string) => {
    if (key) {
      await updateBook(key, b);
      back();
      setBanner({ text: "Cambios guardados", done: true, autoHide: true });
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
      return { text: `«${b.title}» añadido${it ? `: ${it.synopsis ? "con sinopsis" : "sin sinopsis"}, ${it.cover ? "con portada" : "sin portada"}` : ""}` };
    });
  };

  /** «Añadir a pendientes» de un libro recomendado: con la portada y la sinopsis que trajo (si no, se busca después). */
  const addRecoBook = async (r: Reco) => {
    let key: string | undefined;
    await run(async () => {
      key = await addBook({ title: r.title, author: r.author ?? "", status: "plan", score: null, date: today(), priority: 3, cover: r.cover, olKey: typeof r.extId === "string" ? r.extId : undefined });
      if (r.synopsis) await db.items.update(key, { synopsis: r.synopsis, "extra.synopsisSource": "openlibrary", "extra.synopsisUrl": r.url });
      await updateSavedReco(r.type, r.id, { ...r, inPending: true, libraryKey: key });
      setBanner({ text: `«${r.title}» añadido a tus pendientes`, done: true, autoHide: !!r.synopsis });
    });
    // Sin sinopsis: se busca cuando ha terminado lo anterior (así no hay dos procesos a la vez)
    if (key && !r.synopsis)
      sync(async (_s, log, stop) => {
        await completarLibros(log, stop, new Set([key!]));
        const it = await db.items.get(key!);
        return { text: `«${r.title}» añadido a tus pendientes${it?.synopsis ? " con su sinopsis" : ""}` };
      });
  };

  const copyProfile = async () => {
    try {
      await copyText(profileForChat(shown ?? []));
      setBanner({ text: "Perfil copiado: pégalo en cualquier chat de IA y pídele lo que te apetezca.", done: true, autoHide: true });
    } catch (e: any) {
      setBanner({ text: e?.message ?? String(e), done: true });
    }
  };

  const catType = base.v === "cat" ? base.type : null;
  const upd = catType ? UPDATE[catType] : undefined;
  const pull = usePullToRefresh(main, upd && settings && !busy ? () => sync(upd.fn) : null);

  if (!settings) return null;

  const lastSync = upd && syncTimes[upd.source];
  const topLevel = base.v === "home" || base.v === "cat"; // con barra inferior
  const title = catType ? TYPE_LABEL[catType] : TITLE[base.v];

  return (
    <div className={`app ${topLevel ? "with-nav" : ""} ${isOverlay(view) ? "overlay-open" : ""}`}>
      <header className={`top ${scrolled ? "scrolled" : ""}`}>
        {base.v === "home" ? (
          <span className="brand">Recomendador</span>
        ) : (
          <>
            {!topLevel && (
              <button className="icon" onClick={back} aria-label="Volver">
                <IconBack />
              </button>
            )}
            <span className={`top-title ${catType ? `dotted ${catType}` : ""}`}>{title}</span>
          </>
        )}
        <div className="actions">
          {topLevel && (
            <button className="icon sparkle" onClick={() => go({ v: "reco", type: catType ?? undefined })} aria-label="Recomiéndame" title="Recomiéndame">
              <IconSparkle />
            </button>
          )}
          <button className={`icon ${base.v === "data" ? "on" : ""}`} onClick={() => base.v !== "data" && go({ v: "data" })} aria-label="Datos" title="Datos">
            <IconData />
          </button>
          <button
            className={`icon ${base.v === "settings" ? "on" : ""}`}
            onClick={() => base.v !== "settings" && go({ v: "settings" })}
            aria-label="Ajustes"
            title="Ajustes"
          >
            <IconSettings />
          </button>
        </div>
        {busy && <div className="progress" role="progressbar" aria-label="Trabajando" />}
      </header>

      <main
        ref={main}
        className={`${catType ? `wide ${catType}` : ""} ${upd ? "ptr-on" : ""}`}
        onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}
      >
        {pull > 0 && (
          <div className={`ptr ${pull >= PULL_THRESHOLD ? "ready" : ""}`} style={{ transform: `translate(-50%, ${pull - 44}px)` }} aria-hidden>
            <span style={{ transform: `rotate(${pull * 3}deg)` }}>
              <IconRefresh />
            </span>
          </div>
        )}
        {base.v === "home" && (
          <Home
            items={shown}
            openCategory={(type) => tab({ v: "cat", type })}
            openItem={(i) => go({ v: "item", type: i.type, key: i.key })}
            openData={() => go({ v: "data" })}
            openSettings={() => go({ v: "settings" })}
            onRecommend={() => go({ v: "reco" })}
          />
        )}
        {catType && (
          <Category
            key={catType}
            items={shown ?? []}
            type={catType}
            onOpen={(key) => go({ v: "item", type: catType, key })}
            update={{
              label: upd!.label,
              description: upd!.description,
              updated: lastSync ? `actualizado ${timeAgo(lastSync)}` : "sin actualizar",
              busy,
              onClick: () => sync(upd!.fn),
            }}
            openData={() => go({ v: "data" })}
          />
        )}
        {base.v === "reco" && (
          <Recommend
            items={shown ?? []}
            initialType={base.type}
            busy={busy}
            onRecommend={(req) => sync((s, log, stop) => recomendar(shown ?? [], req, s, log, stop))}
            onCopyProfile={copyProfile}
            onAddBook={addRecoBook}
            onOpenItem={(r) => r.libraryKey && go({ v: "item", type: r.type, key: r.libraryKey })}
          />
        )}
        {base.v === "data" && (
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
        {base.v === "settings" && (
          <div className="narrow">
            <SettingsTab
              settings={settings}
              onSave={async (s) => {
                await saveSettings(s);
                setSettings(s);
                addLog("Ajustes guardados");
                setBanner({ text: "Ajustes guardados", done: true, autoHide: true });
              }}
            />
          </div>
        )}
      </main>

      {topLevel && (
        <BottomNav
          active={catType ?? "home"}
          onSelect={(t) => {
            if (t === (catType ?? "home")) main.current?.scrollTo({ top: 0, behavior: "smooth" });
            else tab(t === "home" ? { v: "home" } : { v: "cat", type: t });
          }}
        />
      )}

      {/* Abajo, encima de la barra: «Añadir libro» y el aviso (que empuja el botón hacia arriba) */}
      <div className="floating">
        {catType === "book" && !isOverlay(view) && (
          <button className="fab book" onClick={() => go({ v: "book", type: "book" })}>
            <IconPlus /> Añadir libro
          </button>
        )}
        {banner && (
          <div className={`snackbar ${banner.done ? "done" : ""}`} role="status" aria-live="polite">
            <span>{banner.text}</span>
            {!banner.done && stoppable && (
              <button className="link" onClick={() => (stopper.current.stopped = true)}>
                Detener
              </button>
            )}
            {banner.done && banner.goSettings && (
              <button
                className="link"
                onClick={() => {
                  setBanner(null);
                  go({ v: "settings" });
                }}
              >
                Ir a Ajustes
              </button>
            )}
            {banner.done && (
              <button className="icon small" onClick={() => setBanner(null)} aria-label="Cerrar aviso">
                <IconClose />
              </button>
            )}
          </div>
        )}
      </div>

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
