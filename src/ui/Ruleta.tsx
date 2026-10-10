import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../types";
import Cover from "./Cover";
import { IconShuffle, IconSliders } from "./icons";
import {
  loadWheelPrefs,
  MAX_COUNT,
  MIN_COUNT,
  posterWidth,
  prepareSound,
  saveWheelPrefs,
  SHOWS,
  sliceColors,
  SPEEDS,
  SPIN,
  STYLES,
  tick,
  type WheelPrefs,
} from "./wheel";

/** Hasta `n` elementos al azar, sin repetir (Fisher-Yates parcial). */
function sample<T>(xs: T[], n: number): T[] {
  const a = [...xs];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

/** Porción de la ruleta en un SVG de -100 a 100: de `from` a `to` grados, con 0 arriba y en el sentido de las agujas. */
function slicePath(from: number, to: number) {
  const p = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return `${(100 * Math.cos(rad)).toFixed(2)} ${(100 * Math.sin(rad)).toFixed(2)}`;
  };
  return `M0 0L${p(from)}A100 100 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}Z`;
}

// Títulos: a lo largo del radio, desde el borde hasta cerca del botón central (en unidades del SVG)
const LABEL_END = 91;
const LABEL_LEN = 62;

/** Tamaño de letra y texto (recortado si no cabe) del título de una porción de `n`. */
function label(title: string, n: number) {
  const max = Math.min(9, (314 / n) * 0.55); // lo que deja el ancho de la porción a media altura
  const size = Math.max(Math.min(max, 6), Math.min(max, LABEL_LEN / (title.length * 0.56)));
  const fits = Math.floor(LABEL_LEN / (size * 0.56));
  return { size, text: title.length > fits ? `${title.slice(0, fits - 1).trimEnd()}…` : title };
}

/** «2024 · Dirección»: lo mismo que bajo el título de la ficha. */
const subtitle = (i: Item) => [i.extra.year, i.extra.director].filter(Boolean).join(" · ");

interface Props {
  items: Item[]; // tu biblioteca tal como se muestra
  onOpen: (key: string) => void;
}

