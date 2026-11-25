import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { Db } from '../src/db';
import { fetchReleases } from '../src/fetchers/releases';
import { fetchRss } from '../src/fetchers/rss';
import { ingest } from '../src/ingest';
import { loadStories } from '../src/queries';
import { maintenance, makeContext } from '../src/runner';
import { SOURCES, type GithubReleasesSource, type RssSource } from '../src/config/sources';
import { submit, type Bot } from '../src/submit';
import worker from '../src/index';
import type { Env } from '../src/types';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const NOW = Math.floor(Date.parse('2026-11-21T00:00:00Z') / 1000);

let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;
let db: Db;

async function resetDb() {
  for (const t of ['item_links', 'items', 'stories', 'source_state', 'bots', 'submissions', 'kv']) await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run();
  const sql = readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  for (const stmt of sql.split(';').map((s) => s.trim()).filter(Boolean)) await env.DB.prepare(stmt).run();
}

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ persist: false });
  env = { ...proxy.env, SITE_URL: 'https://feed.example', SITE_NAME: 'ethdevnews river', TIME_ZONE: 'Australia/Melbourne', ADMIN_TOKEN: 'admin-secret' };
  db = new Db(env.DB);
});
afterAll(async () => proxy?.dispose());
beforeEach(async () => {
  await resetDb();
  vi.unstubAllGlobals();
});

function stubFetch(map: Record<string, string>) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url in map) return new Response(map[url], { status: 200 });
    return new Response('nope', { status: 404 });
  });
}

const geth = SOURCES.find((s) => s.id === 'rel-geth') as GithubReleasesSource;
const efBlog = SOURCES.find((s) => s.id === 'ef-blog') as RssSource;

async function addBot(name: string, standing = 'probation'): Promise<Bot> {
  await db.run('INSERT INTO bots (name, token_hash, standing, score, created_at) VALUES (?, ?, ?, 0, ?)', name, `hash-${name}`, standing, NOW);
  return (await db.first<Bot>('SELECT id, name, standing, score FROM bots WHERE name = ?', name))!;
}

