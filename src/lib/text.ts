export const norm = (s: unknown) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿?]/g, "")
    .trim()
    .toLowerCase();

export const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "_").slice(0, 80);
