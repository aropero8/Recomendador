export type ItemType = "anime" | "manga" | "movie" | "book";
export type Status = "read" | "reading" | "plan" | "dropped" | "other";
export type Log = (msg: string) => void;

export interface Item {
  key: string; // p. ej. "anime:mal:5114"
  source: "mal" | "letterboxd" | "excel";
  type: ItemType;
  title: string;
  synopsis: string;
  genres: string[];
  userScore: number | null; // escala 0-10
  status: Status;
  extra: Record<string, any>; // extra.date (ISO) se usa para ordenar por «Recientes»
  cover?: string; // URL de la portada o póster
  embedding?: Float32Array;
}

export const STATUS_LABEL: Record<Status, string> = {
  read: "Terminado",
  reading: "En curso",
  plan: "Pendiente",
  dropped: "Abandonado",
  other: "En pausa",
};

export const TYPE_LABEL: Record<ItemType, string> = {
  anime: "Anime",
  manga: "Manga",
  movie: "Películas",
  book: "Libros",
};

export const ITEM_TYPES: ItemType[] = ["anime", "manga", "movie", "book"];
