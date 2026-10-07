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
  /** Si es false, un 429 lanza HttpError(429) en vez de esperar y reintentar. */
  retry429?: boolean;
}

/** GET JSON con pausa entre peticiones y reintentos si hay límite (429). */
export async function getJson(url: string, opts: GetJsonOpts = {}) {
  const { delay = 0, retries = 5, headers, strict = false, retry429 = true } = opts;
  for (let i = 0; i < retries; i++) {
    let r: Response;
    try {
      r = await fetch(url, { headers });
    } catch {
      await sleep(1000);
      continue;
    }
    if (r.status === 429) {
      if (!retry429) throw new HttpError(429);
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
  if (strict) throw new Error(`No se pudo conectar con ${new URL(url, location.href).host}`);
  return null;
}

export const qs = (p: Record<string, string | number | undefined>) =>
  new URLSearchParams(
    Object.entries(p)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => [k, String(v)]),
  ).toString();
