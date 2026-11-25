import { BOT_BLOCKED_SCORE, BOT_TRUSTED_SCORE } from './config/rules';
import type { Db } from './db';

export async function adjustBotScore(db: Db, botId: number, delta: number): Promise<void> {
  await db.run('UPDATE bots SET score = score + ? WHERE id = ?', delta, botId);
  // A probation bot becomes trusted at the trusted score. Any bot is blocked at the blocked score.
  await db.run(
    "UPDATE bots SET standing = CASE WHEN score <= ? THEN 'blocked' WHEN score >= ? AND standing = 'probation' THEN 'trusted' ELSE standing END WHERE id = ?",
    BOT_BLOCKED_SCORE,
    BOT_TRUSTED_SCORE,
    botId,
  );
}
