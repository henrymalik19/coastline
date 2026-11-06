import { PERIODS } from "./constants";
import type { Income } from "./types";
import { parseDate } from "./util";

const DAY = 86400000;

/**
 * Paychecks an income source lands in calendar month (year, month0).
 * Weekly/biweekly step 7/14 days from `nextPayday`; semimonthly = 2, monthly = 1;
 * no anchor date: the average (periods / 12).
 */
export function checksInMonth(inc: Pick<Income, "freq" | "nextPayday">, y: number, mo: number): number {
  const f = inc.freq;
  if (f === "monthly") return 1;
  if (f === "semimonthly") return 2;
  const step = (f === "weekly" ? 7 : 14) * DAY;
  const anchor = parseDate(inc.nextPayday);
  if (anchor === null) return PERIODS[f] / 12;
  const a = Date.UTC(y, mo, 1);
  const b = Date.UTC(y, mo + 1, 1);
  const first = anchor + Math.ceil((a - anchor) / step) * step;
  return first >= b ? 0 : Math.floor((b - 1 - first) / step) + 1;
}
