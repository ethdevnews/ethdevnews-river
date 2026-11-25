import { adjustBotScore } from './bots';
import { MAX_AGE_DAYS, REJECT_TITLE, STORY_WINDOW_DAYS } from './config/rules';
import { SECTION_IDS } from './config/sections';
import type { Db } from './db';
import { clip } from './lib/html';
import { groupKeys, keyType } from './lib/keys';
import { canonicalUrl } from './lib/url';
import type { Candidate, ItemKind, ItemRow } from './types';

// Which item heads a story: lower ranks first, then the earliest.
export const KIND_RANK: Record<ItemKind, number> = {
  call: 0,
  eip: 1,
  release: 2,
  post: 3,
  submission: 3,
  status: 4,
  discussion: 5,
  decision: 6,
};

export interface IngestResult {
  added: number;
  held: number;
  skipped: number;
  ids: number[];
}

export interface IngestOptions {
  sourceId: string;
  now: number;
  submittedBy?: number | null;
  /** Bots submit items as they find them; don't apply the age filter to them. */
  ignoreAge?: boolean;
}

export async function ingest(db: Db, candidates: Candidate[], opts: IngestOptions): Promise<IngestResult> {
  const res: IngestResult = { added: 0, held: 0, skipped: 0, ids: [] };
  const minPublished = opts.now - MAX_AGE_DAYS * 86400;
  for (const c of candidates) {
    const canonical = canonicalUrl(c.url);
    const uid = c.uid ?? canonical;
    if (!c.title?.trim() || REJECT_TITLE.test(c.title)) {
      res.skipped++;
      continue;
    }
    const published = c.publishedAt ?? opts.now;
    if (!opts.ignoreAge && published < minPublished) {
      res.skipped++;
      continue;
    }
    if (await db.itemByUid(uid)) {
      res.skipped++;
      continue;
    }
    // The same page from a second source: keep the first.
    if (!c.uid && (await db.itemByCanonical(canonical))) {
      res.skipped++;
      continue;
    }
    const keys = groupKeys({ title: c.title, callKey: c.callKey, eip: c.eip, project: c.project, version: c.version });
    const links = [...new Set((c.links ?? []).map(canonicalUrl).filter((l) => l !== canonical))];
    const row: Omit<ItemRow, 'id'> = {
      uid,
      url: c.url,
      canonical_url: canonical,
      title: clip(c.title.trim(), 300),
      source_id: opts.sourceId,
      tag: c.tag,
      section: SECTION_IDS.has(c.section) ? c.section : 'general',
      kind: c.kind,
      author: c.author ?? null,
      published_at: Math.min(published, opts.now),
      seen_at: opts.now,
      status: c.hold ? 'held' : 'live',
      status_reason: c.hold ?? null,
      story_id: null,
      group_keys: JSON.stringify(keys),
      links: JSON.stringify(links),
      eip: c.eip ?? null,
      version: c.version ?? null,
      forkcast_url: c.forkcastUrl ?? null,
      summary: null,
      submitted_by: opts.submittedBy ?? null,
      extra: JSON.stringify(c.extra ?? {}),
    };
    const id = await db.insertItem(row);
    await db.insertLinks(id, links);
    res.ids.push(id);
    if (row.status === 'live') {
      res.added++;
      await publish(db, id, opts.now);
    } else res.held++;
  }
  return res;
}

/** Put a live item into a story, then release any held items it links to. */
export async function publish(db: Db, itemId: number, now: number, reason?: string): Promise<void> {
  const item = await db.item(itemId);
  if (!item) return;
  if (item.status !== 'live') {
    // It enters the river now, so it's dated from now.
    await db.run("UPDATE items SET status = 'live', status_reason = ?, seen_at = ? WHERE id = ?", reason ?? null, now, itemId);
    item.status = 'live';
    item.seen_at = now;
    // Bots whose held submission turned out good gain standing.
    const bots = await db.all<{ bot_id: number }>('SELECT DISTINCT bot_id FROM submissions WHERE item_id = ?', itemId);
    for (const b of bots) await adjustBotScore(db, b.bot_id, 1);
  }
  if (!item.story_id) await assignStory(db, item, now);
  const links: string[] = JSON.parse(item.links);
  for (const held of await db.heldItemsAt(links)) {
    await publish(db, held.id, now, `linked from item ${item.id}`);
  }
}

async function assignStory(db: Db, item: ItemRow, now: number): Promise<void> {
  const keys: string[] = JSON.parse(item.group_keys);
  let storyId: number | null = null;
  for (const key of keys) {
    const days = STORY_WINDOW_DAYS[keyType(key)] ?? 7;
    const s = await db.openStory(key, now - days * 86400);
    if (s) {
      storyId = s.id;
      break;
    }
  }
  if (!storyId) {
    // Shared links: this item links to a live item, or a live item links to this one.
    const since = now - STORY_WINDOW_DAYS.link * 86400;
    const target = (await db.liveItemAtAny(JSON.parse(item.links), since)) ?? (await db.liveItemLinkingTo(item.canonical_url, since, item.id));
    if (target?.story_id) storyId = target.story_id;
  }
  if (!storyId) storyId = await db.createStory(keys[0] ?? `item:${item.id}`, item.section, now);
  await db.run('UPDATE items SET story_id = ? WHERE id = ?', storyId, item.id);
  await refreshStory(db, storyId, now);
}

export async function refreshStory(db: Db, storyId: number, _now: number): Promise<void> {
  const items = await db.storyItems(storyId);
  if (!items.length) {
    await db.run('UPDATE stories SET item_count = 0, headline_item_id = NULL WHERE id = ?', storyId);
    return;
  }
  const head = [...items].sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.seen_at - b.seen_at || a.id - b.id)[0];
  // A story is dated by its items' own publication times, so a first run doesn't stamp
  // everything "now". Decisions are dated from when they appeared, so they bump their call.
  const when = (i: ItemRow) =>
    i.kind === 'decision' && JSON.parse(i.extra).bump !== false ? i.seen_at : Math.min(i.published_at, i.seen_at);
  const first = Math.min(...items.map(when));
  const last = Math.max(...items.map(when));
  await db.run(
    'UPDATE stories SET headline_item_id = ?, section = ?, item_count = ?, first_seen = ?, last_updated = ? WHERE id = ?',
    head.id,
    head.section,
    items.length,
    first,
    last,
    storyId,
  );
}
