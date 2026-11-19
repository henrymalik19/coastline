/**
 * How you get there: what your plan invests now (and when it starts, if not yet), how much more a month
 * reaches your FIRE number by your retirement age (or your Coast number by an earlier age), the age your
 * plan gets there as is, and what paying off a mortgage by retirement takes.
 * The "more a month" amounts run the real forecast: the extra follows your plan's steps like any money
 * (a high-interest debt or the emergency fund may come first), so the answer matches the chart.
 */
import { coastNumberAt } from "./project";
import { finalAndFire } from "./run";
import type { PlanState, RunResult } from "./types";
import { num } from "./util";

/** What $1 a month, put in at the end of each month for `months`, is worth then at `monthlyRate`. */
export function monthlyGrowthFactor(monthlyRate: number, months: number): number {
  if (months <= 0) return 0;
  return Math.abs(monthlyRate) < 1e-12 ? months : (Math.pow(1 + monthlyRate, months) - 1) / monthlyRate;
}

/** About what the plan invests a month over the next year (your money, your employer's match, 401(k) and HSA from pay). */
export function investingNow(o: Pick<RunResult, "plan">): number {
  const ms = o.plan.months.slice(0, 12);
  return ms.length ? ms.reduce((a, m) => a + m.pre + m.post, 0) / ms.length : 0;
}

/** The first month (0 = this one) your plan puts money into investments, or null if it never does before you retire. */
export function investingStarts(o: Pick<RunResult, "plan" | "d">): number | null {
  const M = Math.max(1, o.d.years * 12);
  for (let k = 0; k < Math.min(M, o.plan.months.length); k++) {
    const m = o.plan.months[k]!;
    if (m.pre + m.post > 0.5) return k;
  }
  return null;
}

/** The least whole dollars a month (up to a cap) for which `ok` holds; 0 when it already does, Infinity if never. */
function leastMonthly(ok: (x: number) => boolean, cap = 1_000_000): number {
  if (ok(0)) return 0;
  let lo = 0;
  let hi = 250;
  while (!ok(hi)) {
    lo = hi;
    hi *= 2;
    if (hi > cap) return Infinity;
  }
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (ok(mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** More a month toward your plan, from now until you retire, so it reaches the FIRE number then (0 when it already does). */
export function extraToRetire(s: PlanState, startDate: Date): number {
  const M = finalAndFire(s, startDate).d.years * 12;
  if (M <= 0) return 0;
  return leastMonthly((x) => {
    const r = finalAndFire(s, startDate, x > 0 ? { amount: x, months: M } : undefined);
    return r.final + 0.5 >= r.fire;
  });
}

/**
 * More a month toward your plan for the next `months`, so you reach Coast FI then: after that, what you
 * have grows into your FIRE number by retirement on its own. 0 when the plan already gets there.
 */
export function extraToCoastBy(s: PlanState, startDate: Date, months: number): number {
  const M = finalAndFire(s, startDate).d.years * 12;
  const k = Math.max(0, Math.min(M, Math.round(months)));
  if (k <= 0) return 0;
  return leastMonthly((x) => {
    const r = finalAndFire(s, startDate, x > 0 ? { amount: x, months: k } : undefined);
    return (r.series[k] ?? 0) + 0.5 >= coastNumberAt(r.fire, r.d.r, (M - k) / 12);
  });
}

/**
 * The first whole age, up to `maxAge`, at which your plan as it is (still saving until then) reaches its
 * FIRE number at that age. Your retirement age when it already does; null when no age up to `maxAge` does.
 */
export function retireAgeOnPlan(s: PlanState, startDate: Date, maxAge = 75): number | null {
  const from = Math.round(s.retireAge);
  for (let a = from; a <= Math.max(from, maxAge); a++) {
    const x = finalAndFire({ ...s, retireAge: a }, startDate);
    if (x.final + 0.5 >= x.fire) return a;
  }
  return null;
}

export type MortgagePayoff = { id: string; name: string; owedAtRetire: number; extra: number };

/**
 * Each mortgage still owed when you retire: how much more a month on the loan, from now until then,
 * pays it off by then (an extra dollar on the loan saves its interest, so it counts for more than a dollar).
 * Paying it off takes what's owed then out of your FIRE number.
 */
export function mortgagePayoffs(s: PlanState, o: Pick<RunResult, "d" | "mortgagesAtRetire">): MortgagePayoff[] {
  const M = o.d.years * 12;
  if (M <= 0) return [];
  return o.mortgagesAtRetire.map((x) => {
    const apr = num((s.debts ?? []).find((y) => y.id === x.id)?.apr);
    return { id: x.id, name: x.name, owedAtRetire: x.balance, extra: Math.ceil(x.balance / monthlyGrowthFactor(apr / 12, M)) };
  });
}
