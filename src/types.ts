export interface Env {
  DB: D1Database;
  SITE_URL: string;
  SITE_NAME: string;
  TIME_ZONE: string;
  /** Sources processed per cron run, to stay inside Workers limits. */
  SOURCES_PER_RUN?: string;
  /** Bearer token for /api/admin/* (secret). */
  ADMIN_TOKEN?: string;
  /** Optional GitHub token: raises rate limits for PR titles (secret). */
  GITHUB_TOKEN?: string;
}

export type ItemKind = 'call' | 'decision' | 'eip' | 'status' | 'release' | 'post' | 'discussion' | 'submission';
export type ItemStatus = 'live' | 'held' | 'rejected' | 'expired';

/** What a fetcher produces. Ingest turns it into an item. */
export interface Candidate {
  uid?: string; // defaults to canonical URL
  url: string;
  title: string;
  kind: ItemKind;
  section: string;
  tag: string;
  author?: string | null;
  publishedAt?: number | null;
  links?: string[];
  eip?: number | null;
  version?: string | null;
  project?: string | null;
  callKey?: string | null;
  forkcastUrl?: string | null;
  /** Hold instead of publishing, with this reason. */
  hold?: string | null;
  extra?: Record<string, unknown>;
}

export interface FetchContext {
  env: Env;
  now: number;
  kvGet(key: string): Promise<string | null>;
  kvSet(key: string, value: string): Promise<void>;
  /** Items we already have, by uid (to skip extra requests). */
  hasUid(uid: string): Promise<boolean>;
}

export interface ItemRow {
  id: number;
  uid: string;
  url: string;
  canonical_url: string;
  title: string;
  source_id: string;
  tag: string;
  section: string;
  kind: ItemKind;
  author: string | null;
  published_at: number;
  seen_at: number;
  status: ItemStatus;
  status_reason: string | null;
  story_id: number | null;
  group_keys: string;
  links: string;
  eip: number | null;
  version: string | null;
  forkcast_url: string | null;
  summary: string | null;
  submitted_by: number | null;
  extra: string;
}

export interface StoryRow {
  id: number;
  group_key: string;
  headline_item_id: number | null;
  section: string;
  first_seen: number;
  last_updated: number;
  item_count: number;
}
