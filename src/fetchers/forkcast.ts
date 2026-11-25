import type { ForkcastCallsSource } from '../config/sources';
import { HttpError, getJson } from '../lib/http';
import type { Candidate, FetchContext } from '../types';

// Core devs calls come from the ethereum/pm ACDbot manifest (the same data Forkcast
// syncs from), and the decisions on each call from Forkcast's key_decisions.json.
// Items link to the call's Forkcast page.

export const PM_MANIFEST = 'https://raw.githubusercontent.com/ethereum/pm/master/.github/ACDbot/artifacts/manifest.json';
export const FORKCAST_RAW = 'https://raw.githubusercontent.com/ethereum/forkcast/main';

const SHORT: Record<string, string> = { acde: 'ACDE', acdc: 'ACDC', acdt: 'ACDT' };

interface ManifestCall {
  date: string;
  path: string;
  number: number;
  issue?: number;
}

interface KeyDecision {
  original_text: string;
  timestamp?: string;
  type: string;
  eips?: number[];
  stage_change?: { to?: string; from?: string; fork?: string };
  context?: string;
}

/** CFI/SFI/DFI/PFI shorthand for a Forkcast stage. */
export function stageShort(to?: string): string | null {
  switch ((to ?? '').toLowerCase()) {
    case 'proposed':
      return 'PFI';
    case 'considered':
      return 'CFI';
    case 'scheduled':
      return 'SFI';
    case 'declined':
      return 'DFI';
    default:
      return null;
  }
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function callPageUrl(series: string, number: number): string {
  return `https://forkcast.org/calls/${series}/${number}/`;
}

export function callTitle(seriesName: string, series: string, number: number): string {
  const short = SHORT[series];
  // "All Core Devs - Execution (ACDE) #249"
  return short && !seriesName.includes(`(${short})`) ? `${seriesName} (${short}) #${number}` : `${seriesName} #${number}`;
}

export async function fetchForkcastCalls(source: ForkcastCallsSource, ctx: FetchContext): Promise<Candidate[]> {
  const manifest = await getJson<{ series: Record<string, { name: string; calls: ManifestCall[] }> }>(PM_MANIFEST);
  const out: Candidate[] = [];
  // On the very first run, decisions already made shouldn't all look new.
  const firstRun = !(await ctx.kvGet('forkcast:seeded'));
  for (const series of source.series) {
    const s = manifest.series[series];
    if (!s) continue;
    const calls = [...s.calls].sort((a, b) => b.date.localeCompare(a.date)).slice(0, source.recent ?? 3);
    for (const call of calls) {
      const callKey = `call:${series}:${call.number}`;
      const url = callPageUrl(series, call.number);
      // Calls are at 14:00 UTC; the exact time doesn't matter much.
      const publishedAt = Math.floor(Date.parse(`${call.date}T14:00:00Z`) / 1000);
      out.push({
        uid: `forkcast:call:${call.path}`,
        url,
        title: callTitle(s.name, series, call.number),
        kind: 'call',
        section: source.section,
        tag: source.tag,
        publishedAt,
        callKey,
        extra: { date: call.date, pmIssue: call.issue ?? null },
      });

      // Decisions: Forkcast extracts these some time after the call. Check until found,
      // for up to 14 days after the call.
      const doneKey = `forkcast:kd:${call.path}`;
      if (await ctx.kvGet(doneKey)) continue;
      let decisions: KeyDecision[] | null = null;
      try {
        const kd = await getJson<{ key_decisions: KeyDecision[] }>(`${FORKCAST_RAW}/public/artifacts/${series}/${call.path.split('/')[1]}/key_decisions.json`);
        decisions = kd.key_decisions ?? [];
      } catch (e) {
        if (!(e instanceof HttpError && e.status === 404)) throw e;
      }
      if (decisions === null) {
        if (ctx.now - publishedAt > 14 * 86400) await ctx.kvSet(doneKey, 'none');
        continue;
      }
      decisions.forEach((d, i) => {
        const eips = d.eips ?? [];
        out.push({
          uid: `forkcast:decision:${call.path}:${hash(d.original_text)}`,
          url,
          title: d.original_text,
          kind: 'decision',
          section: source.section,
          tag: source.tag,
          publishedAt: publishedAt + 60 + i,
          callKey,
          eip: eips[0] ?? null,
          forkcastUrl: eips[0] ? `https://forkcast.org/eips/${eips[0]}` : null,
          extra: {
            type: d.type,
            stage: d.stage_change?.to ?? null,
            stageShort: stageShort(d.stage_change?.to),
            eips,
            timestamp: d.timestamp ?? null,
            order: i,
            bump: !firstRun,
          },
        });
      });
      await ctx.kvSet(doneKey, String(decisions.length));
    }
  }
  if (firstRun) await ctx.kvSet('forkcast:seeded', '1');
  return out;
}

/** Forkcast has a page for an EIP when its data file exists. Cached in kv. */
export async function forkcastEip(n: number, ctx: FetchContext): Promise<{ url: string; title: string | null } | null> {
  const key = `forkcast:eip:${n}`;
  const cached = await ctx.kvGet(key);
  if (cached === 'none') return null;
  if (cached) return JSON.parse(cached);
  try {
    const data = await getJson<{ title?: string }>(`${FORKCAST_RAW}/src/data/eips/${n}.json`);
    const v = { url: `https://forkcast.org/eips/${n}`, title: data.title ?? null };
    await ctx.kvSet(key, JSON.stringify(v));
    return v;
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) {
      // Don't cache misses forever: Forkcast adds EIPs over time. Cache is cleared weekly.
      await ctx.kvSet(key, 'none');
      return null;
    }
    throw e;
  }
}
