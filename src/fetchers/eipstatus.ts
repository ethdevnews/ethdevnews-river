import type { EipStatusSource } from '../config/sources';
import { parseFeed } from '../lib/feed';
import { getText } from '../lib/http';
import type { Candidate, FetchContext } from '../types';
import { forkcastEip } from './forkcast';

// Status changes for existing EIPs/ERCs, from the repository's commit feed. The EIP bot's
// commits read like "Update EIP-7702: Move to Final (#9500)".

const STATUS = /\bMove to (Review|Last Call|Final|Living|Withdrawn)\b/i;

export function parseStatusCommit(title: string, prefix: 'EIP' | 'ERC'): { n: number; status: string; title: string } | null {
  const m = title.match(new RegExp(`\\b${prefix}[-\\s]?(\\d+)\\b`, 'i'));
  const s = title.match(STATUS);
  if (!m || !s) return null;
  return { n: parseInt(m[1], 10), status: s[1].replace(/\b\w/g, (c) => c.toUpperCase()), title: title.replace(/\s*\(#\d+\)\s*$/, '').trim() };
}

export async function fetchEipStatus(source: EipStatusSource, ctx: FetchContext): Promise<Candidate[]> {
  const xml = await getText(`https://github.com/${source.repo}/commits/${source.branch}.atom`);
  const out: Candidate[] = [];
  for (const e of parseFeed(xml, 'https://github.com')) {
    const firstLine = e.title.split('\n')[0];
    const p = parseStatusCommit(firstLine, source.prefix);
    if (!p) continue;
    const uid = `eipstatus:${source.prefix}:${p.n}:${p.status.toLowerCase()}`;
    if (await ctx.hasUid(uid)) continue;
    const forkcast = source.prefix === 'EIP' ? await forkcastEip(p.n, ctx).catch(() => null) : null;
    out.push({
      uid,
      url: e.url,
      title: p.title,
      kind: 'status',
      section: source.section,
      tag: source.tag,
      publishedAt: e.published,
      eip: p.n,
      forkcastUrl: forkcast?.url ?? null,
      extra: { status: p.status },
    });
  }
  return out;
}
