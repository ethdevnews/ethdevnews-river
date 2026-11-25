import { HOLD_HOURS, MAX_AGE_DAYS, NOT_PRIMARY_DOMAINS, RESEARCH_AUTHORS, TRUSTED_DOMAINS, TRUSTED_X_ACCOUNTS } from '../config/rules';
import { SECTIONS, sectionName } from '../config/sections';
import { SOURCES } from '../config/sources';
import { escapeHtml as e } from '../lib/html';
import { ago, dayKey, dayLabel, isoDate } from '../lib/time';
import type { StoryView } from '../queries';
import type { ItemRow } from '../types';
import { layout, type PageOpts } from './layout';

function itemLink(i: ItemRow): string {
  return `<a href="${e(i.url)}">${e(i.title)}</a> <span class="tag">[${e(i.tag)}]</span>`;
}

function forkcastLink(i: ItemRow): string {
  return i.forkcast_url && i.forkcast_url !== i.url ? ` <a class="tag" href="${e(i.forkcast_url)}">[Forkcast]</a>` : '';
}

function decisionLine(i: ItemRow): string {
  const x = JSON.parse(i.extra) as { stageShort?: string | null };
  const stage = x.stageShort ? `<span class="stage stage-${e(x.stageShort)}">${e(x.stageShort)}</span>` : '';
  return `<li>${stage}${e(i.title)}${forkcastLink(i)}</li>`;
}

export function storyHtml(v: StoryView, now: number, opts: { showSection?: boolean; maxMore?: number } = {}): string {
  const { story, headline } = v;
  const decisions = v.items
    .filter((i) => i.kind === 'decision' && i.id !== headline.id)
    .sort((a, b) => (JSON.parse(a.extra).stageShort ? 0 : 1) - (JSON.parse(b.extra).stageShort ? 0 : 1) || a.published_at - b.published_at);
  const others = v.items.filter((i) => i.kind !== 'decision' && i.id !== headline.id);
  const max = opts.maxMore ?? 6;
  const meta = [
    opts.showSection !== false ? `<a href="/s/${e(story.section)}">${e(sectionName(story.section))}</a>` : '',
    `<time datetime="${isoDate(story.last_updated)}" title="${isoDate(story.last_updated)}">${ago(story.last_updated, now)}</time>`,
    `<a href="/story/${story.id}" title="Permalink">#</a>`,
  ].filter(Boolean);
  let html = `<article class="story" id="s${story.id}"><div class="meta">${meta.join(' · ')}</div>`;
  html += `<h2>${itemLink(headline)}${forkcastLink(headline)}</h2>`;
  if (decisions.length) {
    html += `<div class="more-label">Decisions</div><ul class="sub">${decisions.slice(0, 12).map(decisionLine).join('')}`;
    if (decisions.length > 12) html += `<li><a href="/story/${story.id}">${decisions.length - 12} more decisions</a></li>`;
    html += '</ul>';
  }
  if (others.length) {
    html += `<div class="more-label">More</div><ul class="sub">${others
      .slice(0, max)
      .map((i) => `<li>${itemLink(i)}${forkcastLink(i)}</li>`)
      .join('')}`;
    if (others.length > max) html += `<li><a href="/story/${story.id}">${others.length - max} more</a></li>`;
    html += '</ul>';
  }
  return `${html}</article>`;
}

export function riverPage(page: PageOpts, stories: StoryView[], now: number, tz: string, opts: { heading?: string; nextHref?: string; showSection?: boolean }): string {
  let body = opts.heading ? `<h1>${e(opts.heading)}</h1>` : '';
  if (!stories.length) body += '<p>Nothing here yet. The river fills as sources are fetched.</p>';
  let day = '';
  for (const v of stories) {
    const k = dayKey(v.story.last_updated, tz);
    if (k !== day) {
      day = k;
      body += `<div class="day">${e(dayLabel(v.story.last_updated, tz))}</div>`;
    }
    body += storyHtml(v, now, { showSection: opts.showSection });
  }
  if (opts.nextHref) body += `<div class="pager"><a href="${e(opts.nextHref)}">Older stories →</a></div>`;
  return layout(page, body);
}

