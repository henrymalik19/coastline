import type { Derived, PlanResult, Projection } from "./types";

/** Deterministic monthly projection in two buckets: pre-tax vs. Roth/taxable/HSA. */
export function project(d: Derived, plan: PlanResult, r: number): Projection {
  const M = d.years * 12;
  const rm = Math.pow(1 + r, 1 / 12) - 1;
  let pre = d.bal.pretax;
  let post = d.bal.roth + d.bal.taxable + d.bal.hsa;
  const series = new Float64Array(M + 1);
  series[0] = pre + post;
  for (let k = 1; k <= M; k++) {
    const mm = plan.months[k - 1]!;
    pre = pre * (1 + rm) + mm.pre;
    post = post * (1 + rm) + mm.post;
    series[k] = pre + post;
  }
  const total = pre + post;
  return { series, final: total, preShareFinal: total > 0 ? pre / total : 0 };
}

/**
 * FIRE number = (spending not covered by retirement income / swr + bridge) / (1 - taxRate x pre-tax share).
 * Retirement income (Social Security, pensions) lowers the yearly spending the portfolio must cover;
 * income that starts after you retire is covered from savings until it does (the bridge).
 */
export function fireNumber(
  d: Pick<Derived, "retireAnnual" | "taxRate" | "swr"> & Partial<Pick<Derived, "retireIncomeAnnual" | "retireBridge">>,
  preShare: number,
): number {
  const need = Math.max(0, d.retireAnnual - (d.retireIncomeAnnual ?? 0));
  const gross = 1 - d.taxRate * preShare;
  // same operation order as the prototype when there is no retirement income (exact parity)
  return need / gross / d.swr + (d.retireBridge ?? 0) / gross;
}

/** Balance needed now so growth alone reaches `fire` in `yearsLeft`. */
export function coastNumberAt(fire: number, r: number, yearsLeft: number): number {
  return fire / Math.pow(1 + r, Math.max(0, yearsLeft));
}

/** Years from start until the projection first meets the coast number, or null. */
export function coastCrossing(proj: Projection, d: Pick<Derived, "years">, fire: number, r: number): number | null {
  const M = d.years * 12;
  for (let k = 0; k <= M; k++) if (proj.series[k]! >= coastNumberAt(fire, r, (M - k) / 12)) return k / 12;
  return null;
}
