import { HOLD_HOURS } from './config/rules';
import { enabledSources, type Source } from './config/sources';
import { Db } from './db';
import { runFetcher } from './fetchers';
import { ingest } from './ingest';
import { adjustBotScore } from './bots';
import type { Env, FetchContext } from './types';

const MUTE_AFTER_DAYS = 7;

interface SourceState {
  source_id: string;
  next_run: number;
  failing_since: number | null;
  muted: number;
}

export function makeContext(env: Env, db: Db, now: number): FetchContext {
  return {
    env,
    now,
    kvGet: (k) => db.kvGet(k),
    kvSet: (k, v) => db.kvSet(k, v, now),
    hasUid: async (uid) => !!(await db.itemByUid(uid)),
  };
}

export async function runSource(env: Env, db: Db, source: Source, now: number) {
  const ctx = makeContext(env, db, now);
  const state = await db.first<SourceState>('SELECT * FROM source_state WHERE source_id = ?', source.id);
  const every = (source.every ?? 60) * 60;
  try {
    const candidates = await runFetcher(source, ctx);
    const r = await ingest(db, candidates, { sourceId: source.id, now });
    await db.run(
      `INSERT INTO source_state (source_id, next_run, last_run, last_ok, last_error, failing_since, items_added, muted)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, 0)
       ON CONFLICT(source_id) DO UPDATE SET next_run = excluded.next_run, last_run = excluded.last_run, last_ok = excluded.last_ok,
         last_error = NULL, failing_since = NULL, items_added = items_added + excluded.items_added, muted = 0`,
      source.id,
      now + every,
      now,
      now,
      r.added + r.held,
    );
    return { source: source.id, ok: true, ...r };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const failingSince = state?.failing_since ?? now;
    const muted = now - failingSince > MUTE_AFTER_DAYS * 86400 ? 1 : 0;
    // A muted source is retried once a day, so it comes back by itself when fixed.
    const next = now + (muted ? 86400 : Math.min(every * 2, 6 * 3600));
    await db.run(
      `INSERT INTO source_state (source_id, next_run, last_run, last_error, failing_since, muted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET next_run = excluded.next_run, last_run = excluded.last_run, last_error = excluded.last_error,
         failing_since = excluded.failing_since, muted = excluded.muted`,
      source.id,
      next,
      now,
      msg.slice(0, 500),
      failingSince,
      muted,
    );
    return { source: source.id, ok: false, error: msg };
  }
}

/** One cron tick: run the sources that are due, oldest first, up to the per-run budget. */
export async function tick(env: Env, now: number, opts: { all?: boolean; only?: string } = {}) {
  const db = new Db(env.DB);
  const states = await db.all<SourceState>('SELECT source_id, next_run, failing_since, muted FROM source_state');
  const byId = new Map(states.map((s) => [s.source_id, s]));
  let due = enabledSources()
    .filter((s) => (opts.only ? s.id === opts.only : true))
    .filter((s) => opts.all || opts.only || (byId.get(s.id)?.next_run ?? 0) <= now)
    .sort((a, b) => (byId.get(a.id)?.next_run ?? 0) - (byId.get(b.id)?.next_run ?? 0));
  const budget = parseInt(env.SOURCES_PER_RUN ?? '10', 10);
  if (!opts.all) due = due.slice(0, budget);
  const results = [];
  for (const s of due) results.push(await runSource(env, db, s, now));
  await maintenance(db, now);
  return results;
}

export async function maintenance(db: Db, now: number): Promise<void> {
  // Expire held items that nothing corroborated.
  const expired = await db.all<{ id: number; submitted_by: number | null }>(
    "SELECT id, submitted_by FROM items WHERE status = 'held' AND seen_at < ?",
    now - HOLD_HOURS * 3600,
  );
  for (const it of expired) {
    await db.setItemStatus(it.id, 'expired', `not corroborated within ${HOLD_HOURS}h`);
    const bots = await db.all<{ bot_id: number }>('SELECT DISTINCT bot_id FROM submissions WHERE item_id = ?', it.id);
    for (const b of bots) await adjustBotScore(db, b.bot_id, -1);
  }
  // Let Forkcast EIP-page misses be re-checked after a week.
  await db.run("DELETE FROM kv WHERE key LIKE 'forkcast:eip:%' AND value = 'none' AND updated_at < ?", now - 7 * 86400);
}
