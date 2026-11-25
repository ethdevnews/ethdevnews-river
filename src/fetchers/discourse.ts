import { MAGICIANS_CATEGORIES, RESEARCH_AUTHORS } from '../config/rules';
import type { DiscourseSource } from '../config/sources';
import { decodeEntities } from '../lib/html';
import { getJson } from '../lib/http';
import { callKeyFromTitle, eipNumbersFromText, upgradeFromText } from '../lib/keys';
import { parseDate } from '../lib/time';
import type { Candidate, FetchContext } from '../types';

interface Topic {
  id: number;
  title: string;
  fancy_title?: string;
  slug: string;
  created_at: string;
  category_id: number;
  pinned?: boolean;
  closed?: boolean;
  archetype?: string;
  posters?: { user_id: number; description: string }[];
}

interface Latest {
  users?: { id: number; username: string }[];
  topic_list: { topics: Topic[] };
}

interface Category {
  id: number;
  slug: string;
  parent_category_id?: number;
}

async function categories(source: DiscourseSource, ctx: FetchContext): Promise<Map<number, string>> {
  const key = `discourse:cats:${source.id}`;
  const cached = await ctx.kvGet(key);
  let cats: Category[];
  const parsed = cached ? (JSON.parse(cached) as { at: number; cats: Category[] }) : null;
  if (parsed && ctx.now - parsed.at < 86400) cats = parsed.cats;
  else {
    const site = await getJson<{ categories: Category[] }>(`${source.base}/site.json`);
    cats = site.categories.map((c) => ({ id: c.id, slug: c.slug, parent_category_id: c.parent_category_id }));
    await ctx.kvSet(key, JSON.stringify({ at: ctx.now, cats }));
  }
  const byId = new Map(cats.map((c) => [c.id, c]));
  const out = new Map<number, string>();
  for (const c of cats) {
    const parent = c.parent_category_id ? byId.get(c.parent_category_id) : undefined;
    // "eips/eips-core" style path so rules can match either level
    out.set(c.id, parent ? `${parent.slug}/${c.slug}` : c.slug);
  }
  return out;
}

const NAMING = /\b(upgrade|fork|hard ?fork)\s+nam(e|es|ing)\b|\bnaming\b.*\b(upgrade|fork)\b/i;

export interface TopicDecision {
  include: boolean;
  section?: string;
  hold?: string | null;
  kind?: 'discussion' | 'post';
}

/** Ethereum Magicians: EIP/ERC discussion topics, core devs call threads and upgrade naming. */
export function magiciansRule(title: string, categoryPath: string): TopicDecision {
  const parts = categoryPath.split('/');
  const cat = [...parts].reverse().map((p) => MAGICIANS_CATEGORIES[p]).find(Boolean);
  if (callKeyFromTitle(title)) return { include: true, section: 'acd', kind: 'discussion' };
  if (cat) return { include: true, section: cat.section, kind: 'discussion' };
  const eips = eipNumbersFromText(title);
  if (eips.length) return { include: true, section: eips[0].kind === 'rip' ? 'l2' : /\bERC/i.test(title) ? 'developers' : 'l1', kind: 'discussion' };
  if (NAMING.test(title) || upgradeFromText(title)) return { include: true, section: 'l1', kind: 'discussion' };
  return { include: false };
}

/** ethresear.ch: allowlisted authors go live, others are held until something primary links to them. */
export function ethresearchRule(author: string | null): TopicDecision {
  const ok = !!author && RESEARCH_AUTHORS.some((a) => a.toLowerCase() === author.toLowerCase());
  return { include: true, section: 'research', kind: 'post', hold: ok ? null : 'author not on the ethresear.ch allowlist' };
}

export async function fetchDiscourse(source: DiscourseSource, ctx: FetchContext): Promise<Candidate[]> {
  const cats = await categories(source, ctx);
  const latest = await getJson<Latest>(`${source.base}/latest.json?order=created&ascending=false`);
  const users = new Map((latest.users ?? []).map((u) => [u.id, u.username]));
  const out: Candidate[] = [];
  for (const t of latest.topic_list.topics) {
    if (t.pinned || (t.archetype && t.archetype !== 'regular')) continue;
    const title = decodeEntities(t.title);
    const op = t.posters?.find((p) => /original poster/i.test(p.description)) ?? t.posters?.[0];
    const author = op ? (users.get(op.user_id) ?? null) : null;
    const catPath = cats.get(t.category_id) ?? '';
    const d = source.rules === 'magicians' ? magiciansRule(title, catPath) : ethresearchRule(author);
    if (!d.include) continue;
    out.push({
      url: `${source.base}/t/${t.slug}/${t.id}`,
      title,
      kind: d.kind ?? 'discussion',
      section: d.section ?? source.section,
      tag: source.tag,
      author,
      publishedAt: parseDate(t.created_at),
      hold: d.hold ?? null,
      extra: { category: catPath },
    });
  }
  return out;
}