export function storyPage(page: PageOpts, v: StoryView, now: number): string {
  let body = storyHtml(v, now, { maxMore: 500 });
  body += `<h3>Timeline</h3><div class="scroll"><table><tr><th>Seen</th><th>Item</th><th>Kind</th></tr>`;
  for (const i of v.items) body += `<tr><td>${isoDate(i.seen_at).slice(0, 16).replace('T', ' ')} UTC</td><td>${itemLink(i)}</td><td>${e(i.kind)}</td></tr>`;
  body += `</table></div><p class="meta">Story broke ${isoDate(v.story.first_seen).slice(0, 16).replace('T', ' ')} UTC · group <code>${e(v.story.group_key)}</code></p>`;
  return layout(page, body);
}

export function weekPage(page: PageOpts, stories: StoryView[], now: number): string {
  let body = `<h1>The last 7 days</h1><p class="meta">Every story from the past week, by section, biggest first. The weekly issue is written from this.</p>`;
  for (const s of SECTIONS) {
    const list = stories.filter((v) => v.story.section === s.id).sort((a, b) => b.items.length - a.items.length || b.story.last_updated - a.story.last_updated);
    if (!list.length) continue;
    body += `<h3>${e(s.name)}</h3>`;
    for (const v of list) body += storyHtml(v, now, { showSection: false, maxMore: 4 });
  }
  if (!stories.length) body += '<p>Nothing yet.</p>';
  return layout(page, body);
}

export interface SourceStateRow {
  source_id: string;
  last_run: number | null;
  last_ok: number | null;
  last_error: string | null;
  failing_since: number | null;
  items_added: number;
  muted: number;
}

export function sourcesPage(
  page: PageOpts,
  states: SourceStateRow[],
  bots: { name: string; standing: string; score: number }[],
  held: ItemRow[],
  now: number,
): string {
  const byId = new Map(states.map((s) => [s.source_id, s]));
  let body = `<h1>Sources</h1><p class="meta">Health of every source. A source failing for 7 days is muted and retried daily. <a href="/api/sources.json">JSON</a></p>`;
  body += `<div class="scroll"><table><tr><th>Source</th><th>Tag</th><th>Section</th><th>Status</th><th>Last OK</th><th>Items</th></tr>`;
  for (const src of SOURCES) {
    const st = byId.get(src.id);
    let status = '<span class="meta">not run yet</span>';
    if (src.enabled === false) status = '<span class="meta">off</span>';
    else if (st?.muted) status = `<span class="bad" title="${e(st.last_error ?? '')}">muted</span>`;
    else if (st?.last_error) status = `<span class="bad" title="${e(st.last_error)}">failing</span><div class="meta">${e(st.last_error.slice(0, 120))}</div>`;
    else if (st?.last_ok) status = '<span class="ok">ok</span>';
    body += `<tr><td>${e(src.name)}<div class="meta">${e(src.type)}</div></td><td>${e(src.tag)}</td><td>${e(sectionName(src.section))}</td><td>${status}</td><td>${st?.last_ok ? ago(st.last_ok, now) + ' ago' : '–'}</td><td>${st?.items_added ?? 0}</td></tr>`;
  }
  body += '</table></div>';
  body += `<h3>Bots</h3>`;
  if (!bots.length) body += '<p class="meta">No bots registered yet.</p>';
  else {
    body += `<div class="scroll"><table><tr><th>Bot</th><th>Standing</th><th>Score</th></tr>`;
    for (const b of bots) body += `<tr><td>${e(b.name)}</td><td>${e(b.standing)}</td><td>${b.score}</td></tr>`;
    body += '</table></div>';
  }
  body += `<h3>Held (${held.length})</h3><p class="meta">Primary but not yet trusted. Published when a second bot submits it or a published item links to it; expires after ${HOLD_HOURS}h.</p>`;
  if (held.length) {
    body += `<div class="scroll"><table><tr><th>Item</th><th>Why</th><th>Age</th></tr>`;
    for (const i of held) body += `<tr><td>${itemLink(i)}</td><td>${e(i.status_reason ?? '')}</td><td>${ago(i.seen_at, now)}</td></tr>`;
    body += '</table></div>';
  }
  return layout(page, body);
}

