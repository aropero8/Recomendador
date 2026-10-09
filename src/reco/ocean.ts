import { norm } from "../lib/text";

// «An Ocean of Books» (Google Arts & Culture): un mapa con libros de Google Books colocados según lo
// parecido de su texto; cada autor es una isla. Sus datos son públicos (Google Cloud Storage, con CORS)
// y aquí se consultan en directo, sin copiarlos: se buscan tus libros o autores favoritos en el mapa
// y se cogen los libros de otros autores que tienen más cerca, como candidatos para Gemini.

const DATA = "https://storage.googleapis.com/cilex-books-map-data";
const TILES = "https://storage.googleapis.com/cilex-books-map-tiles/points";
const ZOOM = 12; // nivel de las teselas de puntos que se leen (de 3 a 16; más zoom, más libros y más pequeños)

/** Posición en el mapa, en coordenadas del mundo de 0 a 1 (Web Mercator). */
interface Pos {
  x: number;
  y: number;
}

export interface OceanBook {
  title: string;
  author: string;
  id: string;
  pos: Pos;
}

/** Un libro o autor tuyo encontrado en el mapa. */
export interface Anchor {
  label: string; // lo tuyo: «Título (Autor)» o el autor
  author: string; // el autor tal como sale en el mapa (para no recomendarte más de lo mismo)
  pos: Pos;
}

export interface Neighbor extends OceanBook {
  near: string; // el ancla de la que sale
  dist: number;
}

// ---------- coordenadas ----------

const mercator = (lng: number, lat: number): Pos => {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return { x: (lng + 180) / 360, y: 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI) };
};
const dist = (a: Pos, b: Pos) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- teselas vectoriales (Mapbox Vector Tile, protobuf) ----------

/** Lector mínimo de protobuf: solo lo que hace falta para las teselas de puntos. */
class Pbf {
  pos = 0;
  constructor(
    private buf: Uint8Array,
    public end = buf.length,
  ) {}
  varint() {
    let v = 0;
    let mul = 1;
    for (;;) {
      if (this.pos >= this.buf.length) throw new Error("protobuf: tesela cortada");
      const b = this.buf[this.pos++];
      v += (b & 0x7f) * mul;
      if (b < 0x80) return v;
      mul *= 128;
    }
  }
  /** Siguiente campo: [número, tipo] o null al final. */
  field(): [number, number] | null {
    if (this.pos >= this.end) return null;
    const k = this.varint();
    return [Math.floor(k / 8), k & 7];
  }
  sub() {
    const len = this.varint();
    const p = new Pbf(this.buf, this.pos + len);
    p.pos = this.pos;
    this.pos += len;
    return p;
  }
  string() {
    const len = this.varint();
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return s;
  }
  packed() {
    const p = this.sub();
    const out: number[] = [];
    while (p.pos < p.end) out.push(p.varint());
    return out;
  }
  skip(type: number) {
    if (type === 0) this.varint();
    else if (type === 1) this.pos += 8;
    else if (type === 2) {
      const len = this.varint(); // antes de sumar: varint() también avanza pos
      this.pos += len;
    }
    else if (type === 5) this.pos += 4;
    else throw new Error(`protobuf: tipo ${type} desconocido`);
  }
}

type Value = string | number | boolean | null;

function readValue(p: Pbf): Value {
  let v: Value = null;
  for (let f; (f = p.field()); ) {
    const [n, t] = f;
    if (n === 1) v = p.string();
    else if (n === 4 || n === 5) v = p.varint();
    else if (n === 7) v = p.varint() === 1;
    else if (n === 2) {
      v = new DataView(p["buf"].buffer, p["buf"].byteOffset + p.pos, 4).getFloat32(0, true);
      p.pos += 4;
    } else if (n === 3) {
      v = new DataView(p["buf"].buffer, p["buf"].byteOffset + p.pos, 8).getFloat64(0, true);
      p.pos += 8;
    } else p.skip(t);
  }
  return v;
}

