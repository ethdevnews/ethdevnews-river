import type { RssSource } from '../config/sources';
import { entryLinks, parseFeed } from '../lib/feed';
import { getText } from '../lib/http';
import type { Candidate, FetchContext } from '../types';

export async function fetchRss(source: RssSource, ctx: FetchContext): Promise<Candidate[]> {
  const xml = await getText(source.url, { headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
  const out: Candidate[] = [];
  for (const e of parseFeed(xml, source.url)) {
    if (source.titleFilter && !source.titleFilter.test(e.title)) continue;
    out.push({
      url: e.url,
      title: e.title,
      kind: 'post',
      section: source.section,
      tag: source.tag,
      author: e.author,
      publishedAt: e.published ?? ctx.now,
      project: source.project ?? null,
      links: entryLinks(e).slice(0, 50),
    });
  }
  return out;
}
