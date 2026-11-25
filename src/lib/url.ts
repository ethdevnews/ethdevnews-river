const TRACKING_PARAMS = /^(utm_|ref$|ref_src$|source$|s$|t$|fbclid$|gclid$|mc_|si$|igshid$)/i;

/** Canonical form used for dedupe and link matching. */
export function canonicalUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return input.trim();
  }
  u.protocol = 'https:';
  u.hash = '';
  let host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^mobile\./, '');
  if (host === 'twitter.com' || host === 'fxtwitter.com' || host === 'vxtwitter.com' || host === 'x.com') host = 'x.com';
  if (host === 'warpcast.com') host = 'farcaster.xyz';
  u.hostname = host;
  u.port = '';
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  let path = u.pathname;
  // Discourse: /t/slug/123/4 -> /t/slug/123 (a reply number points into the same topic)
  const disc = path.match(/^(\/t\/[^/]+\/\d+)(\/\d+)?\/?$/);
  if (disc) path = disc[1];
  // X: /user/status/123/photo/1 -> /user/status/123, and lowercase the user
  const x = host === 'x.com' && path.match(/^\/([^/]+)\/status(?:es)?\/(\d+)/);
  if (x) path = `/${x[1].toLowerCase()}/status/${x[2]}`;
  // GitHub: drop /files and /commits tails on PRs
  if (host === 'github.com') path = path.replace(/^(\/[^/]+\/[^/]+\/pull\/\d+)\/.*$/, '$1');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  u.pathname = path;
  const search = u.searchParams.toString();
  return `https://${host}${path === '/' ? '' : path}${search ? `?${search}` : ''}`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** True when `url` falls under `entry`, which is a domain (subdomains included),
 *  optionally followed by a path prefix: "github.com/ethereum". */
export function matchesDomainEntry(url: string, entry: string): boolean {
  const canon = canonicalUrl(url);
  let u: URL;
  try {
    u = new URL(canon);
  } catch {
    return false;
  }
  const [domain, ...rest] = entry.toLowerCase().split('/');
  const host = u.hostname;
  if (host !== domain && !host.endsWith(`.${domain}`)) return false;
  if (rest.length === 0) return true;
  const prefix = `/${rest.join('/')}`;
  const path = u.pathname.toLowerCase();
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function matchesAny(url: string, entries: string[]): boolean {
  return entries.some((e) => matchesDomainEntry(url, e));
}

/** x.com/<user>/status/<id> -> user (lowercase), else null */
export function xAccount(url: string): string | null {
  const m = canonicalUrl(url).match(/^https:\/\/x\.com\/([^/]+)\/status\/\d+/);
  return m ? m[1].toLowerCase() : null;
}

export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