describe('grouping', () => {
  it('groups a release with the blog post that links to it, and skips pre-releases and old posts', async () => {
    stubFetch({
      'https://github.com/ethereum/go-ethereum/releases.atom': fixture('releases.atom'),
      [efBlog.url]: fixture('blog.rss'),
    });
    const ctx = makeContext(env, db, NOW);
    await ingest(db, await fetchReleases(geth, ctx), { sourceId: geth.id, now: NOW });
    await ingest(db, await fetchRss(efBlog, ctx), { sourceId: efBlog.id, now: NOW + 60 });
    const stories = await loadStories(db);
    expect(stories).toHaveLength(1);
    expect(stories[0].headline.title).toBe('Geth v1.17.2: Bubbletea');
    expect(stories[0].headline.tag).toBe('GitHub');
    expect(stories[0].items.map((i) => i.tag)).toEqual(['GitHub', 'EF blog']);
  });

  it('puts decisions and the Magicians thread under their core devs call', async () => {
    const base = { section: 'acd', tag: 'Forkcast' } as const;
    await ingest(
      db,
      [
        { ...base, uid: 'forkcast:call:acde/2026-11-19_249', url: 'https://forkcast.org/calls/acde/249/', title: 'All Core Devs - Execution (ACDE) #249', kind: 'call', callKey: 'call:acde:249', publishedAt: NOW - 3600 },
        { ...base, uid: 'd1', url: 'https://forkcast.org/calls/acde/249/', title: 'CFI for Hegota: EIP-5920 (PAY opcode)', kind: 'decision', callKey: 'call:acde:249', eip: 5920, forkcastUrl: 'https://forkcast.org/eips/5920', extra: { stageShort: 'CFI' } },
        { ...base, uid: 'd2', url: 'https://forkcast.org/calls/acde/249/', title: 'DFI for Hegota: EIP-7666', kind: 'decision', callKey: 'call:acde:249', eip: 7666, extra: { stageShort: 'DFI' } },
      ],
      { sourceId: 'forkcast-calls', now: NOW },
    );
    await ingest(
      db,
      [{ url: 'https://ethereum-magicians.org/t/all-core-devs-execution-acde-249-november-19-2026/26000', title: 'All Core Devs - Execution (ACDE) #249, November 19, 2026', kind: 'discussion', section: 'acd', tag: 'Eth Magicians' }],
      { sourceId: 'magicians', now: NOW + 100 },
    );
    const stories = await loadStories(db);
    expect(stories).toHaveLength(1);
    expect(stories[0].story.group_key).toBe('call:acde:249');
    expect(stories[0].headline.kind).toBe('call');
    expect(stories[0].items).toHaveLength(4);
  });

  it('collects an EIP, its discussion and its status change into one story with a Forkcast link', async () => {
    await ingest(
      db,
      [{ uid: 'eipsheet:EIP:8483', url: 'https://forkcast.org/eips/8483', title: 'EIP-8483: Post-Quantum Material Registration', kind: 'eip', section: 'l1', tag: 'Forkcast', eip: 8483, forkcastUrl: 'https://forkcast.org/eips/8483' }],
      { sourceId: 'eip-sheet', now: NOW },
    );
    await ingest(
      db,
      [
        { url: 'https://ethereum-magicians.org/t/eip-8483-pq-registration/26001', title: 'EIP-8483: Post-quantum material registration', kind: 'discussion', section: 'l1', tag: 'Eth Magicians' },
        { uid: 'eipstatus:EIP:8483:review', url: 'https://github.com/ethereum/EIPs/commit/abc', title: 'Update EIP-8483: Move to Review', kind: 'status', section: 'l1', tag: 'EIPs', eip: 8483 },
      ],
      { sourceId: 'mixed', now: NOW + 100 },
    );
    const [s] = await loadStories(db);
    expect(s.story.group_key).toBe('eip:8483');
    expect(s.items).toHaveLength(3);
    expect(s.headline.kind).toBe('eip');
  });

  it('holds an ethresear.ch post from an unlisted author until something primary links to it', async () => {
    const post = 'https://ethresear.ch/t/a-new-idea/30000';
    await ingest(db, [{ url: post, title: 'A new idea', kind: 'post', section: 'research', tag: 'ethresear.ch', author: 'someone', hold: 'author not on the ethresear.ch allowlist' }], { sourceId: 'ethresearch', now: NOW });
    expect(await loadStories(db)).toHaveLength(0);
    await ingest(
      db,
      [{ url: 'https://ethereum-magicians.org/t/eip-9001-thing/26002', title: 'EIP-9001: Thing', kind: 'discussion', section: 'l1', tag: 'Eth Magicians', links: [`${post}/3`] }],
      { sourceId: 'magicians', now: NOW + 60 },
    );
    const stories = await loadStories(db);
    expect(stories).toHaveLength(1);
    expect(stories[0].items.map((i) => i.title).sort()).toEqual(['A new idea', 'EIP-9001: Thing']);
  });

  it('expires held items after the hold window', async () => {
    await ingest(db, [{ url: 'https://ethresear.ch/t/x/1', title: 'X', kind: 'post', section: 'research', tag: 'ethresear.ch', hold: 'author' }], { sourceId: 'ethresearch', now: NOW });
    await maintenance(db, NOW + 73 * 3600);
    expect((await db.first<{ status: string }>('SELECT status FROM items'))?.status).toBe('expired');
  });
});

