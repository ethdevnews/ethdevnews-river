// The river's source list. Every entry is a primary source: the project, spec
// body or person the news is about. News outlets and aggregators never go here.
//
// Fields:
//   id        stable id (used in the database; don't rename once live)
//   type      which fetcher reads it
//   tag       short source tag shown in brackets, e.g. [Forkcast]
//   section   default section for its items
//   project   optional project slug, used to group a release with its blog post
//   every     minutes between fetches (default 60)
//   enabled   set false to switch a source off without deleting it

export type SourceType =
  | 'rss'
  | 'github_releases'
  | 'discourse'
  | 'forkcast_calls'
  | 'eip_sheet'
  | 'eip_status';

interface BaseSource {
  id: string;
  type: SourceType;
  name: string;
  tag: string;
  section: string;
  project?: string;
  every?: number;
  enabled?: boolean;
}

export interface RssSource extends BaseSource {
  type: 'rss';
  url: string;
  /** Optional: only keep entries whose title matches. */
  titleFilter?: RegExp;
}

export interface GithubReleasesSource extends BaseSource {
  type: 'github_releases';
  repo: string; // owner/name
  /** Skip tags that look like pre-releases (default true). */
  skipPrereleases?: boolean;
  /** Only x.y.0 releases, for libraries that ship patches daily. */
  minorOnly?: boolean;
}

export interface DiscourseSource extends BaseSource {
  type: 'discourse';
  base: string; // https://ethereum-magicians.org
  rules: 'magicians' | 'ethresearch';
}

export interface ForkcastCallsSource extends BaseSource {
  type: 'forkcast_calls';
  /** ethereum/pm ACDbot series names to include. */
  series: string[];
  /** How many recent calls per series to re-check for new decisions. */
  recent?: number;
}

export interface EipSheetSource extends BaseSource {
  type: 'eip_sheet';
  sheetId: string;
}

export interface EipStatusSource extends BaseSource {
  type: 'eip_status';
  repo: string; // ethereum/EIPs or ethereum/ERCs
  branch: string;
  prefix: 'EIP' | 'ERC';
}

export type Source =
  | RssSource
  | GithubReleasesSource
  | DiscourseSource
  | ForkcastCallsSource
  | EipSheetSource
  | EipStatusSource;

const rel = (
  id: string,
  repo: string,
  name: string,
  section: string,
  project: string,
): GithubReleasesSource => ({ id, type: 'github_releases', repo, name, tag: 'GitHub', section, project, every: 60 });