/** Los puntos de una tesela: propiedades y posición dentro de ella (de 0 a 1). */
export function decodeTile(buf: Uint8Array) {
  const out: { props: Record<string, Value>; x: number; y: number }[] = [];
  const tile = new Pbf(buf);
  for (let f; (f = tile.field()); ) {
    if (f[0] !== 3) {
      tile.skip(f[1]);
      continue;
    }
    const layer = tile.sub();
    const keys: string[] = [];
    const values: Value[] = [];
    const feats: { tags: number[]; geom: number[] }[] = [];
    let extent = 4096;
    for (let g; (g = layer.field()); ) {
      const [n, t] = g;
      if (n === 3) keys.push(layer.string());
      else if (n === 4) values.push(readValue(layer.sub()));
      else if (n === 5) extent = layer.varint();
      else if (n === 2) {
        const fp = layer.sub();
        const feat = { tags: [] as number[], geom: [] as number[] };
        for (let h; (h = fp.field()); ) {
          if (h[0] === 2) feat.tags = fp.packed();
          else if (h[0] === 4) feat.geom = fp.packed();
          else fp.skip(h[1]);
        }
        feats.push(feat);
      } else layer.skip(t);
    }
    for (const { tags, geom } of feats) {
      // Punto: MoveTo (comando 1) con un par de coordenadas en zigzag
      if ((geom[0] & 7) !== 1 || geom.length < 3) continue;
      const zz = (v: number) => (v >>> 1) ^ -(v & 1);
      const props: Record<string, Value> = {};
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = values[tags[i + 1]];
      out.push({ props, x: zz(geom[1]) / extent, y: zz(geom[2]) / extent });
    }
  }
  return out;
}

// ---------- descargas ----------

