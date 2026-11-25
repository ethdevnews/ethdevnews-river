const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ');
}

export function cleanText(s: string): string {
  return decodeEntities(stripTags(s)).replace(/\s+/g, ' ').trim();
}

function metaContent(html: string, attr: 'property' | 'name', key: string): string | null {
  const re1 = new RegExp(`<meta[^>]+${attr}=["']${key}["'][^>]*content=["']([^"']*)["']`, 'i');
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*${attr}=["']${key}["']`, 'i');
  const m = html.match(re1) ?? html.match(re2);
  return m ? cleanText(m[1]) : null;
}

/** The page's own title: og:title, then twitter:title, then <title>. */
export function extractTitle(html: string): string | null {
  const og = metaContent(html, 'property', 'og:title') ?? metaContent(html, 'name', 'twitter:title');
  if (og) return og;
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (t) {
    const title = cleanText(t[1]);
    if (title) return title;
  }
  return null;
}

export function extractPublishedTime(html: string): number | null {
  const v = metaContent(html, 'property', 'article:published_time');
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

/** Absolute http(s) links found in an HTML fragment. */
export function extractLinks(html: string, base?: string): string[] {
  const out = new Set<string>();
  const re = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const href = decodeEntities(m[1]);
    try {
      const u = new URL(href, base);
      if (u.protocol === 'http:' || u.protocol === 'https:') out.add(u.toString());
    } catch {
      /* ignore */
    }
  }
  // Bare URLs in text too (Discourse excerpts, tweet text)
  const bare = /https?:\/\/[^\s<>"')\]]+/g;
  while ((m = bare.exec(html))) out.add(m[0].replace(/[.,;:]+$/, ''));
  return [...out];
}

/** Trim a title to a sensible length without cutting a word. */
export function clip(s: string, max = 200): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${cut.slice(0, sp > max * 0.6 ? sp : max)}…`;
}