export const SOURCES: Source[] = [
  // --- Protocol process -----------------------------------------------------
  {
    id: 'forkcast-calls',
    type: 'forkcast_calls',
    name: 'Forkcast: core devs calls and decisions',
    tag: 'Forkcast',
    section: 'acd',
    series: ['acde', 'acdc', 'acdt'],
    recent: 3,
    every: 30,
  },
  {
    id: 'eip-sheet',
    type: 'eip_sheet',
    name: 'EIP/ERC numbering sheet',
    tag: 'EIPs',
    section: 'l1',
    sheetId: '1OkxGKP9e_GJvIswYxrLaVm03GOyXcSjNflp7_rb8SD0',
    every: 60,
  },
  { id: 'eips-status', type: 'eip_status', name: 'EIPs repository status changes', tag: 'EIPs', section: 'l1', repo: 'ethereum/EIPs', branch: 'master', prefix: 'EIP', every: 60 },
  { id: 'ercs-status', type: 'eip_status', name: 'ERCs repository status changes', tag: 'ERCs', section: 'developers', repo: 'ethereum/ERCs', branch: 'master', prefix: 'ERC', every: 60 },
  { id: 'magicians', type: 'discourse', name: 'Ethereum Magicians', tag: 'Eth Magicians', section: 'l1', base: 'https://ethereum-magicians.org', rules: 'magicians', every: 30 },
  { id: 'ethresearch', type: 'discourse', name: 'ethresear.ch', tag: 'ethresear.ch', section: 'research', base: 'https://ethresear.ch', rules: 'ethresearch', every: 30 },

  // --- Blogs (RSS/Atom) -------------------------------------------------------
  { id: 'ef-blog', type: 'rss', name: 'Ethereum Foundation blog', tag: 'EF blog', section: 'ecosystem', url: 'https://blog.ethereum.org/en/feed.xml', every: 60 },
  { id: 'vitalik-blog', type: 'rss', name: "Vitalik's blog", tag: 'vitalik.eth', section: 'research', url: 'https://vitalik.eth.limo/feed.xml', every: 120 },
  { id: 'geth-blog', type: 'rss', name: 'Geth blog', tag: 'Geth blog', section: 'staking', project: 'geth', url: 'https://geth.ethereum.org/feed.xml', every: 120 },
  { id: 'solidity-blog', type: 'rss', name: 'Solidity blog', tag: 'Solidity blog', section: 'developers', project: 'solidity', url: 'https://soliditylang.org/feed.xml', every: 120 },
  { id: 'oplabs-blog', type: 'rss', name: 'OP Labs blog', tag: 'OP Labs', section: 'l2', url: 'https://blog.oplabs.co/rss/', every: 120 },
  { id: 'ethpandaops-blog', type: 'rss', name: 'ethPandaOps', tag: 'ethPandaOps', section: 'l1', url: 'https://ethpandaops.io/posts/index.xml', every: 120 },
  { id: 'flashbots-writings', type: 'rss', name: 'Flashbots writings', tag: 'Flashbots', section: 'l1', url: 'https://writings.flashbots.net/rss.xml', every: 120 },
  { id: 'sigp-blog', type: 'rss', name: 'Sigma Prime blog', tag: 'Sigma Prime', section: 'staking', project: 'lighthouse', url: 'https://blog.sigmaprime.io/feed.xml', every: 120 },
  { id: 'remix-blog', type: 'rss', name: 'Remix blog', tag: 'Remix', section: 'developers', url: 'https://medium.com/feed/remix-ide', every: 180 },
  { id: 'trailofbits-blog', type: 'rss', name: 'Trail of Bits blog', tag: 'Trail of Bits', section: 'security', url: 'https://blog.trailofbits.com/feed/', every: 180,
    titleFilter: /ethereum|evm|solidity|vyper|smart contract|blockchain|defi|zk|post-mortem|vulnerab/i },

  // --- Execution layer client releases ---------------------------------------
  rel('rel-geth', 'ethereum/go-ethereum', 'Geth', 'staking', 'geth'),
  rel('rel-nethermind', 'NethermindEth/nethermind', 'Nethermind', 'staking', 'nethermind'),
  rel('rel-besu', 'hyperledger/besu', 'Besu', 'staking', 'besu'),
  rel('rel-erigon', 'erigontech/erigon', 'Erigon', 'staking', 'erigon'),
  rel('rel-reth', 'paradigmxyz/reth', 'Reth', 'staking', 'reth'),
  rel('rel-ethrex', 'lambdaclass/ethrex', 'ethrex', 'staking', 'ethrex'),

  // --- Consensus layer client releases ---------------------------------------
  rel('rel-lighthouse', 'sigp/lighthouse', 'Lighthouse', 'staking', 'lighthouse'),
  rel('rel-prysm', 'OffchainLabs/prysm', 'Prysm', 'staking', 'prysm'),
  rel('rel-teku', 'Consensys/teku', 'Teku', 'staking', 'teku'),
  rel('rel-nimbus', 'status-im/nimbus-eth2', 'Nimbus', 'staking', 'nimbus'),
  rel('rel-lodestar', 'ChainSafe/lodestar', 'Lodestar', 'staking', 'lodestar'),
  rel('rel-grandine', 'grandinetech/grandine', 'Grandine', 'staking', 'grandine'),

  // --- Specs ------------------------------------------------------------------
  // Spec releases are mostly alphas, and those matter, so pre-releases are kept.
  { ...rel('rel-consensus-specs', 'ethereum/consensus-specs', 'consensus-specs', 'l1', 'consensus-specs'), skipPrereleases: false },
  rel('rel-execution-apis', 'ethereum/execution-apis', 'execution-apis', 'l1', 'execution-apis'),

  // --- Developer tools -------------------------------------------------------
  rel('rel-solidity', 'argotorg/solidity', 'Solidity', 'developers', 'solidity'),
  rel('rel-vyper', 'vyperlang/vyper', 'Vyper', 'developers', 'vyper'),
  rel('rel-foundry', 'foundry-rs/foundry', 'Foundry', 'developers', 'foundry'),
  rel('rel-hardhat', 'NomicFoundation/hardhat', 'Hardhat', 'developers', 'hardhat'),
  { ...rel('rel-viem', 'wevm/viem', 'viem', 'developers', 'viem'), minorOnly: true },
  { ...rel('rel-alloy', 'alloy-rs/alloy', 'alloy', 'developers', 'alloy'), minorOnly: true },
  rel('rel-ethers', 'ethers-io/ethers.js', 'ethers.js', 'developers', 'ethers'),
  rel('rel-web3py', 'ethereum/web3.py', 'web3.py', 'developers', 'web3py'),
  rel('rel-oz', 'OpenZeppelin/openzeppelin-contracts', 'OpenZeppelin Contracts', 'developers', 'openzeppelin'),
  rel('rel-ape', 'ApeWorX/ape', 'Ape', 'developers', 'ape'),
  rel('rel-scaffold', 'scaffold-eth/scaffold-eth-2', 'Scaffold-ETH 2', 'developers', 'scaffold-eth'),
  rel('rel-sourcify', 'argotorg/sourcify', 'Sourcify', 'developers', 'sourcify'),
];

export function enabledSources(): Source[] {
  return SOURCES.filter((s) => s.enabled !== false);
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((s) => s.id === id);
}