async function fetchText(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Ocean of Books responde ${r.status}`);
  return r.text();
}

/** CSV sencillo con comillas (los títulos pueden llevar comas). */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(cell), (cell = "");
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += c;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  return rows.slice(1).filter((r) => r.length > 1);
}

interface IndexAuthor {
  name: string;
  pos: Pos; // el centro de su isla
  box: [Pos, Pos]; // el recuadro de su isla (esquinas superior izquierda e inferior derecha)
}
interface Index {
  books: OceanBook[];
  authors: IndexAuthor[];
}
let index: Promise<Index> | null = null;

const inBox = (p: Pos, [a, b]: [Pos, Pos]) => p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y;
const area = ([a, b]: [Pos, Pos]) => (b.x - a.x) * (b.y - a.y);

/**
 * Los índices de búsqueda del mapa: ~4.000 libros y ~1.000 autores conocidos (unos 250 kB). Los
 * libros no traen autor: se les pone el de la isla en la que caen (la más pequeña, si hay varias).
 */
function loadIndex() {
  index ??= Promise.all([fetchText(`${DATA}/search-db/search-books.csv.gz`), fetchText(`${DATA}/search-db/search-authors.csv.gz`)])
    .then(([b, a]) => {
      const authors = parseCsv(a).map(([name, , minX, minY, maxX, maxY]): IndexAuthor => {
        const m = 0.02; // margen en grados: algunos libros caen justo en el borde de la isla
        const box: [Pos, Pos] = [mercator(+minX - m, +maxY + m), mercator(+maxX + m, +minY - m)];
        return { name, pos: mercator((+minX + +maxX) / 2, (+minY + +maxY) / 2), box };
      });
      const books = parseCsv(b).map(([title, id, lng, lat]) => {
        const pos = mercator(+lng, +lat);
        const isle = authors.filter((x) => inBox(pos, x.box)).sort((x, y) => area(x.box) - area(y.box))[0];
        return { title, id, author: isle?.name ?? "", pos };
      });
      return { books, authors };
    })
    .catch((e) => {
      index = null; // para reintentar la próxima vez
      throw e;
    });
  return index;
}

const tiles = new Map<string, Promise<OceanBook[]>>();

/** Los libros de una tesela (vacía si es mar: el servidor responde 403 o 404). */
function tileBooks(x: number, y: number): Promise<OceanBook[]> {
  const key = `${ZOOM}/${x}/${y}`;
  let p = tiles.get(key);
  if (!p) {
    p = fetch(`${TILES}/${key}.pbf`)
      .then(async (r) => (r.ok ? decodeTile(new Uint8Array(await r.arrayBuffer())) : []))
      .then((pts) =>
        pts
          .filter((p) => typeof p.props.title === "string" && p.props.title)
          .map((p) => ({
            title: String(p.props.title),
            author: String(p.props.author_id ?? ""),
            id: String(p.props.book_id ?? ""),
            pos: { x: (x + p.x) / 2 ** ZOOM, y: (y + p.y) / 2 ** ZOOM },
          })),
      )
      .catch(() => {
        tiles.delete(key);
        return [];
      });
    tiles.set(key, p);
  }
  return p;
}

// ---------- búsqueda ----------

const words = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const surname = (s: string) => words(s).split(" ").pop() ?? "";

/** Mismo autor: nombre completo igual o mismo apellido e inicial («J. R. R. Tolkien» y «J.R.R. Tolkien»). */
export function sameAuthor(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x || !y) return false;
  return x === y || (surname(a) === surname(b) && surname(a).length > 2 && x[0] === y[0]);
}

export interface Favorite {
  title: string;
  author?: string;
  label: string;
}

/**
 * Busca tus favoritos en el mapa: el libro si está en el índice (mismo título y autor) y, si no,
 * la isla de su autor. Devuelve un ancla por favorito encontrado.
 */
export async function findAnchors(favs: Favorite[]): Promise<Anchor[]> {
  const { books, authors } = await loadIndex();
  const out: Anchor[] = [];
  for (const f of favs) {
    const author = f.author ? authors.find((a) => sameAuthor(a.name, f.author!)) : undefined;
    const book = books.find((b) => words(b.title) === words(f.title));
    // El libro solo vale con su autor (si su isla está lejos, es otro libro con el mismo título)
    const a =
      book && (!author || dist(book.pos, author.pos) < 0.002)
        ? { label: f.label, author: author?.name ?? f.author ?? "", pos: book.pos }
        : author && { label: f.label, author: author.name, pos: author.pos };
    // Dos favoritos del mismo autor sin libro en el índice caen en el mismo sitio: basta uno
    if (a && !out.some((o) => dist(o.pos, a.pos) < 1e-6)) out.push(a);
  }
  return out;
}

/** Si una recomendación sale de los candidatos del mapa (mismo autor o mismo título). */
export const fromMap = (cands: OceanBook[], titles: (string | null | undefined)[], author?: string | null) =>
  cands.some((c) => (!!author && sameAuthor(c.author, author)) || titles.some((t) => !!t && words(t) === words(c.title)));

/** Para no proponer libros que ya tienes: título normalizado. */
export const titleKey = words;

/**
 * Los libros de otros autores más cerca de cada ancla: los del índice (los más conocidos) y los de las
 * teselas de alrededor (3×3). Se queda con `perAnchor` libros por ancla, como mucho 2 por autor.
 */
export async function neighbors(anchors: Anchor[], perAnchor = 6, skip: (b: OceanBook) => boolean = () => false): Promise<Neighbor[]> {
  const { books } = await loadIndex();
  const n = 2 ** ZOOM;
  const out: Neighbor[] = [];
  const taken = new Set<string>();
  for (const a of anchors) {
    const tx = Math.floor(a.pos.x * n);
    const ty = Math.floor(a.pos.y * n);
    const around: Promise<OceanBook[]>[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) if (ty + dy >= 0 && ty + dy < n) around.push(tileBooks((tx + dx + n) % n, ty + dy));
    const near = [...books, ...(await Promise.all(around)).flat()]
      .filter((b) => !anchors.some((x) => sameAuthor(x.author, b.author)) && !skip(b))
      .map((b) => ({ ...b, near: a.label, dist: dist(a.pos, b.pos) }))
      .sort((x, y) => x.dist - y.dist);
    const perAuthor = new Map<string, number>();
    let added = 0;
    for (const b of near) {
      if (added >= perAnchor) break;
      const k = words(b.title);
      const au = words(b.author) || k; // sin autor conocido, cada libro cuenta como uno distinto
      if (taken.has(k) || (perAuthor.get(au) ?? 0) >= 2) continue;
      taken.add(k);
      perAuthor.set(au, (perAuthor.get(au) ?? 0) + 1);
      out.push(b);
      added++;
    }
  }
  return out;
}
