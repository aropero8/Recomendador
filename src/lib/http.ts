const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

interface GetJsonOpts {
  delay?: number;
  retries?: number;
  headers?: Record<string, string>;
  /** Si es true, una respuesta no-OK lanza HttpError en vez de devolver null. */
  strict?: boolean;
}

/** GET JSON con pausa entre peticiones y reintentos si hay límite (429). */
export async function getJson(url: string, opts: GetJsonOpts = {}) {
  const { delay = 0, retries = 5, headers, strict = false } = opts;
  for (let i = 0; i < retries; i++) {
    let r: Response;
    try {
      r = await fetch(url, { headers });
    } catch {
      await sleep(1000);
      continue;
    }
    if (r.status === 429) {
      await sleep(2000 * (i + 1));
      continue;
    }
    if (!r.ok) {
      if (strict) throw new HttpError(r.status);
      return null;
    }
    const js = await r.json();
    if (delay) await sleep(delay);
    return js;
  }
  return null;
}

export const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
