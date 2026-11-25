// Editorial rules, all enforced in code. Edit these instead of editing items.

/** ethresear.ch: only these authors (Discourse usernames, case-insensitive) go live by default.
 *  Posts by anyone else are held until something primary links to them. */
export const RESEARCH_AUTHORS = ['vbuterin', 'JustinDrake', 'dankrad', 'barnabe', 'fradamt', 'nerolation', 'mikeneuder'];

/** Ethereum Magicians categories (slugs) whose new topics become items.
 *  Other topics only become items when they name an EIP/ERC, a core devs call or an upgrade. */
export const MAGICIANS_CATEGORIES: Record<string, { section: string }> = {
  eips: { section: 'l1' },
  'eips-core': { section: 'l1' },
  'eips-networking': { section: 'l1' },
  'eips-interface': { section: 'l1' },
  'eips-meta': { section: 'l1' },
  'eips-informational': { section: 'l1' },
  ercs: { section: 'developers' },
  'protocol-calls': { section: 'acd' },
};

/** Domains whose pages go live straight away when a bot submits them.
 *  Domains of configured sources are added automatically. An entry can include a path prefix.
 *  ethresear.ch and Ethereum Magicians are deliberately absent: bot submissions from them are held,
 *  like posts by authors who aren't allowlisted. */
export const TRUSTED_DOMAINS = [
  'ethereum.org',
  'blog.ethereum.org',
  'forkcast.org',
  'eips.ethereum.org',
  'notes.ethereum.org',
  'ethpandaops.io',
  'clientdiversity.org',
  'protocol-guild.readthedocs.io',
  'securityalliance.org',
  'frameworks.securityalliance.org',
  'collective.flashbots.net',
  'vitalik.eth.limo',
  'l2beat.com',
  'github.com/ethereum',
  'github.com/argotorg',
  // Regulators and governments (Regulation section)
  'sec.gov',
  'cftc.gov',
  'treasury.gov',
  'whitehouse.gov',
  'congress.gov',
  'fca.org.uk',
  'esma.europa.eu',
];

/** X accounts whose posts go live straight away when a bot submits them (lowercase). */
export const TRUSTED_X_ACCOUNTS = [
  'vitalikbuterin',
  'ethereum',
  'ethereumfndn',
  'go_ethereum',
  'nethermindeth',
  'sigp_io',
  'prylabs',
  'ethpandaops',
  'solidity_lang',
  'vyperlang',
  'foundry_rs',
  'nomicfoundation',
  'wevm_dev',
  'openzeppelin',
  'secalliance',
  'protocolguild',
  'l2beat',
];

/** Never primary: news outlets, aggregators and other newsletters. Submissions of these are rejected,
 *  unless the bot also gives the primary source as evidence_url. */
export const NOT_PRIMARY_DOMAINS = [
  'coindesk.com',
  'cointelegraph.com',
  'theblock.co',
  'decrypt.co',
  'blockworks.co',
  'thedefiant.io',
  'dlnews.com',
  'cryptoslate.com',
  'cryptobriefing.com',
  'beincrypto.com',
  'u.today',
  'bitcoin.com',
  'crypto.news',
  'coinmarketcap.com',
  'coingecko.com',
  'bankless.com',
  'ethernews.org',
  'ethereal.news',
  'weekinethereumnews.com',
  'weekinethereum.substack.com',
  'reddit.com',
  'news.ycombinator.com',
  'youtube.com',
  'youtu.be',
  'bloomberg.com',
  'reuters.com',
  'forbes.com',
  'techcrunch.com',
  'cnbc.com',
  'binance.com',
  'coinbase.com/learn',
];

/** Titles matching this are rejected from bots and blogs alike. */
export const REJECT_TITLE = /\b(airdrop|token sale|presale|pre-sale|giveaway|price (prediction|analysis)|price target|to the moon|ICO)\b/i;

/** Upgrade names. Each alias maps to its combined upgrade name. City names
 *  (Prague, Osaka, Amsterdam, Bogota) are left out because they cause false matches. */
export const UPGRADES: Record<string, string> = {
  pectra: 'pectra',
  electra: 'pectra',
  fusaka: 'fusaka',
  fulu: 'fusaka',
  glamsterdam: 'glamsterdam',
  gloas: 'glamsterdam',
  hegota: 'hegota',
  heka: 'hegota',
};

/** How long a story stays open for new items to join it, by group type (days). */
export const STORY_WINDOW_DAYS: Record<string, number> = {
  call: 21,
  eip: 14,
  release: 10,
  upgrade: 5,
  link: 7,
};

/** Held items expire after this many hours unless corroborated. */
export const HOLD_HOURS = 72;

/** On ingest, ignore items published longer ago than this (avoids backfilling old posts). */
export const MAX_AGE_DAYS = 10;

/** Bot standing thresholds: score at which a probation bot becomes trusted, or is blocked. */
export const BOT_TRUSTED_SCORE = 25;
export const BOT_BLOCKED_SCORE = -15;
