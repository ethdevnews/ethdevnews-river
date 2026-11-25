import type { EipSheetSource } from '../config/sources';
import { parseCsv } from '../lib/csv';
import { extractTitle } from '../lib/html';
import { getHead, getJson, getText } from '../lib/http';
import type { Candidate, FetchContext } from '../types';
import { forkcastEip } from './forkcast';

// The EIP/ERC numbering sheet is the editors' number-assignment log. A new row means
// a proposal with a non-trivial spec has been given a number. Columns:
// Number, PR URL, EIP/ERC/RIP, Assigned by, Notes.

export interface SheetRow {
  number: number;
  prUrl: string;
  type: 'EIP' | 'ERC' | 'RIP';
  assignedBy: string;
  notes: string;
}

export function parseSheet(csv: string): SheetRow[] {
  const rows = parseCsv(csv);
  const headerIdx = rows.findIndex((r) => r.some((c) => /^number$/i.test(c.trim())));
  if (headerIdx < 0) throw new Error('EIP sheet: header row not found');
  const header = rows[headerIdx].map((c) => c.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const cNum = col(/^number$/);
  const cPr = col(/pr/);
  const cType = col(/eip\s*\/\s*erc|type/);
  const cBy = col(/assigned/);
  const cNotes = col(/notes?/);
  const out: SheetRow[] = [];
  for (const r of rows.slice(headerIdx + 1)) {
    const number = parseInt((r[cNum] ?? '').replace(/\D/g, ''), 10);
    const prUrl = (r[cPr] ?? '').trim();
    if (!Number.isFinite(number) || !/^https?:\/\//.test(prUrl)) continue;
    const t = (r[cType] ?? '').trim().toUpperCase();
    const type = t.startsWith('ERC') ? 'ERC' : t.startsWith('RIP') ? 'RIP' : 'EIP';
    out.push({ number, prUrl, type, assignedBy: (r[cBy] ?? '').trim(), notes: (r[cNotes] ?? '').trim() });
  }
  return out;
}

/** "Add EIP: Block-level access lists by nerolation · Pull Request #123 · ethereum/EIPs" -> "Block-level access lists" */
export function cleanPrTitle(raw: string): string {
  let t = raw.replace(/\s*·\s*Pull Request.*$/i, '').replace(/\s*·\s*GitHub\s*$/i, '');
  t = t.replace(/\s+by\s+[\w-]+(\s*·.*)?$/i, '');
  t = t.replace(/^(Add|Create|New)\s+(EIP|ERC|RIP)s?\s*[-#]?\s*\d*\s*[:\-–]\s*/i, '');
  t = t.replace(/^(EIP|ERC|RIP)[-\s]?\d+\s*[:\-–]\s*/i, '');
  return t.trim();
}

const SECTION: Record<SheetRow['type'], string> = { EIP: 'l1', ERC: 'developers', RIP: 'l2' };

async function prTitle(prUrl: string, ctx: FetchContext): Promise<string | null> {
  const m = prUrl.match(/github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/);
  if (m && ctx.env.GITHUB_TOKEN) {
    const pr = await getJson<{ title: string }>(`https://api.github.com/repos/${m[1]}/pulls/${m[2]}`, {
      headers: { authorization: `Bearer ${ctx.env.GITHUB_TOKEN}`, 'x-github-api-version': '2022-11-28' },
    });
    return pr.title;
  }
  const { html } = await getHead(prUrl);
  return extractTitle(html);
}

const MAX_NEW_PER_RUN = 8;

export async function fetchEipSheet(source: EipSheetSource, ctx: FetchContext): Promise<Candidate[]> {
  const csv = await getText(`https://docs.google.com/spreadsheets/d/${source.sheetId}/export?format=csv`);
  const rows = parseSheet(csv);
  const seenKey = 'eipsheet:seen';
  const seenRaw = await ctx.kvGet(seenKey);
  const rowKey = (r: SheetRow) => `${r.type}:${r.number}`;
  if (!seenRaw) {
    // First run: everything already in the sheet is old news.
    await ctx.kvSet(seenKey, JSON.stringify(rows.map(rowKey)));
    return [];
  }
  const seen = new Set<string>(JSON.parse(seenRaw));
  const fresh = rows.filter((r) => !seen.has(rowKey(r))).slice(0, MAX_NEW_PER_RUN);
  const out: Candidate[] = [];
  for (const r of fresh) {
    const label = `${r.type}-${r.number}`;
    let title: string | null = null;
    let forkcast: { url: string; title: string | null } | null = null;
    if (r.type === 'EIP') forkcast = await forkcastEip(r.number, ctx).catch(() => null);
    if (forkcast?.title) title = forkcast.title.replace(/^EIP-\d+:\s*/i, '');
    if (!title) title = await prTitle(r.prUrl, ctx).then((t) => (t ? cleanPrTitle(t) : null)).catch(() => null);
    seen.add(rowKey(r));
    out.push({
      uid: `eipsheet:${rowKey(r)}`,
      url: forkcast?.url ?? r.prUrl,
      title: title ? `${label}: ${title}` : label,
      kind: 'eip',
      section: SECTION[r.type],
      tag: forkcast ? 'Forkcast' : `${r.type}s`,
      publishedAt: ctx.now,
      eip: r.type === 'RIP' ? null : r.number,
      forkcastUrl: forkcast?.url ?? null,
      links: [r.prUrl],
      extra: { prUrl: r.prUrl, assignedBy: r.assignedBy, notes: r.notes, type: r.type, number: r.number },
    });
  }
  await ctx.kvSet(seenKey, JSON.stringify([...seen]));
  return out;
}
