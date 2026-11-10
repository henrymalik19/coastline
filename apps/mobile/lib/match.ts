import type { Income } from "@coastfi/engine";

/**
 * The employer puts in something: a % of pay match with a rate above 0, or a typed $ match.
 * With no match there's nothing to get or miss (even if a "match up to" % is still filled in).
 */
export function offersMatch(inc: Income): boolean {
  if (inc.matchMode === "pct") return (inc.matchRate1 ?? 0) > 0 || (inc.matchRate2 ?? 0) > 0;
  return (inc.match ?? 0) > 0 || inc.fullMatch === false;
}

/** Missing part of a match the employer offers. */
export const missingMatch = (inc: Income, fullMatch: boolean) => offersMatch(inc) && !fullMatch;
