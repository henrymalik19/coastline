/** The pure part of lib/history.ts (no store), so it can be tested on its own. */
import { addMonths } from "@coastfi/engine";
import type { Checkin } from "@coastfi/schema";

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** "2026-11" → "2026-10" */
export const prevMonthKey = (k: string) => addMonths(k, -1);

export type HistoryPoint = { month: string; invested: number; /** What the month before's plan expected by the end of this one. */ expected?: number };

/** Month-end invested balances (past months), then this month as it is now. At most `max` months. */
export function investedHistory(checkins: Checkin[], invested: number, start: Date, max = 36): HistoryPoint[] {
  const now = monthKey(start);
  const from = addMonths(now, -(max - 1));
  const by = new Map(checkins.map((c) => [c.month, c]));
  const exp = (m: string) => by.get(prevMonthKey(m))?.expectedNextInvested;
  const past = checkins.filter((c) => c.month < now && c.month >= from).map((c) => ({ month: c.month, invested: c.invested, expected: exp(c.month) }));
  return [...past, { month: now, invested, expected: exp(now) }];
}

/**
 * Ahead of or behind the plan, over the months on record: each finished month's end balance against
 * what the month before expected (that month's plan, from its real balance). Added up, so one month
 * doesn't decide it. Null until two months in a row are on record.
 */
export function vsPlan(checkins: Checkin[], start: Date): { total: number; last: number; lastMonth: string; since: string; months: number } | null {
  const now = monthKey(start);
  const by = new Map(checkins.map((c) => [c.month, c]));
  let total = 0;
  let months = 0;
  let last = 0;
  let lastMonth = "";
  let since = "";
  for (const c of checkins) {
    if (c.month >= now) continue;
    const before = by.get(prevMonthKey(c.month));
    if (!before) continue;
    const diff = c.invested - before.expectedNextInvested;
    total += diff;
    months++;
    if (!since) since = c.month;
    if (c.month > lastMonth) {
      lastMonth = c.month;
      last = diff;
    }
  }
  return months ? { total, last, lastMonth, since, months } : null;
}

export type Streak = { n: number; thisMonth: boolean; last12: { key: string; done: boolean }[]; kind: "budget" | "tracked" };

/** Months in a row in `keys`, counting back from this month (or last month, while this one is still going). */
export function streakFrom(keys: Set<string>, start: Date, kind: Streak["kind"]): Streak {
  const cur = monthKey(start);
  let k = keys.has(cur) ? cur : prevMonthKey(cur);
  let n = 0;
  while (keys.has(k)) {
    n++;
    k = prevMonthKey(k);
  }
  const last12: Streak["last12"] = [];
  let j = cur;
  for (let i = 0; i < 12; i++) {
    last12.unshift({ key: j, done: keys.has(j) });
    j = prevMonthKey(j);
  }
  return { n, thisMonth: keys.has(cur), last12, kind };
}
