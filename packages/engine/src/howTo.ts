/**
 * How you get there: what your plan invests now, how much more a month reaches your FIRE number by
 * your retirement age (or your Coast number by an earlier age), and the age your plan gets there as is.
 * The "more a month" amounts assume each extra dollar is invested every month and grows at your
 * return after inflation, like the forecast's own monthly growth.
 */
import { coastNumberAt } from "./project";
import { finalAndFire } from "./run";
import type { PlanState, RunResult } from "./types";

/** What $1 a month, invested at the end of each month for `months`, is worth then. */
export function monthlyGrowthFactor(r: number, months: number): number {
  if (months <= 0) return 0;
  const rm = Math.pow(1 + r, 1 / 12) - 1;
  return Math.abs(rm) < 1e-12 ? months : (Math.pow(1 + rm, months) - 1) / rm;
}

/** About what the plan invests a month over the next year (your money, your employer's match, 401(k) and HSA from pay). */
export function investingNow(o: Pick<RunResult, "plan">): number {
  const ms = o.plan.months.slice(0, 12);
  return ms.length ? ms.reduce((a, m) => a + m.pre + m.post, 0) / ms.length : 0;
}

/** More to invest each month from now until retirement so the plan reaches the FIRE number (0 when it already does). */
export function extraToRetire(o: Pick<RunResult, "d" | "fire" | "projectedFinal">): number {
  const months = o.d.years * 12;
  const gap = o.fire - o.projectedFinal;
  if (gap <= 0.5) return 0;
  const f = monthlyGrowthFactor(o.d.r, months);
  return f > 0 ? gap / f : Infinity;
}

/**
 * More to invest each month for the next `months` so you reach Coast FI then: after that, what you have
 * grows into your FIRE number by retirement without adding more. 0 when the plan already gets there.
 */
export function extraToCoastBy(o: Pick<RunResult, "d" | "fire" | "projSeries">, months: number): number {
  const M = o.d.years * 12;
  const k = Math.max(0, Math.min(M, Math.round(months)));
  const need = coastNumberAt(o.fire, o.d.r, (M - k) / 12);
  const gap = need - (o.projSeries[k] ?? 0);
  if (gap <= 0.5) return 0;
  const f = monthlyGrowthFactor(o.d.r, k);
  return f > 0 ? gap / f : Infinity;
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
