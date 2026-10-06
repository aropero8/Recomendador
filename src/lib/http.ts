const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** GET JSON con pausa entre peticiones y reintentos si hay límite (429). */
export async function getJson(url: string, opts: { delay?: number; retries?: number } = {}) {
  const { delay = 0, retries = 5 } = opts;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.status === 429) {
        await sleep(2000 * (i + 1));
        continue;
      }
      if (!r.ok) return null;
      const js = await r.json();
      if (delay) await sleep(delay);
      return js;
    } catch {
      await sleep(1000);
    }
  }
  return null;
}

export const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
