import { sectionName } from '../config/sections';
import { escapeHtml as e } from '../lib/html';
import type { StoryView } from '../queries';

function storySummaryHtml(v: StoryView): string {
  const others = v.items.filter((i) => i.id !== v.headline.id);
  if (!others.length) return '';
  return `<ul>${others.map((i) => `<li><a href="${e(i.url)}">${e(i.title)}</a> [${e(i.tag)}]</li>`).join('')}</ul>`;
}

export function rssFeed(stories: StoryView[], o: { title: string; siteUrl: string; selfPath: string; description: string }): string {
  const items = stories
    .map(
      (v) => `<item>
<title>${e(`${v.headline.title} [${v.headline.tag}]`)}</title>
<link>${e(v.headline.url)}</link>
<guid isPermaLink="false">${e(`${o.siteUrl}/story/${v.story.id}#${v.story.item_count}`)}</guid>
<pubDate>${new Date(v.story.last_updated * 1000).toUTCString()}</pubDate>
<category>${e(sectionName(v.story.section))}</category>
<comments>${e(`${o.siteUrl}/story/${v.story.id}`)}</comments>
<description>${e(storySummaryHtml(v))}</description>
</item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>${e(o.title)}</title>
<link>${e(o.siteUrl)}</link>
<description>${e(o.description)}</description>
<atom:link href="${e(o.siteUrl + o.selfPath)}" rel="self" type="application/rss+xml"/>
${items}
</channel>
</rss>`;
}

export function jsonFeed(stories: StoryView[], o: { title: string; siteUrl: string; selfPath: string; description: string }) {
  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: o.title,
    home_page_url: o.siteUrl,
    feed_url: o.siteUrl + o.selfPath,
    description: o.description,
    items: stories.map((v) => ({
      id: `${o.siteUrl}/story/${v.story.id}`,
      url: v.headline.url,
      title: `${v.headline.title} [${v.headline.tag}]`,
      content_html: storySummaryHtml(v) || undefined,
      date_published: new Date(v.story.first_seen * 1000).toISOString(),
      date_modified: new Date(v.story.last_updated * 1000).toISOString(),
      tags: [sectionName(v.story.section)],
      _river: {
        section: v.story.section,
        group: v.story.group_key,
        items: v.items.map((i) => ({ title: i.title, url: i.url, tag: i.tag, kind: i.kind })),
      },
    })),
  };
}
