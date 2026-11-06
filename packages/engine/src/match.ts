import type { Income, ResolvedIncome } from "./types";
import { num } from "./util";

type MatchTiers = Pick<Income, "matchRate1" | "matchUpTo1" | "matchRate2" | "matchUpTo2">;

/**
 * Employer match in $ for a contribution %, from a 2-tier formula
 * (e.g. 100% of the first 3% + 50% of the next 2%).
 */
export function matchFor(gross: number, pct: number, inc: MatchTiers): number {
  const r1 = num(inc.matchRate1);
  const u1 = num(inc.matchUpTo1);
  const r2 = num(inc.matchRate2);
  const u2 = num(inc.matchUpTo2);
  return gross * (r1 * Math.min(pct, u1) + r2 * Math.min(Math.max(pct - u1, 0), u2));
}

/** Per-check pre-tax, match, and the gap to the full match, from either % or $ entry. */
export function resolveIncome(inc: Income): ResolvedIncome {
  if (inc.matchMode === "pct" && num(inc.gross) > 0) {
    const gross = num(inc.gross);
    const pct = num(inc.contribPct);
    const maxPct = num(inc.matchUpTo1) + (num(inc.matchRate2) > 0 ? num(inc.matchUpTo2) : 0);
    const match = matchFor(gross, pct, inc);
    const fullMatchAmt = matchFor(gross, Math.max(pct, maxPct), inc);
    return {
      ...inc,
      pretax: gross * pct,
      match,
      maxPct,
      fullMatch: pct >= maxPct - 1e-9,
      gapPre: gross * Math.max(0, maxPct - pct),
      gapMatch: fullMatchAmt - match,
    };
  }
  return {
    ...inc,
    pretax: num(inc.pretax),
    match: num(inc.match),
    fullMatch: inc.fullMatch !== false,
    gapPre: 0,
    gapMatch: 0,
    maxPct: null,
  };
}
