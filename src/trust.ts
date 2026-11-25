import { NOT_PRIMARY_DOMAINS, TRUSTED_DOMAINS, TRUSTED_X_ACCOUNTS } from './config/rules';
import { SOURCES, type Source } from './config/sources';
import { hostOf, matchesAny, matchesDomainEntry, xAccount } from './lib/url';

/** Domain entries implied by the configured sources (their own sites and repos). */
export function sourceDomainEntries(): { entry: string; source: Source }[] {
  const out: { entry: string; source: Source }[] = [];
  for (const s of SOURCES) {
    if (s.type === 'rss') {
      const u = new URL(s.url);
      // medium.com/feed/remix-ide -> medium.com/remix-ide
      if (u.hostname === 'medium.com') out.push({ entry: `medium.com/${u.pathname.split('/')[2]}`, source: s });
      else out.push({ entry: hostOf(s.url), source: s });
    } else if (s.type === 'github_releases') out.push({ entry: `github.com/${s.repo.toLowerCase()}`, source: s });
  }
  return out;
}

export function isNotPrimary(url: string): boolean {
  return matchesAny(url, NOT_PRIMARY_DOMAINS);
}

export function isTrusted(url: string): boolean {
  const x = xAccount(url);
  if (x) return TRUSTED_X_ACCOUNTS.includes(x);
  return matchesAny(url, TRUSTED_DOMAINS) || sourceDomainEntries().some((e) => matchesDomainEntry(url, e.entry));
}

export function sourceFor(url: string): Source | undefined {
  return sourceDomainEntries().find((e) => matchesDomainEntry(url, e.entry))?.source;
}

/** Source tag for a submitted URL: the source's own tag, X, Farcaster, GitHub, or the site name. */
export function tagFor(url: string): string {
  if (xAccount(url)) return 'X';
  const host = hostOf(url);
  if (host === 'farcaster.xyz' || host === 'warpcast.com') return 'Farcaster';
  const src = sourceFor(url);
  if (src && src.type !== 'github_releases') return src.tag;
  if (host === 'github.com') return 'GitHub';
  if (host === 'forkcast.org') return 'Forkcast';
  if (host === 'ethresear.ch') return 'ethresear.ch';
  if (host === 'ethereum-magicians.org') return 'Eth Magicians';
  return host.replace(/^(blog|www)\./, '');
}