/** «Ver peli»: una ruleta con tus películas pendientes (la watchlist de Letterboxd) que elige una al azar. */
export default function Ruleta({ items, onOpen }: Props) {
  const pending = useMemo(() => items.filter((i) => i.type === "movie" && i.status === "plan"), [items]);
  const [prefs, setPrefs] = useState(loadWheelPrefs);
  const [custom, setCustom] = useState(false); // panel «Personalizar» abierto
  // Las de la ruleta se fijan al entrar (o al pulsar «Otras pelis») para que no cambien mientras gira
  const [wheel, setWheel] = useState<Item[]>(() => sample(pending, prefs.count));
  const [angle, setAngle] = useState(0); // giro acumulado, en grados
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const wheelRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const prefsRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wheel.length && pending.length) setWheel(sample(pending, prefs.count));
  }, [pending, wheel.length, prefs.count]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const update = (p: Partial<WheelPrefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    saveWheelPrefs(next);
    if (p.count != null && p.count !== wheel.length) {
      setWheel(sample(pending, p.count));
      setWinner(null);
    }
  };

  const land = () => {
    clearTimeout(timer.current);
    setSpinning(false);
  };

  // Al pararse, el resultado se ve aunque quede por debajo de la pantalla
  const done = winner != null && !spinning;
  useEffect(() => {
    if (done) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [done]);
  useEffect(() => {
    if (custom) prefsRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [custom]);

  // Sonido: un clic cada vez que un separador pasa por la flecha (se lee el giro de la animación en cada fotograma)
  useEffect(() => {
    const el = discRef.current;
    if (!spinning || !prefs.sound || wheel.length < 2 || !el) return;
    const seg = 360 / wheel.length;
    let raf = 0;
    let last: number | null = null;
    let turned = 0; // grados girados desde el principio, sin dar la vuelta a 360
    let notch = 0;
    const frame = () => {
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      const a = (((Math.atan2(m.b, m.a) * 180) / Math.PI) % 360 + 360) % 360;
      if (last == null) {
        turned = a;
        notch = Math.floor(a / seg);
      } else turned += (a - last + 360) % 360;
      last = a;
      const k = Math.floor(turned / seg);
      if (k !== notch) {
        notch = k;
        tick();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [spinning, prefs.sound, wheel.length]);

  const { ms, turns } = SPIN[prefs.speed];

  const spin = () => {
    if (spinning || !wheel.length) return;
    if (prefs.sound) prepareSound(); // ahora, que hay un toque: los navegadores no dejan sonar antes
    const seg = 360 / wheel.length;
    const w = Math.floor(Math.random() * wheel.length);
    // Ángulo final que deja la porción `w` bajo la flecha, sin caer justo en el borde (con una sola, su póster)
    const stop = -(w + 0.5) * seg + (wheel.length > 1 ? (Math.random() - 0.5) * seg * 0.7 : 0);
    const delta = (((stop - angle) % 360) + 360) % 360;
    setAngle(angle + turns * 360 + delta);
    setWinner(w);
    setSpinning(true);
    // Por si no llega el transitionend (pestaña en segundo plano)
    clearTimeout(timer.current);
    timer.current = setTimeout(land, ms + 400);
    wheelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const shuffle = () => {
    setWheel(sample(pending, prefs.count));
    setWinner(null);
  };

  if (!pending.length) {
    return (
      <div className="narrow empty">
        <p>No tienes películas pendientes.</p>
        <p className="hint">Añádelas a tu watchlist de Letterboxd e impórtala desde Datos.</p>
      </div>
    );
  }

  const n = wheel.length;
  const seg = 360 / n;
  const colors = sliceColors(prefs.style, n);
  const won = done ? wheel[winner] : null;
  const where: string[] = won?.extra.providersEs ?? [];
  const maxCount = Math.min(MAX_COUNT, pending.length);

  return (
    <div className="narrow stack ruleta cat-scope movie">
      <div className="sync-row">
        <span className="hint">
          {pending.length > n
            ? `${n} de tus ${pending.length.toLocaleString("es")} pendientes, al azar`
            : n === 1
              ? "Tu única película pendiente"
              : `Tus ${n} películas pendientes`}
        </span>
        <span className="ruleta-actions">
          {pending.length > n && (
            <button className="text-btn" onClick={shuffle} disabled={spinning}>
              <IconShuffle /> Otras pelis
            </button>
          )}
          <button className={`icon ${custom ? "on" : ""}`} onClick={() => setCustom(!custom)} aria-expanded={custom} aria-label="Personalizar la ruleta">
            <IconSliders />
          </button>
        </span>
      </div>

      <div className={`wheel look-${prefs.style}`} ref={wheelRef}>
        <svg className="wheel-pointer" viewBox="0 0 28 34" aria-hidden>
          <path d="M3 3h22L14 31z" />
        </svg>
        <div className="wheel-face">
          <div
            ref={discRef}
            className={`wheel-disc ${done ? "done" : ""}`}
            style={{ transform: `rotate(${angle}deg)`, transitionDuration: `${ms}ms`, ["--pw" as string]: `${posterWidth(n)}%` }}
            onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === "transform" && land()}
          >
            <svg viewBox="-100 -100 200 200" aria-hidden>
              <circle r="100" className="wheel-backdrop" />
              {n === 1 ? (
                <circle r="100" className="wheel-slice won" style={{ fill: colors[0].fill }} />
              ) : (
                wheel.map((i, k) => (
                  <path key={i.key} className={`wheel-slice ${done && k === winner ? "won" : ""}`} style={{ fill: colors[k].fill }} d={slicePath(k * seg, (k + 1) * seg)} />
                ))
              )}
              {n > 1 &&
                wheel.map((i, k) => {
                  const rad = ((k * seg - 90) * Math.PI) / 180;
                  return <circle key={i.key} className="wheel-peg" cx={94 * Math.cos(rad)} cy={94 * Math.sin(rad)} r="2.4" />;
                })}
              {prefs.show === "title" &&
                wheel.map((i, k) => {
                  const l = label(i.title, n);
                  return (
                    <text
                      key={i.key}
                      className={`wheel-label ${done && k === winner ? "won" : ""}`}
                      transform={`rotate(${(k + 0.5) * seg - 90})`}
                      x={LABEL_END}
                      textAnchor="end"
                      dominantBaseline="central"
                      style={{ fill: colors[k].ink, fontSize: l.size }}
                    >
                      {l.text}
                    </text>
                  );
                })}
            </svg>
            {prefs.show === "poster" &&
              wheel.map((i, k) => (
                <div key={i.key} className={`wheel-spoke ${done && k === winner ? "won" : ""}`} style={{ transform: `rotate(${(k + 0.5) * seg}deg)` }}>
                  <div className="wheel-poster">
                    <Cover item={i} eager />
                  </div>
                </div>
              ))}
          </div>
        </div>
        <button className="wheel-hub" onClick={spin} disabled={spinning} aria-label="Girar la ruleta">
          Girar
        </button>
      </div>

      {custom && (
        <section className="wheel-prefs" ref={prefsRef} aria-label="Personalizar la ruleta">
          <h2>Personaliza la ruleta</h2>
          {pending.length > MIN_COUNT ? (
            <label className="range-row">
              <span>
                Pelis en la ruleta <b>{Math.min(prefs.count, maxCount)}</b>
              </span>
              <input
                type="range"
                min={MIN_COUNT}
                max={maxCount}
                value={Math.min(prefs.count, maxCount)}
                disabled={spinning}
                onChange={(e) => update({ count: Number(e.target.value) })}
              />
            </label>
          ) : (
            <p className="hint">Con {pending.length === 1 ? "una pendiente sale esa" : "dos pendientes salen las dos"}.</p>
          )}
          <div className="field">
            Estilo
            <div className="wheel-looks" role="radiogroup" aria-label="Estilo">
              {STYLES.map(([st, name]) => {
                const cs = sliceColors(st, 8);
                const disc = `conic-gradient(${cs.map((c, k) => `${c.fill} ${k * 45}deg ${(k + 1) * 45}deg`).join(", ")})`;
                return (
                  <button
                    key={st}
                    role="radio"
                    aria-checked={prefs.style === st}
                    className={`wheel-look look-${st} ${prefs.style === st ? "on" : ""}`}
                    onClick={() => update({ style: st })}
                  >
                    <span className="wheel-look-disc" style={{ background: disc }} />
                    {name}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="field">
            En cada porción
            <div className="segmented two" role="radiogroup" aria-label="En cada porción">
              {SHOWS.map(([s, text]) => (
                <button key={s} role="radio" aria-checked={prefs.show === s} className={prefs.show === s ? "on" : ""} onClick={() => update({ show: s })}>
                  {text}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            Giro
            <div className="segmented" role="radiogroup" aria-label="Giro">
              {SPEEDS.map(([s, text]) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={prefs.speed === s}
                  className={prefs.speed === s ? "on" : ""}
                  disabled={spinning}
                  onClick={() => update({ speed: s })}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
          <label className="switch-row">
            <span>
              Sonido al girar
              <small>Un clic cada vez que pasa una porción por la flecha</small>
            </span>
            <input type="checkbox" role="switch" checked={prefs.sound} onChange={(e) => update({ sound: e.target.checked })} />
          </label>
        </section>
      )}

      <div className="ruleta-result" ref={resultRef} aria-live="polite">
        {won ? (
          <>
            <article className="ruleta-card">
              <div className="ruleta-cover">
                <Cover item={won} eager />
              </div>
              <div className="ruleta-body">
                <span className="ruleta-kicker">Te toca</span>
                <strong>{won.title}</strong>
                {subtitle(won) && <span className="hint">{subtitle(won)}</span>}
                {where.length > 0 && <span className="hint">En España: {where.join(", ")}</span>}
                {won.synopsis && <p className="ruleta-synopsis">{won.synopsis}</p>}
              </div>
            </article>
            <div className="row2">
              <button className="ghost" onClick={spin}>
                Girar otra vez
              </button>
              <button onClick={() => onOpen(won.key)}>Ver ficha</button>
            </div>
          </>
        ) : (
          <button className="big" onClick={spin} disabled={spinning}>
            {spinning ? "Girando…" : "Girar la ruleta"}
          </button>
        )}
      </div>
    </div>
  );
}
