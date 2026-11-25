import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ethresearchRule, magiciansRule } from '../src/fetchers/discourse';
import { cleanPrTitle, parseSheet } from '../src/fetchers/eipsheet';
import { parseStatusCommit } from '../src/fetchers/eipstatus';
import { callTitle, stageShort } from '../src/fetchers/forkcast';
import { releaseTitle, tagFromReleaseUrl, versionFromTag } from '../src/fetchers/releases';
import { parseFeed } from '../src/lib/feed';
import { extractTitle } from '../src/lib/html';
import { callKeyFromTitle, groupKeys } from '../src/lib/keys';
import { canonicalUrl, matchesDomainEntry, xAccount } from '../src/lib/url';
import { isNotPrimary, isTrusted, tagFor } from '../src/trust';

const fixture = (f: string) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');

describe('canonicalUrl', () => {
  it('normalises hosts, tracking params and trailing slashes', () => {
    expect(canonicalUrl('http://www.Blog.ethereum.org/2026/11/20/post/?utm_source=x&a=1#top')).toBe('https://blog.ethereum.org/2026/11/20/post?a=1');
  });
  it('collapses Discourse reply links to the topic', () => {
    expect(canonicalUrl('https://ethresear.ch/t/some-post/22856/4')).toBe('https://ethresear.ch/t/some-post/22856');
  });
  it('normalises X and Twitter links', () => {
    expect(canonicalUrl('https://twitter.com/VitalikButerin/status/1953131251436818684/photo/1?s=20')).toBe('https://x.com/vitalikbuterin/status/1953131251436818684');
    expect(xAccount('https://x.com/VitalikButerin/status/1')).toBe('vitalikbuterin');
  });
  it('drops /files from GitHub PR links', () => {
    expect(canonicalUrl('https://github.com/ethereum/EIPs/pull/10092/files')).toBe('https://github.com/ethereum/EIPs/pull/10092');
  });
});

describe('domain rules', () => {
  it('matches domains with subdomains and path prefixes', () => {
    expect(matchesDomainEntry('https://blog.ethereum.org/x', 'ethereum.org')).toBe(true);
    expect(matchesDomainEntry('https://notethereum.org/x', 'ethereum.org')).toBe(false);
    expect(matchesDomainEntry('https://github.com/ethereum/EIPs/pull/1', 'github.com/ethereum')).toBe(true);
    expect(matchesDomainEntry('https://github.com/ethereumfake/x', 'github.com/ethereum')).toBe(false);
  });
  it('rejects news outlets and trusts configured sources', () => {
    expect(isNotPrimary('https://www.coindesk.com/tech/2026/01/01/x')).toBe(true);
    expect(isNotPrimary('https://blog.ethereum.org/x')).toBe(false);
    expect(isTrusted('https://github.com/sigp/lighthouse/releases/tag/v8.0.0')).toBe(true);
    expect(isTrusted('https://github.com/random/repo')).toBe(false);
    expect(isTrusted('https://x.com/VitalikButerin/status/123')).toBe(true);
    expect(isTrusted('https://x.com/someone/status/123')).toBe(false);
    expect(isTrusted('https://ethresear.ch/t/x/1')).toBe(false);
    expect(isTrusted('https://medium.com/remix-ide/remix-release-v0-69-0-955999227990')).toBe(true);
    expect(isTrusted('https://medium.com/someone-else/post')).toBe(false);
  });
  it('tags submitted URLs by source', () => {
    expect(tagFor('https://x.com/a/status/1')).toBe('X');
    expect(tagFor('https://blog.ethereum.org/2026/x')).toBe('EF blog');
    expect(tagFor('https://github.com/foo/bar')).toBe('GitHub');
    expect(tagFor('https://www.example.xyz/post')).toBe('example.xyz');
  });
});

describe('group keys', () => {
  it('finds core devs calls in thread titles', () => {
    expect(callKeyFromTitle('All Core Devs - Consensus (ACDC) #162, August 07, 2025')).toBe('call:acdc:162');
    expect(callKeyFromTitle('All Core Devs - Execution (ACDE) #249')).toBe('call:acde:249');
    expect(callKeyFromTitle('ACDT #47 | August 4, 2025')).toBe('call:acdt:47');
    expect(callKeyFromTitle('All Core Devs - Testing #60')).toBe('call:acdt:60');
    expect(callKeyFromTitle('EIP-7928: Block-level access lists')).toBeNull();
  });
  it('orders keys strongest first', () => {
    expect(groupKeys({ title: 'EIP-7928 moved to SFI for Glamsterdam', callKey: 'call:acde:249', eip: 7928 })).toEqual(['call:acde:249', 'eip:7928', 'upgrade:glamsterdam']);
    expect(groupKeys({ title: 'Geth v1.17.2: Bubbletea', project: 'geth', version: '1.17.2' })).toEqual(['release:geth:1.17.2']);
    expect(groupKeys({ title: 'Announcing Lighthouse v8.0.1', project: 'lighthouse' })).toEqual(['release:lighthouse:8.0.1']);
    expect(groupKeys({ title: 'ERC-8001: Agent coordination framework' })).toEqual(['eip:8001']);
    expect(groupKeys({ title: 'RIP-7212 precompile' })).toEqual(['rip:7212']);
    expect(groupKeys({ title: 'Hegota upgrade naming' })).toEqual(['upgrade:hegota']);
    expect(groupKeys({ title: 'A post about Prague the city' })).toEqual([]);
  });
});

