export const nowSec = (): number => Math.floor(Date.now() / 1000);

export function parseDate(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

export function ago(ts: number, now = nowSec()): string {
  const d = Math.max(0, now - ts);
  if (d < 3600) return `${Math.max(1, Math.floor(d / 60))}m`;
  if (d < 86400) return `${Math.floor(d / 3600)}h`;
  return `${Math.floor(d / 86400)}d`;
}

export function isoDate(ts: number): string {
  return new Date(ts * 1000).toISOString();
}

/** Day label in a given IANA time zone, e.g. "Tue 25 Nov". */
export function dayLabel(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ts * 1000));
}

export function dayKey(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts * 1000));
}
