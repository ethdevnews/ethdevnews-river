import { SECTION_IDS, SECTIONS, sectionName } from './config/sections';
import { SOURCES } from './config/sources';
import { Db } from './db';
import { publish, refreshStory } from './ingest';
import { nowSec } from './lib/time';
import { loadStories, storyJson } from './queries';
import { jsonFeed, rssFeed } from './render/feeds';
import type { PageOpts } from './render/layout';
import { aboutPage, riverPage, sourcesPage, storyPage, weekPage, type SourceStateRow } from './render/pages';
import { tick } from './runner';
import { botFromRequest, sha256Hex, submit, type SubmitBody } from './submit';
import type { Env, ItemRow } from './types';

const html = (body: string, status = 200, maxAge = 60) =>
  new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': `public, max-age=${maxAge}` } });
const json = (data: unknown, status = 200, maxAge = 0) =>
  new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
const xml = (body: string) => new Response(body, { headers: { 'content-type': 'application/rss+xml; charset=utf-8', 'cache-control': 'public, max-age=300' } });

function pageOpts(env: Env, path: string, title?: string, feedPath?: string): PageOpts {
  return { title: title ? `${title} · ${env.SITE_NAME}` : env.SITE_NAME, siteName: env.SITE_NAME, siteUrl: env.SITE_URL, path, feedPath };
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function isAdmin(req: Request, env: Env): boolean {
  const m = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
  return !!env.ADMIN_TOKEN && !!m && timingSafeEqual(m[1], env.ADMIN_TOKEN);
}

function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function readJson<T>(req: Request): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

async function handleAdmin(req: Request, env: Env, db: Db, path: string): Promise<Response> {
  if (!isAdmin(req, env)) return json({ error: 'unauthorized' }, 401);
  const now = nowSec();
  if (path === '/api/admin/run' && req.method === 'POST') {
    const body = (await readJson<{ source?: string; all?: boolean }>(req)) ?? {};
    return json({ results: await tick(env, now, { only: body.source, all: body.all }) });
  }
  if (path === '/api/admin/bots' && req.method === 'GET') {
    return json(await db.all('SELECT id, name, standing, score, created_at FROM bots ORDER BY id'));
  }
  if (path === '/api/admin/bots' && req.method === 'POST') {
    const body = await readJson<{ name?: string; standing?: string }>(req);
    const name = (body?.name ?? '').trim();
    if (!/^[\w.-]{2,40}$/.test(name)) return json({ error: 'name: 2-40 letters, digits, . _ -' }, 400);
    const token = randomToken();
    const standing = body?.standing === 'trusted' ? 'trusted' : 'probation';
    await db.run('INSERT INTO bots (name, token_hash, standing, score, created_at) VALUES (?, ?, ?, 0, ?)', name, await sha256Hex(token), standing, now);
    return json({ name, standing, token, note: 'Store this token now. It is not shown again.' }, 201);
  }
  let m = path.match(/^\/api\/admin\/bots\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const body = await readJson<{ standing?: string; score?: number }>(req);
    if (body?.standing && !['probation', 'trusted', 'blocked'].includes(body.standing)) return json({ error: 'bad standing' }, 400);
    if (body?.standing) await db.run('UPDATE bots SET standing = ? WHERE id = ?', body.standing, +m[1]);
    if (typeof body?.score === 'number') await db.run('UPDATE bots SET score = ? WHERE id = ?', Math.trunc(body.score), +m[1]);
    return json(await db.first('SELECT id, name, standing, score FROM bots WHERE id = ?', +m[1]));
  }
  m = path.match(/^\/api\/admin\/items\/(\d+)$/);
  if (m && req.method === 'PATCH') {
    const body = await readJson<{ status?: string; reason?: string }>(req);
    const item = await db.item(+m[1]);
    if (!item) return json({ error: 'not found' }, 404);
    if (body?.status === 'live') await publish(db, item.id, now, body.reason ?? 'approved by admin');
    else if (body?.status === 'rejected') {
      await db.setItemStatus(item.id, 'rejected', body.reason ?? 'removed by admin');
      if (item.story_id) await refreshStory(db, item.story_id, now);
    } else return json({ error: 'status must be live or rejected' }, 400);
    return json(await db.item(item.id));
  }
  return json({ error: 'not found' }, 404);
}

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const db = new Db(env.DB);
  const now = nowSec();
  const tz = env.TIME_ZONE || 'Australia/Melbourne';

  if (path.startsWith('/api/admin/')) return handleAdmin(req, env, db, path);

  if (path === '/api/submit') {
    if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
    const bot = await botFromRequest(db, req);
    if (!bot) return json({ error: 'unauthorized: send Authorization: Bearer <bot token>' }, 401);
    if (bot.standing === 'blocked') return json({ error: 'this bot is blocked' }, 403);
    const recent = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM submissions WHERE bot_id = ? AND created_at > ?', bot.id, now - 86400);
    if ((recent?.n ?? 0) >= 500) return json({ error: 'rate limit: 500 submissions a day' }, 429);
    const body = await readJson<SubmitBody>(req);
    if (!body) return json({ error: 'body must be JSON: {"url": "...", "section"?: "...", "note"?: "...", "evidence_url"?: "..."}' }, 400);
    const r = await submit(db, bot, body, now);
    return json(r, r.status === 'rejected' ? 422 : 200);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json({ error: 'method not allowed' }, 405);

  if (path === '/api/stories.json') {
    const section = url.searchParams.get('section') ?? undefined;
    const sinceParam = url.searchParams.get('since');
    const since = sinceParam ? Math.floor(Date.parse(sinceParam) / 1000) : undefined;
    const limit = parseInt(url.searchParams.get('limit') ?? '100', 10);
    const stories = await loadStories(db, { section, since: Number.isFinite(since) ? since : undefined, limit });
    return json({ stories: stories.map((s) => storyJson(s, env.SITE_URL)) }, 200, 120);
  }
  if (path === '/api/sources.json') {
    const states = await db.all<SourceStateRow>('SELECT * FROM source_state');
    const byId = new Map(states.map((s) => [s.source_id, s]));
    return json(
      SOURCES.map((s) => ({ id: s.id, name: s.name, type: s.type, tag: s.tag, section: s.section, enabled: s.enabled !== false, state: byId.get(s.id) ?? null })),
      200,
      120,
    );
  }

  // Feeds: /feed.xml, /feed.json, /s/<section>/feed.xml
  const feedMatch = path.match(/^(?:\/s\/([\w-]+))?\/feed\.(xml|json)$/);
  if (feedMatch) {
    const section = feedMatch[1];
    if (section && !SECTION_IDS.has(section)) return html('Not found', 404);
    const stories = await loadStories(db, { section, limit: 50 });
    const o = {
      title: section ? `${env.SITE_NAME}: ${sectionName(section)}` : env.SITE_NAME,
      siteUrl: env.SITE_URL,
      selfPath: path,
      description: 'Ethereum developer news from primary sources, collected automatically.',
    };
    return feedMatch[2] === 'xml' ? xml(rssFeed(stories, o)) : json(jsonFeed(stories, o), 200, 300);
  }

  if (path === '/') {
    const before = parseInt(url.searchParams.get('before') ?? '', 10);
    const stories = await loadStories(db, { before: Number.isFinite(before) ? before : undefined, limit: 60 });
    const next = stories.length === 60 ? `/?before=${stories[stories.length - 1].story.last_updated}` : undefined;
    return html(riverPage(pageOpts(env, '/'), stories, now, tz, { nextHref: next }));
  }
  const sec = path.match(/^\/s\/([\w-]+)$/);
  if (sec) {
    if (!SECTION_IDS.has(sec[1])) return html('Not found', 404);
    const before = parseInt(url.searchParams.get('before') ?? '', 10);
    const stories = await loadStories(db, { section: sec[1], before: Number.isFinite(before) ? before : undefined, limit: 60 });
    const next = stories.length === 60 ? `${path}?before=${stories[stories.length - 1].story.last_updated}` : undefined;
    const name = sectionName(sec[1]);
    return html(riverPage(pageOpts(env, path, name, `${path}/feed.xml`), stories, now, tz, { heading: name, nextHref: next, showSection: false }));
  }
  const st = path.match(/^\/story\/(\d+)$/);
  if (st) {
    const [v] = await loadStories(db, { ids: [+st[1]], limit: 1 });
    if (!v) return html('Story not found', 404);
    return html(storyPage(pageOpts(env, path, v.headline.title), v, now));
  }
  if (path === '/week') {
    const stories = await loadStories(db, { since: now - 7 * 86400, limit: 500 });
    return html(weekPage(pageOpts(env, path, 'This week'), stories, now));
  }
  if (path === '/sources') {
    const states = await db.all<SourceStateRow>('SELECT * FROM source_state');
    const bots = await db.all<{ name: string; standing: string; score: number }>('SELECT name, standing, score FROM bots ORDER BY score DESC');
    const held = await db.all<ItemRow>("SELECT * FROM items WHERE status = 'held' ORDER BY seen_at DESC LIMIT 200");
    return html(sourcesPage(pageOpts(env, path, 'Sources'), states, bots, held, now), 200, 30);
  }
  if (path === '/about') return html(aboutPage(pageOpts(env, path, 'About')), 200, 3600);
  if (path === '/sections') return json(SECTIONS, 200, 3600);
  return html('Not found', 404);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      console.error(e);
      return json({ error: 'internal error' }, 500);
    }
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      tick(env, nowSec()).then((r) => {
        const bad = r.filter((x) => !x.ok);
        console.log(`tick: ${r.length} sources, ${bad.length} failed`, JSON.stringify(r));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
