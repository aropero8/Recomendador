// Genera el icono de la app (un abanico de cuatro cartas, una por categoría con sus colores, y un destello
// encima: «te recomiendo algo») y la pantalla de carga.
// - Iconos de Android: se escriben directamente en android/app/src/main/res, cada uno a su tamaño: el adaptativo
//   (fondo, primer plano y capa monocroma para los iconos temáticos de Android 13) y los antiguos, cuadrado y redondo.
// - Pantalla de carga: assets/splash.png y assets/splash-dark.png. Después, `npx @capacitor/assets generate --android`
//   saca todos los tamaños (en assets/ no hay icon-*.png, así que no toca los iconos).
// Uso: node scripts/icono.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const RES = "android/app/src/main/res";
// Anime, manga, películas y libros: los colores de la app en modo oscuro
const CARDS = ["#ff80ab", "#88a9ff", "#ffb15e", "#5fd39c"];
// Fondo de la pantalla de carga: el de la app en modo claro y oscuro
const LIGHT_BG = "#f5f3ee";
const DARK_BG = "#111216";

// Todo se dibuja en 108 × 108 (dp del icono adaptativo). Lo visible son los 72 centrales (de 18 a 90) y lo
// que no se recorta con ninguna máscara, un círculo de 66 de diámetro en el centro: ahí va el dibujo.
const W = 20; // carta (proporción de póster)
const H = 29;
const PIVOT = [54, 81]; // las cartas giran alrededor de este punto, como una mano de cartas
const ANGLES = [-33, -11, 11, 33];

/** Destello de cuatro puntas centrado en (cx, cy) con radio r. */
function sparkle(cx, cy, r, fill) {
  const i = r * 0.28;
  const j = i * 0.35;
  return (
    `<path fill="${fill}" d="M${cx} ${cy - r}C${cx + j} ${cy - i} ${cx + i} ${cy - j} ${cx + r} ${cy}` +
    `C${cx + i} ${cy + j} ${cx + j} ${cy + i} ${cx} ${cy + r}C${cx - j} ${cy + i} ${cx - i} ${cy + j} ${cx - r} ${cy}` +
    `C${cx - i} ${cy - j} ${cx - j} ${cy - i} ${cx} ${cy - r}Z"/>`
  );
}
const sparkles = (fill) => sparkle(54, 31, 8.5, fill) + sparkle(63.5, 27, 3.2, fill);

const card = (k, attrs) =>
  `<rect transform="rotate(${ANGLES[k]} ${PIVOT[0]} ${PIVOT[1]})" x="${PIVOT[0] - W / 2}" y="${PIVOT[1] - H - 4}" width="${W}" height="${H}" rx="4" ${attrs}/>`;

const BACKGROUND = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3a2a8c"/><stop offset="0.55" stop-color="#1f1650"/><stop offset="1" stop-color="#0f0b26"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.34" r="0.42">
      <stop offset="0" stop-color="#b8a7ff" stop-opacity="0.5"/><stop offset="1" stop-color="#b8a7ff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="108" height="108" fill="url(#bg)"/><rect width="108" height="108" fill="url(#glow)"/>`;

const FOREGROUND = `
  <defs>
    <linearGradient id="shine" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="1" stdDeviation="1.3" flood-color="#0b0820" flood-opacity="0.55"/>
    </filter>
    <filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2.2"/></filter>
  </defs>
  ${CARDS.map((c, k) => card(k, `fill="${c}" filter="url(#shadow)"`) + card(k, 'fill="url(#shine)"')).join("")}
  <g opacity="0.55" filter="url(#blur)">${sparkle(54, 31, 9, "#d9d0ff")}</g>
  ${sparkles("#fff")}`;

// Una sola tinta (Android la colorea con el tema): cada carta, recortada por la de delante con un hueco
const MONOCHROME = `
  <defs>${[0, 1, 2]
    .map((k) => `<mask id="m${k}" maskUnits="userSpaceOnUse" x="0" y="0" width="108" height="108"><rect width="108" height="108" fill="#fff"/>${card(k + 1, 'fill="#000" stroke="#000" stroke-width="3.2"')}</mask>`)
    .join("")}</defs>
  ${CARDS.map((_, k) => `<g${k < 3 ? ` mask="url(#m${k})"` : ""}>${card(k, 'fill="#fff"')}</g>`).join("")}
  ${sparkles("#fff")}`;

const svg = (size, body, viewBox = "0 0 108 108") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${viewBox}">${body}</svg>`);

/** El icono completo en una pieza (lo visible del adaptativo) recortado con una forma: para Android antiguo y la pantalla de carga. */
const tile = (size, shape) =>
  svg(size, `<defs><clipPath id="shape">${shape}</clipPath></defs><g clip-path="url(#shape)">${BACKGROUND}${FOREGROUND}</g>`, "18 18 72 72");
const ROUNDED = `<rect x="19" y="19" width="70" height="70" rx="16"/>`;
const ROUND = `<circle cx="54" cy="54" r="35"/>`;

async function png(buf, file) {
  await sharp(buf).png().toFile(file);
  console.log(file);
}

// Iconos de Android: 108 dp las capas del adaptativo y 48 dp los antiguos, en cada densidad
const DENSITIES = { ldpi: 0.75, mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = `${RES}/mipmap-${d}`;
  mkdirSync(dir, { recursive: true });
  await png(svg(108 * k, BACKGROUND), `${dir}/ic_launcher_background.png`);
  await png(svg(108 * k, FOREGROUND), `${dir}/ic_launcher_foreground.png`);
  await png(svg(108 * k, MONOCHROME), `${dir}/ic_launcher_monochrome.png`);
  await png(tile(48 * k, ROUNDED), `${dir}/ic_launcher.png`);
  await png(tile(48 * k, ROUND), `${dir}/ic_launcher_round.png`);
}

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
for (const name of ["ic_launcher", "ic_launcher_round"]) writeFileSync(`${RES}/mipmap-anydpi-v26/${name}.xml`, ADAPTIVE);

// Pantalla de carga: el icono en el centro sobre el fondo de la app
async function splash(bg, file) {
  const size = 2732;
  const icon = 560;
  const shadow = svg(size, `<rect x="${(size - icon) / 2}" y="${(size - icon) / 2 + 16}" width="${icon}" height="${icon}" rx="${icon * 0.23}" fill="#000" opacity="0.18"/>`, `0 0 ${size} ${size}`);
  await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
    .composite([
      { input: await sharp(shadow).blur(18).png().toBuffer() },
      { input: await sharp(tile(icon, ROUNDED)).png().toBuffer(), gravity: "center" },
    ])
    .png()
    .toFile(file);
  console.log(file);
}
mkdirSync("assets", { recursive: true });
await splash(LIGHT_BG, "assets/splash.png");
await splash(DARK_BG, "assets/splash-dark.png");
