import { useEffect, useMemo, useRef, useState } from "react";
import type { Item } from "../types";
import Cover from "./Cover";
import { IconShuffle } from "./icons";

const MAX = 12; // porciones de la ruleta: con más, los pósters no caben
const TURNS = 6; // vueltas completas antes de pararse
const SPIN_MS = 4800; // lo que dura la transición de .wheel-disc (styles.css)

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

/** Tono de cada porción: alternos y, si son impares, la última con un tercero para que no toque otra igual. */
const shade = (k: number, n: number) => (n > 1 && n % 2 === 1 && k === n - 1 ? 2 : k % 2);

/** «2024 · Dirección»: lo mismo que bajo el título de la ficha. */
const subtitle = (i: Item) => [i.extra.year, i.extra.director].filter(Boolean).join(" · ");

interface Props {
  items: Item[]; // tu biblioteca tal como se muestra
  onOpen: (key: string) => void;
}

/** «Ver peli»: una ruleta con tus películas pendientes (la watchlist de Letterboxd) que elige una al azar. */
export default function Ruleta({ items, onOpen }: Props) {
  const pending = useMemo(() => items.filter((i) => i.type === "movie" && i.status === "plan"), [items]);
  // Las de la ruleta se fijan al entrar (o al pulsar «Otras pelis») para que no cambien mientras gira
  const [wheel, setWheel] = useState<Item[]>(() => sample(pending, MAX));
  const [angle, setAngle] = useState(0); // giro acumulado, en grados
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const wheelRef = useRef<HTMLDivElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!wheel.length && pending.length) setWheel(sample(pending, MAX));
  }, [pending, wheel.length]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const land = () => {
    clearTimeout(timer.current);
    setSpinning(false);
  };

  // Al pararse, el resultado se ve aunque quede por debajo de la pantalla
  const done = winner != null && !spinning;
  useEffect(() => {
    if (done) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [done]);

  const spin = () => {
    if (spinning || !wheel.length) return;
    const seg = 360 / wheel.length;
    const w = Math.floor(Math.random() * wheel.length);
    // Ángulo final que deja la porción `w` bajo la flecha, sin caer justo en el borde (con una sola, su póster)
    const stop = -(w + 0.5) * seg + (wheel.length > 1 ? (Math.random() - 0.5) * seg * 0.7 : 0);
    const delta = (((stop - angle) % 360) + 360) % 360;
    setAngle(angle + TURNS * 360 + delta);
    setWinner(w);
    setSpinning(true);
    // Por si no llega el transitionend (pestaña en segundo plano)
    clearTimeout(timer.current);
    timer.current = setTimeout(land, SPIN_MS + 400);
    wheelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const shuffle = () => {
    setWheel(sample(pending, MAX));
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
  const won = done ? wheel[winner] : null;
  const where: string[] = won?.extra.providersEs ?? [];

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
        {pending.length > n && (
          <button className="text-btn" onClick={shuffle} disabled={spinning}>
            <IconShuffle /> Otras pelis
          </button>
        )}
      </div>

      <div className="wheel" ref={wheelRef}>
        <svg className="wheel-pointer" viewBox="0 0 28 34" aria-hidden>
          <path d="M3 3h22L14 31z" />
        </svg>
        <div
          className={`wheel-disc ${n <= 6 ? "few" : ""} ${done ? "done" : ""}`}
          style={{ transform: `rotate(${angle}deg)` }}
          onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === "transform" && land()}
        >
          <svg viewBox="-100 -100 200 200" aria-hidden>
            {n === 1 ? (
              <circle r="100" className="wheel-slice s0 won" />
            ) : (
              wheel.map((i, k) => (
                <path key={i.key} className={`wheel-slice s${shade(k, n)} ${done && k === winner ? "won" : ""}`} d={slicePath(k * seg, (k + 1) * seg)} />
              ))
            )}
            {n > 1 &&
              wheel.map((i, k) => {
                const rad = ((k * seg - 90) * Math.PI) / 180;
                return <circle key={i.key} className="wheel-peg" cx={94 * Math.cos(rad)} cy={94 * Math.sin(rad)} r="2.4" />;
              })}
          </svg>
          {wheel.map((i, k) => (
            <div key={i.key} className={`wheel-spoke ${done && k === winner ? "won" : ""}`} style={{ transform: `rotate(${(k + 0.5) * seg}deg)` }}>
              <div className="wheel-poster">
                <Cover item={i} eager />
              </div>
            </div>
          ))}
        </div>
        <button className="wheel-hub" onClick={spin} disabled={spinning} aria-label="Girar la ruleta">
          Girar
        </button>
      </div>

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
