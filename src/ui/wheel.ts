// Cómo se ve y se comporta la ruleta de pelis: lo que se elige en «Personalizar». Es una preferencia de este
// dispositivo, como el tema, así que va en localStorage.

export type WheelStyle = "cine" | "arcoiris" | "casino" | "neon" | "pastel";
export type WheelShow = "poster" | "title";
export type WheelSpeed = "fast" | "normal" | "slow";

export interface WheelPrefs {
  count: number; // pelis en la ruleta (si tienes menos pendientes, todas)
  style: WheelStyle;
  show: WheelShow; // qué lleva cada porción
  speed: WheelSpeed;
  sound: boolean; // un clic cada vez que pasa un separador por la flecha
}

export const MIN_COUNT = 2;
export const MAX_COUNT = 24; // con más, ni los pósters ni los títulos caben
const DEFAULTS: WheelPrefs = { count: 12, style: "cine", show: "poster", speed: "normal", sound: false };

export const STYLES: [WheelStyle, string][] = [
  ["cine", "Cine"],
  ["arcoiris", "Arcoíris"],
  ["casino", "Casino"],
  ["neon", "Neón"],
  ["pastel", "Pastel"],
];
export const SHOWS: [WheelShow, string][] = [
  ["poster", "Pósters"],
  ["title", "Títulos"],
];
export const SPEEDS: [WheelSpeed, string][] = [
  ["fast", "Rápido"],
  ["normal", "Normal"],
  ["slow", "Con suspense"],
];
/** Lo que dura el giro (la transición de .wheel-disc) y cuántas vueltas completas da antes de pararse. */
export const SPIN: Record<WheelSpeed, { ms: number; turns: number }> = {
  fast: { ms: 2600, turns: 4 },
  normal: { ms: 4800, turns: 6 },
  slow: { ms: 8000, turns: 9 },
};

const KEY = "ruleta";

export function loadWheelPrefs(): WheelPrefs {
  try {
    const p = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
    return {
      count: Math.min(MAX_COUNT, Math.max(MIN_COUNT, Math.round(Number(p.count)) || DEFAULTS.count)),
      style: STYLES.some(([s]) => s === p.style) ? p.style : DEFAULTS.style,
      show: SHOWS.some(([s]) => s === p.show) ? p.show : DEFAULTS.show,
      speed: p.speed in SPIN ? p.speed : DEFAULTS.speed,
      sound: p.sound === true,
    };
  } catch {
    return DEFAULTS;
  }
}

export function saveWheelPrefs(p: WheelPrefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // sin almacenamiento: vale solo mientras esté abierta
  }
}

/** Colores de cada estilo: se repiten en orden; `extra` es para que la última porción no toque a la primera del mismo color. */
const PALETTES: Record<Exclude<WheelStyle, "arcoiris">, { fills: string[]; extra?: string; inks: string[] }> = {
  cine: {
    fills: ["var(--movie)", "color-mix(in srgb, var(--movie) 60%, var(--surface))"],
    extra: "color-mix(in srgb, var(--movie) 75%, #000)",
    inks: ["#fff"],
  },
  casino: { fills: ["#c62f3b", "#1c1c22"], extra: "#1f8f4e", inks: ["#fff"] },
  neon: { fills: ["#1a1433", "#251c4a"], extra: "#33276a", inks: ["#ff5ad9", "#2ee6ff", "#7dff6b", "#ffe14d"] },
  pastel: { fills: ["#ffc8d6", "#c9defe", "#fde8a8", "#c6efd4", "#e0d4ff"], inks: ["#2b2734"] },
};

/** Relleno y color del título de cada una de las `n` porciones. */
export function sliceColors(style: WheelStyle, n: number): { fill: string; ink: string }[] {
  if (style === "arcoiris")
    return Array.from({ length: n }, (_, k) => ({ fill: `hsl(${Math.round((k * 360) / n + 340) % 360} 78% 64%)`, ink: "#17161c" }));
  const { fills, extra, inks } = PALETTES[style];
  return Array.from({ length: n }, (_, k) => {
    const i = k % fills.length;
    // La última toca a la primera: si les tocaría el mismo color, otro distinto de sus dos vecinas
    const clash = n > 1 && k === n - 1 && i === 0;
    const fill = !clash ? fills[i] : fills.length > 2 ? fills[1] : (extra ?? fills[1]);
    return { fill, ink: inks[k % inks.length] };
  });
}

/** Ancho del póster de cada porción, en % del diámetro: cuantas más porciones, más pequeño para que quepa. */
export const posterWidth = (n: number) => (n <= 6 ? 16 : Math.min(12, 144 / n));

/** Clic corto (Web Audio, sin archivos). El contexto se crea al pulsar «Girar»: los navegadores no dejan antes. */
let audio: AudioContext | null = null;
export function prepareSound() {
  audio ??= new AudioContext();
  if (audio.state === "suspended") audio.resume().catch(() => null);
}
export function tick() {
  if (!audio) return;
  const t = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(1700, t);
  osc.frequency.exponentialRampToValueAtTime(900, t + 0.03);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + 0.003);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
  osc.connect(gain).connect(audio.destination);
  osc.start(t);
  osc.stop(t + 0.05);
}
