import type { ItemRow, StoryRow } from './types';

export class Db {
  constructor(private d1: D1Database) {}

  async kvGet(key: string): Promise<string | null> {
    const r = await this.d1.prepare('SELECT value FROM kv WHERE key = ?').bind(key).first<{ value: string }>();
    return r?.value ?? null;
  }

  async kvSet(key: string, value: string, now: number): Promise<void> {
    await this.d1
      .prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .bind(key, value, now)
      .run();
  }

  async itemByUid(uid: string): Promise<ItemRow | null> {
    return this.d1.prepare('SELECT * FROM items WHERE uid = ?').bind(uid).first<ItemRow>();
  }

  async itemByCanonical(url: string): Promise<ItemRow | null> {
    return this.d1.prepare("SELECT * FROM items WHERE canonical_url = ? ORDER BY status = 'live' DESC, id LIMIT 1").bind(url).first<ItemRow>();
  }

  async item(id: number): Promise<ItemRow | null> {
    return this.d1.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<ItemRow>();
  }

  async story(id: number): Promise<StoryRow | null> {
    return this.d1.prepare('SELECT * FROM stories WHERE id = ?').bind(id).first<StoryRow>();
  }

  async insertItem(row: Omit<ItemRow, 'id'>): Promise<number> {
    const r = await this.d1
      .prepare(
        `INSERT INTO items (uid, url, canonical_url, title, source_id, tag, section, kind, author, published_at, seen_at, status, status_reason,
          story_id, group_keys, links, eip, version, forkcast_url, summary, submitted_by, extra)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .bind(
        row.uid,
        row.url,
        row.canonical_url,
        row.title,
        row.source_id,
        row.tag,
        row.section,
        row.kind,
        row.author,
        row.published_at,
        row.seen_at,
        row.status,
        row.status_reason,
        row.story_id,
        row.group_keys,
        row.links,
        row.eip,
        row.version,
        row.forkcast_url,
        row.summary,
        row.submitted_by,
        row.extra,
      )
      .first<{ id: number }>();
    return r!.id;
  }

  async setItemStatus(id: number, status: string, reason: string | null): Promise<void> {
    await this.d1.prepare('UPDATE items SET status = ?, status_reason = ? WHERE id = ?').bind(status, reason, id).run();
  }

  async openStory(key: string, since: number): Promise<StoryRow | null> {
    return this.d1
      .prepare('SELECT * FROM stories WHERE group_key = ? AND last_updated >= ? ORDER BY last_updated DESC LIMIT 1')
      .bind(key, since)
      .first<StoryRow>();
  }

  /** A live item at one of these canonical URLs, seen since `since`. */
  async liveItemAtAny(urls: string[], since: number): Promise<ItemRow | null> {
    if (!urls.length) return null;
    const list = urls.slice(0, 50);
    return this.d1
      .prepare(`SELECT * FROM items WHERE status = 'live' AND story_id IS NOT NULL AND seen_at >= ? AND canonical_url IN (${list.map(() => '?').join(',')}) ORDER BY seen_at LIMIT 1`)
      .bind(since, ...list)
      .first<ItemRow>();
  }

  /** A live item that links to this URL. */
  async liveItemLinkingTo(url: string, since: number, excludeId: number): Promise<ItemRow | null> {
    return this.d1
      .prepare(
        `SELECT i.* FROM item_links l JOIN items i ON i.id = l.item_id
         WHERE l.url = ? AND i.status = 'live' AND i.story_id IS NOT NULL AND i.seen_at >= ? AND i.id != ? ORDER BY i.seen_at LIMIT 1`,
      )
      .bind(url, since, excludeId)
      .first<ItemRow>();
  }

  async insertLinks(itemId: number, links: string[]): Promise<void> {
    if (!links.length) return;
    await this.d1.batch(links.slice(0, 50).map((l) => this.d1.prepare('INSERT OR IGNORE INTO item_links (item_id, url) VALUES (?, ?)').bind(itemId, l)));
  }

  async heldItemsAt(urls: string[]): Promise<ItemRow[]> {
    if (!urls.length) return [];
    const list = urls.slice(0, 50);
    const r = await this.d1
      .prepare(`SELECT * FROM items WHERE status = 'held' AND canonical_url IN (${list.map(() => '?').join(',')})`)
      .bind(...list)
      .all<ItemRow>();
    return r.results;
  }

  async createStory(key: string, section: string, now: number): Promise<number> {
    const r = await this.d1
      .prepare('INSERT INTO stories (group_key, section, first_seen, last_updated, item_count) VALUES (?, ?, ?, ?, 0) RETURNING id')
      .bind(key, section, now, now)
      .first<{ id: number }>();
    return r!.id;
  }

  async storyItems(storyId: number): Promise<ItemRow[]> {
    const r = await this.d1.prepare("SELECT * FROM items WHERE story_id = ? AND status = 'live' ORDER BY seen_at, id").bind(storyId).all<ItemRow>();
    return r.results;
  }

  run(sql: string, ...args: unknown[]) {
    return this.d1.prepare(sql).bind(...args).run();
  }

  all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
    return this.d1
      .prepare(sql)
      .bind(...args)
      .all<T>()
      .then((r) => r.results);
  }

  first<T>(sql: string, ...args: unknown[]): Promise<T | null> {
    return this.d1.prepare(sql).bind(...args).first<T>();
  }
}