describe('bot submissions', () => {
  const page = (title: string) => async (url: string) => ({ url, title, links: [], publishedAt: null, author: null });

  it('publishes trusted URLs straight away and rejects news outlets', async () => {
    const bot = await addBot('grok');
    const ok = await submit(db, bot, { url: 'https://github.com/sigp/lighthouse/releases/tag/v8.1.0' }, NOW, page('Release v8.1.0 · sigp/lighthouse'));
    expect(ok.status).toBe('live');
    const bad = await submit(db, bot, { url: 'https://www.coindesk.com/tech/2026/11/20/story' }, NOW, page('News'));
    expect(bad.status).toBe('rejected');
    const swapped = await submit(
      db,
      bot,
      { url: 'https://www.theblock.co/post/1', evidence_url: 'https://blog.ethereum.org/2026/11/20/hoodi' },
      NOW,
      page('Hoodi upgrade announcement'),
    );
    expect(swapped).toMatchObject({ status: 'live', url: 'https://blog.ethereum.org/2026/11/20/hoodi' });
  });

  it('holds untrusted primary URLs until a second bot submits them', async () => {
    const a = await addBot('a');
    const b = await addBot('b');
    const url = 'https://blog.newproject.xyz/launch';
    expect((await submit(db, a, { url }, NOW, page('New project launches testnet'))).status).toBe('held');
    expect((await submit(db, a, { url }, NOW, page('New project launches testnet'))).status).toBe('duplicate');
    const second = await submit(db, b, { url }, NOW + 60, page('New project launches testnet'));
    expect(second.status).toBe('live');
    const [s] = await loadStories(db);
    expect(s.headline.tag).toBe('newproject.xyz');
    expect((await db.first<{ score: number }>('SELECT score FROM bots WHERE id = ?', a.id))?.score).toBe(1);
  });

  it('rejects token sales and airdrops', async () => {
    const bot = await addBot('c');
    const r = await submit(db, bot, { url: 'https://blog.ethereum.org/x' }, NOW, page('Huge airdrop for everyone'));
    expect(r.status).toBe('rejected');
  });
});

describe('http', () => {
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://feed.example${path}`, init), env);

  it('renders the river, sections, feeds, sources and about pages', async () => {
    stubFetch({ 'https://github.com/ethereum/go-ethereum/releases.atom': fixture('releases.atom') });
    await ingest(db, await fetchReleases(geth, makeContext(env, db, NOW)), { sourceId: geth.id, now: Math.floor(Date.now() / 1000) });
    const home = await call('/');
    expect(home.status).toBe(200);
    expect(await home.text()).toContain('Geth v1.17.2: Bubbletea');
    expect((await call('/s/staking')).status).toBe(200);
    expect((await call('/s/nope')).status).toBe(404);
    const rss = await (await call('/feed.xml')).text();
    expect(rss).toContain('<rss version="2.0"');
    expect(rss).toContain('Geth v1.17.2: Bubbletea [GitHub]');
    const jf = (await (await call('/s/staking/feed.json')).json()) as { items: unknown[] };
    expect(jf.items).toHaveLength(1);
    const api = (await (await call('/api/stories.json')).json()) as { stories: { headline: { title: string } }[] };
    expect(api.stories[0].headline.title).toBe('Geth v1.17.2: Bubbletea');
    expect((await call('/story/1')).status).toBe(200);
    expect((await call('/week')).status).toBe(200);
    expect(await (await call('/sources')).text()).toContain('Forkcast');
    expect(await (await call('/about')).text()).toContain('vbuterin');
  });

  it('creates bots through the admin API and accepts their submissions', async () => {
    expect((await call('/api/admin/bots', { method: 'POST', body: '{}' })).status).toBe(401);
    const created = await call('/api/admin/bots', { method: 'POST', headers: { authorization: 'Bearer admin-secret' }, body: JSON.stringify({ name: 'grok-scanner' }) });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    expect((await call('/api/submit', { method: 'POST', body: '{"url":"https://x.com/a/status/1"}' })).status).toBe(401);
    // A news outlet is rejected before any fetch happens.
    const r = await call('/api/submit', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ url: 'https://cointelegraph.com/news/x' }) });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { reason: string }).reason).toMatch(/not a primary source/);
  });
});
