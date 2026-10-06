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
  extra: Record<string, any>;
  embedding?: Float32Array;
}

export const TYPE_LABEL: Record<ItemType, string> = {
  anime: "Anime",
  manga: "Manga",
  movie: "Películas",
  book: "Libros",
};

export const ITEM_TYPES: ItemType[] = ["anime", "manga", "movie", "book"];
