import type { Db } from './db';
import type { ItemRow, StoryRow } from './types';

export interface StoryView {
  story: StoryRow;
  headline: ItemRow;
  items: ItemRow[]; // all live items, headline included, in order seen
}

export async function loadStories(
  db: Db,
  opts: { section?: string; since?: number; before?: number; limit?: number; ids?: number[] } = {},
): Promise<StoryView[]> {
  const where: string[] = ['s.item_count > 0', 's.headline_item_id IS NOT NULL'];
  const args: unknown[] = [];
  if (opts.section) {
    where.push('s.section = ?');
    args.push(opts.section);
  }
  if (opts.since) {
    where.push('s.last_updated >= ?');
    args.push(opts.since);
  }
  if (opts.before) {
    where.push('s.last_updated < ?');
    args.push(opts.before);
  }
  if (opts.ids?.length) {
    where.push(`s.id IN (${opts.ids.map(() => '?').join(',')})`);
    args.push(...opts.ids);
  }
  const limit = Math.min(opts.limit ?? 60, 500);
  const stories = await db.all<StoryRow>(`SELECT s.* FROM stories s WHERE ${where.join(' AND ')} ORDER BY s.last_updated DESC, s.id DESC LIMIT ${limit}`, ...args);
  if (!stories.length) return [];
  const items: ItemRow[] = [];
  // D1 caps bound parameters per statement, so load items in chunks.
  for (let i = 0; i < stories.length; i += 90) {
    const chunk = stories.slice(i, i + 90).map((s) => s.id);
    items.push(
      ...(await db.all<ItemRow>(
        `SELECT * FROM items WHERE status = 'live' AND story_id IN (${chunk.map(() => '?').join(',')}) ORDER BY seen_at, id`,
        ...chunk,
      )),
    );
  }
  const byStory = new Map<number, ItemRow[]>();
  for (const it of items) {
    const list = byStory.get(it.story_id!) ?? [];
    list.push(it);
    byStory.set(it.story_id!, list);
  }
  const out: StoryView[] = [];
  for (const story of stories) {
    const list = byStory.get(story.id) ?? [];
    const headline = list.find((i) => i.id === story.headline_item_id) ?? list[0];
    if (headline) out.push({ story, headline, items: list });
  }
  return out;
}

export function storyJson(v: StoryView, siteUrl: string) {
  const item = (i: ItemRow) => ({
    id: i.id,
    title: i.title,
    url: i.url,
    tag: i.tag,
    kind: i.kind,
    section: i.section,
    source: i.source_id,
    author: i.author,
    eip: i.eip,
    version: i.version,
    forkcast_url: i.forkcast_url,
    summary: i.summary,
    published_at: new Date(i.published_at * 1000).toISOString(),
    seen_at: new Date(i.seen_at * 1000).toISOString(),
    extra: JSON.parse(i.extra),
  });
  return {
    id: v.story.id,
    permalink: `${siteUrl}/story/${v.story.id}`,
    group: v.story.group_key,
    section: v.story.section,
    first_seen: new Date(v.story.first_seen * 1000).toISOString(),
    last_updated: new Date(v.story.last_updated * 1000).toISOString(),
    headline: item(v.headline),
    items: v.items.map(item),
  };
}
