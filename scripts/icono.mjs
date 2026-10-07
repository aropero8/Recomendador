// Genera las imágenes de origen del icono y la pantalla de carga en assets/ (las 4 categorías con
// sus colores, sin texto). Después: npx @capacitor/assets generate --android
// Uso: node scripts/icono.mjs
import { mkdirSync } from "node:fs";
import sharp from "sharp";

const DARK_BG = "#131a20";
const LIGHT_BG = "#f1f4ee";
// Anime, manga, películas y libros: los mismos colores que la app (modo oscuro y modo claro)
const DARK = ["#d98bb8", "#7fa6e6", "#e0b862", "#7cc08a"];
const LIGHT = ["#8a3f6b", "#2f5fa8", "#9a6f1c", "#3d7a4a"];

/** SVG de `size` px con los 4 cuadrados en 2×2 ocupando `area` px en el centro. */
function svg(size, area, colors, bg) {
  const gap = area * 0.07;
  const side = (area - gap) / 2;
  const r = side * 0.22;
  const x0 = (size - area) / 2;
  const tiles = colors
    .map((c, i) => {
      const x = x0 + (i % 2) * (side + gap);
      const y = x0 + Math.floor(i / 2) * (side + gap);
      return `<rect x="${x}" y="${y}" width="${side}" height="${side}" rx="${r}" fill="${c}"/>`;
    })
    .join("");
  const back = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : "";
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${back}${tiles}</svg>`);
}

const out = [
  // Icono completo (Android antiguo e icono redondo)
  ["icon-only.png", svg(1024, 600, DARK, DARK_BG)],
  // Icono adaptativo: primer plano dentro de la zona segura (66 % central) y fondo liso
  ["icon-foreground.png", svg(1024, 520, DARK, null)],
  ["icon-background.png", svg(1024, 0, [], DARK_BG)],
  // Pantalla de carga
  ["splash.png", svg(2732, 560, LIGHT, LIGHT_BG)],
  ["splash-dark.png", svg(2732, 560, DARK, DARK_BG)],
];

mkdirSync("assets", { recursive: true });
for (const [name, buf] of out) {
  await sharp(buf).png().toFile(`assets/${name}`);
  console.log(`assets/${name}`);
}
