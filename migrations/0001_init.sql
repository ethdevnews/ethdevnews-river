-- ethdevnews river schema

-- A story groups related items (an EIP, a core devs call, a release, an upgrade).
CREATE TABLE stories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_key TEXT NOT NULL,            -- e.g. eip:7928, call:acde:249, release:geth:1.16.3, upgrade:glamsterdam, item:123
  headline_item_id INTEGER,
  section TEXT NOT NULL,
  first_seen INTEGER NOT NULL,        -- unix seconds
  last_updated INTEGER NOT NULL,
  item_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX stories_key ON stories (group_key, last_updated);
CREATE INDEX stories_updated ON stories (last_updated);
CREATE INDEX stories_section ON stories (section, last_updated);

CREATE TABLE items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uid TEXT NOT NULL UNIQUE,           -- dedupe key: canonical URL, or a source-specific id
  url TEXT NOT NULL,                  -- the primary source link
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,                -- original title as published
  source_id TEXT NOT NULL,
  tag TEXT NOT NULL,                  -- source tag shown in brackets, e.g. Forkcast
  section TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- call | decision | eip | status | release | post | discussion | submission
  author TEXT,
  published_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  status TEXT NOT NULL,               -- live | held | rejected | expired
  status_reason TEXT,
  story_id INTEGER,
  group_keys TEXT NOT NULL DEFAULT '[]',  -- JSON array, strongest first
  links TEXT NOT NULL DEFAULT '[]',       -- JSON array of canonical outbound links
  eip INTEGER,
  version TEXT,
  forkcast_url TEXT,
  summary TEXT,                       -- one-line AI summary (phase 1: always null)
  submitted_by INTEGER,
  extra TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX items_story ON items (story_id);
CREATE INDEX items_canonical ON items (canonical_url);
CREATE INDEX items_status_seen ON items (status, seen_at);
CREATE INDEX items_source ON items (source_id, seen_at);

-- Outbound links of live and held items, for grouping by shared links.
CREATE TABLE item_links (
  item_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  PRIMARY KEY (item_id, url)
);
CREATE INDEX item_links_url ON item_links (url);

CREATE TABLE source_state (
  source_id TEXT PRIMARY KEY,
  next_run INTEGER NOT NULL DEFAULT 0,
  last_run INTEGER,
  last_ok INTEGER,
  last_error TEXT,
  failing_since INTEGER,
  items_added INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE bots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  token_hash TEXT NOT NULL UNIQUE,
  standing TEXT NOT NULL DEFAULT 'probation',   -- probation | trusted | blocked
  score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  item_id INTEGER,
  outcome TEXT NOT NULL,              -- live | held | rejected | duplicate
  reason TEXT,
  note TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX submissions_item ON submissions (item_id);
CREATE INDEX submissions_bot ON submissions (bot_id, created_at);

CREATE TABLE kv (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
