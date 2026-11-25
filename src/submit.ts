import { adjustBotScore } from './bots';
import { REJECT_TITLE } from './config/rules';
import { SECTION_IDS } from './config/sections';
import type { Db } from './db';
import { clip, cleanText, extractLinks, extractPublishedTime, extractTitle } from './lib/html';
import { getHead, getJson } from './lib/http';
import { canonicalUrl, hostOf, isHttpUrl, xAccount } from './lib/url';
import { ingest, publish } from './ingest';
import { isNotPrimary, isTrusted, sourceFor, tagFor } from './trust';
import type { Candidate } from './types';

// POST /api/submit lets bots add individual items. The Worker fetches the page itself,
// keeps the page's own title and applies the same primary-source rules as everything else.

export interface Bot {
  id: number;
  name: string;
  standing: 'probation' | 'trusted' | 'blocked';
  score: number;
}

export interface SubmitBody {
  url?: string;
  section?: string;
  note?: string;
  evidence_url?: string;
}

export interface SubmitResult {
  status: 'live' | 'held' | 'rejected' | 'duplicate';
  reason?: string;
  item_id?: number;
  story_id?: number | null;
  url?: string;
  title?: string;
}

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function botFromRequest(db: Db, req: Request): Promise<Bot | null> {
  const auth = req.headers.get('authorization') ?? '';
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) return null;
  return db.first<Bot>('SELECT id, name, standing, score FROM bots WHERE token_hash = ?', await sha256Hex(m[1]));
}

interface PageInfo {
  url: string;
  title: string;
  links: string[];
  publishedAt: number | null;
  author: string | null;
}

/** Fetch a page's own title. X posts go through the public oEmbed endpoint (no key needed). */
export async function fetchPage(url: string): Promise<PageInfo> {
  const x = xAccount(url);
  if (x) {
    const o = await getJson<{ html: string; author_name: string }>(
      `https://publish.twitter.com/oembed?omit_script=1&dnt=1&url=${encodeURIComponent(canonicalUrl(url))}`,
    );
    const p = o.html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text = cleanText((p?.[1] ?? '').replace(/<br\s*\/?>/gi, ' '));
    if (!text) throw new Error('empty post');
    return { url, title: clip(`${o.author_name}: ${text}`, 240), links: extractLinks(p?.[1] ?? ''), publishedAt: null, author: x };
  }
  const { html, finalUrl } = await getHead(url);
  const title = extractTitle(html);
  if (!title) throw new Error('no title on page');
  // Follow redirects only within the same site, so a redirect can't launder a non-primary URL.
  const keep = hostOf(finalUrl) === hostOf(url) ? finalUrl : url;
  return { url: keep, title, links: [], publishedAt: extractPublishedTime(html), author: null };
}

async function record(db: Db, bot: Bot, url: string, r: SubmitResult, note: string | undefined, now: number): Promise<SubmitResult> {
  await db.run(
    'INSERT INTO submissions (bot_id, url, item_id, outcome, reason, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    bot.id,
    url,
    r.item_id ?? null,
    r.status,
    r.reason ?? null,
    note?.slice(0, 500) ?? null,
    now,
  );
  return r;
}

export async function submit(db: Db, bot: Bot, body: SubmitBody, now: number, fetcher = fetchPage): Promise<SubmitResult> {
  const raw = (body.url ?? '').trim();
  if (!isHttpUrl(raw)) return record(db, bot, raw, { status: 'rejected', reason: 'url must be http(s)' }, body.note, now);

  // A news story about something: use the primary source behind it, if the bot named one.
  let target = raw;
  if (isNotPrimary(raw)) {
    const ev = (body.evidence_url ?? '').trim();
    if (isHttpUrl(ev) && !isNotPrimary(ev)) target = ev;
    else {
      await adjustBotScore(db, bot.id, -1);
      return record(db, bot, raw, { status: 'rejected', reason: 'not a primary source (news outlet or aggregator)' }, body.note, now);
    }
  }

  const canonical = canonicalUrl(target);
  const existing = await db.itemByCanonical(canonical);
  if (existing) {
    if (existing.status === 'held') {
      const others = await db.first<{ n: number }>(
        'SELECT COUNT(DISTINCT bot_id) AS n FROM submissions WHERE item_id = ? AND bot_id != ?',
        existing.id,
        bot.id,
      );
      if ((others?.n ?? 0) > 0) {
        await publish(db, existing.id, now, 'submitted by a second bot');
        await adjustBotScore(db, bot.id, 1);
        const it = await db.item(existing.id);
        return record(db, bot, target, { status: 'live', reason: 'corroborated by a second bot', item_id: existing.id, story_id: it?.story_id, url: existing.url, title: existing.title }, body.note, now);
      }
    }
    return record(db, bot, target, { status: 'duplicate', reason: `already ${existing.status}`, item_id: existing.id, story_id: existing.story_id, url: existing.url, title: existing.title }, body.note, now);
  }

  let page: PageInfo;
  try {
    page = await fetcher(target);
  } catch (e) {
    return record(db, bot, target, { status: 'rejected', reason: `could not fetch the page (${e instanceof Error ? e.message : e})` }, body.note, now);
  }
  if (REJECT_TITLE.test(page.title)) {
    await adjustBotScore(db, bot.id, -1);
    return record(db, bot, target, { status: 'rejected', reason: 'off-topic (token sale, airdrop or price news)' }, body.note, now);
  }

  const trusted = isTrusted(page.url);
  const live = trusted || bot.standing === 'trusted';
  const src = sourceFor(page.url);
  const section = body.section && SECTION_IDS.has(body.section) ? body.section : (src?.section ?? 'general');
  const candidate: Candidate = {
    url: page.url,
    title: page.title,
    kind: 'submission',
    section,
    tag: tagFor(page.url),
    author: page.author,
    publishedAt: page.publishedAt ?? now,
    project: src?.project ?? null,
    links: page.links,
    hold: live ? null : 'primary but not on a trusted domain or account yet',
    extra: { bot: bot.name, note: body.note?.slice(0, 500) ?? null },
  };
  const r = await ingest(db, [candidate], { sourceId: `bot:${bot.name}`, now, submittedBy: bot.id, ignoreAge: true });
  const id = r.ids[0];
  if (!id) return record(db, bot, target, { status: 'duplicate', reason: 'already in the river' }, body.note, now);
  const it = await db.item(id);
  if (it?.status === 'live') await adjustBotScore(db, bot.id, 1);
  return record(
    db,
    bot,
    target,
    { status: it?.status === 'live' ? 'live' : 'held', reason: it?.status_reason ?? undefined, item_id: id, story_id: it?.story_id, url: page.url, title: page.title },
    body.note,
    now,
  );
}
