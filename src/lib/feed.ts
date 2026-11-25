import { XMLParser } from 'fast-xml-parser';
import { cleanText, extractLinks } from './html';
import { parseDate } from './time';

export interface FeedEntry {
  id: string;
  title: string;
  url: string;
  published: number | null;
  author: string | null;
  contentHtml: string;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  textNodeName: '#text',
  isArray: (name) => ['item', 'entry', 'link', 'category'].includes(name),
  processEntities: true,
  htmlEntities: true,
});

function text(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('#text' in o) return text(o['#text']);
    if ('name' in o) return text(o.name);
  }
  return '';
}

function atomLink(links: unknown): string {
  if (!Array.isArray(links)) return text(links);
  const alt = links.find((l) => typeof l === 'object' && l && (!(l as any)['@rel'] || (l as any)['@rel'] === 'alternate'));
  const l = (alt ?? links[0]) as any;
  return typeof l === 'string' ? l : (l?.['@href'] ?? '');
}

export function parseFeed(xml: string, baseUrl?: string): FeedEntry[] {
  const doc = parser.parse(xml);
  const out: FeedEntry[] = [];
  if (doc.rss?.channel || doc['rdf:RDF']) {
    const items = doc.rss?.channel?.item ?? doc['rdf:RDF']?.item ?? [];
    for (const it of items) {
      const url = text(it.link) || text(it.guid);
      out.push({
        id: text(it.guid) || url,
        title: cleanText(text(it.title)),
        url: resolve(url, baseUrl),
        published: parseDate(text(it.pubDate) || text(it['dc:date'])),
        author: cleanText(text(it['dc:creator']) || text(it.author)) || null,
        contentHtml: text(it['content:encoded']) || text(it.description),
      });
    }
  } else if (doc.feed) {
    const entries = doc.feed.entry ?? [];
    for (const e of entries) {
      const url = atomLink(e.link);
      out.push({
        id: text(e.id) || url,
        title: cleanText(text(e.title)),
        url: resolve(url, baseUrl),
        published: parseDate(text(e.published) || text(e.updated)),
        author: cleanText(text(e.author)) || null,
        contentHtml: text(e.content) || text(e.summary),
      });
    }
  }
  return out.filter((e) => e.url && e.title);
}

function resolve(url: string, base?: string): string {
  try {
    return new URL(url.trim(), base).toString();
  } catch {
    return url.trim();
  }
}

export function entryLinks(e: FeedEntry): string[] {
  return extractLinks(e.contentHtml, e.url);
}