describe('releases', () => {
  it('builds titles from name, tag and release title', () => {
    expect(releaseTitle('Geth', 'v1.17.2', 'Bubbletea (v1.17.2)')).toBe('Geth v1.17.2: Bubbletea');
    expect(releaseTitle('Lighthouse', 'v8.0.0', 'Lighthouse v8.0.0')).toBe('Lighthouse v8.0.0');
    expect(releaseTitle('Hardhat', 'hardhat@2.26.2', 'hardhat@2.26.2')).toBe('Hardhat v2.26.2');
    expect(releaseTitle('Foundry', 'v1.4.0', 'v1.4.0')).toBe('Foundry v1.4.0');
    expect(releaseTitle('viem', 'viem@2.58.0', 'viem@2.58.0')).toBe('viem v2.58.0');
    expect(releaseTitle('Teku', '26.11.0', '26.11.0')).toBe('Teku 26.11.0');
  });
  it('reads tags and versions', () => {
    expect(tagFromReleaseUrl('https://github.com/NomicFoundation/hardhat/releases/tag/hardhat%402.26.2')).toBe('hardhat@2.26.2');
    expect(versionFromTag('@nomicfoundation/hardhat-ethers@3.1.0')).toBe('3.1.0');
    expect(versionFromTag('v1.16.3')).toBe('1.16.3');
  });
});

describe('feeds', () => {
  it('parses Atom releases', () => {
    const entries = parseFeed(fixture('releases.atom'), 'https://github.com');
    expect(entries).toHaveLength(2);
    expect(entries[0].url).toBe('https://github.com/ethereum/go-ethereum/releases/tag/v1.17.2');
    expect(entries[0].title).toBe('Bubbletea (v1.17.2)');
    expect(entries[0].published).toBe(Date.parse('2026-11-20T10:00:00Z') / 1000);
  });
  it('parses RSS with entities and CDATA', () => {
    const entries = parseFeed(fixture('blog.rss'));
    expect(entries[0].title).toBe('Glamsterdam on Hoodi & client releases');
    expect(entries[0].author).toBe('EF Protocol');
    expect(entries[0].contentHtml).toContain('go-ethereum/releases/tag/v1.17.2');
  });
});

describe('EIP sheet and status', () => {
  it('parses the numbering sheet', () => {
    const rows = parseSheet(fixture('sheet.csv'));
    expect(rows.map((r) => `${r.type}-${r.number}`)).toEqual(['EIP-8480', 'ERC-8481', 'RIP-7900']);
    expect(rows[1].notes).toBe('Agent, registry');
  });
  it('cleans PR titles', () => {
    expect(cleanPrTitle('Add EIP: Multi-chain deterministic deployment factory by someone · Pull Request #10092 · ethereum/EIPs')).toBe('Multi-chain deterministic deployment factory');
    expect(cleanPrTitle('Add ERC: Agent Coordination Framework · Pull Request #1149 · ethereum/ERCs · GitHub')).toBe('Agent Coordination Framework');
    expect(cleanPrTitle('Add EIP-8000: Foo bar')).toBe('Foo bar');
  });
  it('reads status-change commits', () => {
    expect(parseStatusCommit('Update EIP-7702: Move to Final (#9500)', 'EIP')).toEqual({ n: 7702, status: 'Final', title: 'Update EIP-7702: Move to Final' });
    expect(parseStatusCommit('Update EIP-7928: Move to Last Call', 'EIP')?.status).toBe('Last Call');
    expect(parseStatusCommit('Update EIP-7928: fix typo', 'EIP')).toBeNull();
  });
});

describe('forum rules', () => {
  it('keeps Magicians EIP topics, call threads and upgrade naming only', () => {
    expect(magiciansRule('EIP-8483: Post-Quantum material registration', 'eips/eips-core')).toMatchObject({ include: true, section: 'l1' });
    expect(magiciansRule('Some new standard', 'ercs')).toMatchObject({ include: true, section: 'developers' });
    expect(magiciansRule('All Core Devs - Execution (ACDE) #250, December 3, 2026', 'protocol-calls')).toMatchObject({ include: true, section: 'acd' });
    expect(magiciansRule('Upgrade naming for the I* fork', 'magicians')).toMatchObject({ include: true });
    expect(magiciansRule('Meetup in Lisbon', 'events')).toMatchObject({ include: false });
  });
  it('holds ethresear.ch posts from authors not on the allowlist', () => {
    expect(ethresearchRule('vbuterin').hold).toBeNull();
    expect(ethresearchRule('VBUTERIN').hold).toBeNull();
    expect(ethresearchRule('someone').hold).toMatch(/allowlist/);
  });
});

describe('forkcast', () => {
  it('maps stages to inclusion shorthand', () => {
    expect(stageShort('Considered')).toBe('CFI');
    expect(stageShort('Declined')).toBe('DFI');
    expect(stageShort('Scheduled')).toBe('SFI');
    expect(stageShort('Proposed')).toBe('PFI');
    expect(stageShort(undefined)).toBeNull();
  });
  it('titles calls so their threads group with them', () => {
    const t = callTitle('All Core Devs - Execution', 'acde', 249);
    expect(t).toBe('All Core Devs - Execution (ACDE) #249');
    expect(callKeyFromTitle(t)).toBe('call:acde:249');
  });
});

describe('page titles', () => {
  it('prefers og:title', () => {
    expect(extractTitle('<html><head><title>Site | x</title><meta property="og:title" content="Real &amp; title"></head>')).toBe('Real & title');
    expect(extractTitle('<title>\n Just a title \n</title>')).toBe('Just a title');
  });
});
