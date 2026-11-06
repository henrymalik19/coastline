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

/** FIRE number = retirement spending / (1 - taxRate x pre-tax share) / swr. */
export function fireNumber(d: Pick<Derived, "retireAnnual" | "taxRate" | "swr">, preShare: number): number {
  return d.retireAnnual / (1 - d.taxRate * preShare) / d.swr;
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