export function aboutPage(page: PageOpts): string {
  const body = `<div class="prose">
<h1>How the river works</h1>
<p>The ethdevnews river is a running feed of Ethereum developer news, inspired by Techmeme's river. Software collects it from primary sources around the clock and groups related items into stories. Nobody edits it. The <a href="https://ethdevnews.com">ethdevnews</a> weekly issue is written from it.</p>
<h3>Primary sources only</h3>
<p>Every item links to where the news came from: the project's own blog, repository, release, forum post or spec, or the author's own post. News outlets, aggregators and other newsletters are never linked. Each item shows its source in brackets, such as [Forkcast], and keeps the source's own title.</p>
<h3>Rules by source</h3>
<ul>
<li><b>Core devs calls</b> and their decisions (PFI, CFI, SFI, DFI) come from <a href="https://forkcast.org">Forkcast</a>, and are grouped under the call.</li>
<li><b>New EIPs, ERCs and RIPs</b> come from the editors' <a href="https://docs.google.com/spreadsheets/d/1OkxGKP9e_GJvIswYxrLaVm03GOyXcSjNflp7_rb8SD0">number-assignment sheet</a>. An EIP links to Forkcast where Forkcast has a page for it, otherwise to its pull request. Status changes come from the EIPs and ERCs repositories.</li>
<li><b>Ethereum Magicians</b> topics are included when they discuss an EIP or ERC, a core devs call, or an upgrade and its name. They join the EIP, call or upgrade's story.</li>
<li><b>ethresear.ch</b> posts go in straight away only from these authors: ${RESEARCH_AUTHORS.map((a) => `<code>${e(a)}</code>`).join(', ')}. Others wait until something primary links to them.</li>
<li><b>Releases</b> are stable releases from each project's own GitHub repository.</li>
<li><b>Security</b> items are disclosures and post-mortems from the affected project itself, and SEAL's own output.</li>
<li>Items older than ${MAX_AGE_DAYS} days when first seen are skipped. Token sales, airdrops and price news are rejected.</li>
</ul>
<h3>Stories</h3>
<p>Related items are grouped into one story with one headline: by EIP number, core devs call, upgrade name, release version, and links between items. A story moves to the top when something new joins it.</p>
<h3>Bots</h3>
<p>Bots can add individual items through <code>POST /api/submit</code>. The river fetches the page itself and keeps its own title. A URL on a trusted domain or account (${TRUSTED_DOMAINS.length} domains plus every configured source, and ${TRUSTED_X_ACCOUNTS.length} X accounts) goes live straight away. Other primary URLs are held until a second bot submits them or a published item links to them, and expire after ${HOLD_HOURS} hours. ${NOT_PRIMARY_DOMAINS.length} news and aggregator domains are always rejected. Bots start on probation and gain or lose standing from how their submissions turn out.</p>
<h3>Feeds</h3>
<ul>
<li>RSS: <a href="/feed.xml">/feed.xml</a>, and per section, e.g. <a href="/s/acd/feed.xml">/s/acd/feed.xml</a></li>
<li>JSON Feed: <a href="/feed.json">/feed.json</a>, and per section</li>
<li>API: <a href="/api/stories.json">/api/stories.json</a> (<code>?section=</code>, <code>?since=</code> as an ISO date, <code>?limit=</code>)</li>
</ul>
<p>Source list and health: <a href="/sources">/sources</a>. Code: <a href="https://github.com/ethdevnews/ethdevnews-river">github.com/ethdevnews/ethdevnews-river</a>.</p>
</div>`;
  return layout(page, body);
}
