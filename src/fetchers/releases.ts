import type { GithubReleasesSource } from '../config/sources';
import { entryLinks, parseFeed } from '../lib/feed';
import { getText } from '../lib/http';
import type { Candidate, FetchContext } from '../types';

// Release tags look like v1.2.3, 1.2.3 or pkg@1.2.3. Anything else (bootnode-1.0.0, main-rel-v1) is skipped.
const RELEASE_TAG = /^(v?\d|(@[\w.-]+\/)?[\w.-]+@v?\d)/i;
const PRERELEASE = /(alpha|beta|\brc|-rc|\.rc|preview|nightly|unstable|-dev|canary|snapshot)/i;

export function tagFromReleaseUrl(url: string): string | null {
  const m = url.match(/\/releases\/tag\/([^?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Version from a tag: "v1.16.3" -> "1.16.3", "hardhat@2.26.2" -> "2.26.2", "@scope/pkg@1.2.3" -> "1.2.3" */
export function versionFromTag(tag: string): string {
  const at = tag.lastIndexOf('@');
  const v = at > 0 ? tag.slice(at + 1) : tag;
  return v.replace(/^v/i, '');
}

/** "Geth v1.16.3: Bubbletea" from name "Geth", tag "v1.16.3", release title "Bubbletea (v1.16.3)". */
export function releaseTitle(name: string, tag: string, title: string): string {
  const version = versionFromTag(tag);
  const shown = /^v?\d/i.test(tag) ? tag : `v${version}`;
  const base = `${name} ${shown}`;
  let rest = title
    .replace(tag, '')
    .replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), '')
    .replace(/^@|@$/g, '')
    .replace(new RegExp(`v?${version.replace(/\./g, '\\.')}`, 'g'), '')
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, '')
    .replace(/\(\s*\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (/^(release|version)$/i.test(rest)) rest = '';
  return rest ? `${base}: ${rest}` : base;
}

export async function fetchReleases(source: GithubReleasesSource, ctx: FetchContext): Promise<Candidate[]> {
  const xml = await getText(`https://github.com/${source.repo}/releases.atom`);
  const out: Candidate[] = [];
  const repoName = source.repo.split('/')[1].toLowerCase();
  for (const e of parseFeed(xml, 'https://github.com')) {
    const tag = tagFromReleaseUrl(e.url);
    if (!tag) continue;
    if (!RELEASE_TAG.test(tag)) continue;
    if (source.skipPrereleases !== false && PRERELEASE.test(tag)) continue;
    // Monorepos (hardhat, viem) tag many packages. Keep the main package only.
    if (tag.includes('@')) {
      const pkg = tag.slice(0, tag.lastIndexOf('@')).replace(/^@[^/]+\//, '').toLowerCase();
      if (pkg !== repoName && pkg !== (source.project ?? '').toLowerCase()) continue;
    }
    const version = versionFromTag(tag);
    // Busy libraries: only minor and major releases (x.y.0).
    if (source.minorOnly && !/^\d+\.\d+\.0$/.test(version)) continue;
    out.push({
      url: e.url,
      title: releaseTitle(source.name, tag, e.title),
      kind: 'release',
      section: source.section,
      tag: source.tag,
      publishedAt: e.published ?? ctx.now,
      project: source.project ?? null,
      version,
      links: entryLinks(e).slice(0, 50),
      extra: { repo: source.repo, releaseTag: tag },
    });
  }
  return out;
}
