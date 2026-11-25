export const USER_AGENT = 'ethdevnews-river/0.1 (+https://feed.ethdevnews.com/about)';

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} from ${url}`);
  }
}

export async function get(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
  const { timeoutMs = 15000, headers, ...rest } = init;
  const res = await fetch(url, {
    ...rest,
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: '*/*', ...(headers as Record<string, string>) },
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

export async function getText(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<string> {
  return (await get(url, init)).text();
}

export async function getJson<T = any>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  return (await get(url, { ...init, headers: { accept: 'application/json', ...(init?.headers as Record<string, string>) } })).json() as Promise<T>;
}

/** Fetch at most `maxBytes` of a page's HTML (enough for <head>). */
export async function getHead(url: string, maxBytes = 200_000): Promise<{ html: string; finalUrl: string }> {
  const res = await get(url, { headers: { accept: 'text/html,application/xhtml+xml' } });
  const reader = res.body?.getReader();
  if (!reader) return { html: '', finalUrl: res.url || url };
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < maxBytes) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.byteLength;
  }
  reader.cancel().catch(() => {});
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { html: new TextDecoder().decode(buf), finalUrl: res.url || url };
}
