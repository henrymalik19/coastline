import type { Limits, LimitsRow } from "./types";

const ZERO: Limits = { k401: 0, k401Catch: 0, ira: 0, iraCatch: 0, hsaSelf: 0, hsaFamily: 0, hsaCatch: 0 };

/** Limits for a calendar year: exact row, else the latest earlier row, else the earliest row. */
export function limitsFor(limits: readonly LimitsRow[] | undefined, year: number): Limits {
  const rows = [...(limits ?? [])].sort((a, b) => a.year - b.year);
  if (!rows.length) return ZERO;
  let best = rows[0]!;
  for (const r of rows) if (r.year <= year) best = r;
  return best;
}

/** Default limits (PLAN.md §4.2). 2027 401(k)/IRA copy 2026 until the IRS announces them. */
export const DEFAULT_LIMITS: LimitsRow[] = [
  { year: 2026, k401: 24500, k401Catch: 8000, ira: 7500, iraCatch: 1100, hsaSelf: 4400, hsaFamily: 8750, hsaCatch: 1000 },
  { year: 2027, k401: 24500, k401Catch: 8000, ira: 7500, iraCatch: 1100, hsaSelf: 4500, hsaFamily: 9000, hsaCatch: 1000 },
];
