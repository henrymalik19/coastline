/**
 * Retiring before 59½: 401(k)s and IRAs can't be touched without a 10% penalty until then, so the
 * years in between are paid from money you can reach early. Here that's your brokerage (taxable)
 * accounts only: Roth contributions, cash and the other early-access rules aren't counted.
 * Today's dollars; the brokerage money isn't grown during those years (a little conservative).
 */
import { accountForecasts } from "./forecast";
import { monthlyGrowthFactor } from "./howTo";
import type { PlanState, RunResult } from "./types";
import { num } from "./util";

/** The age 401(k)s and IRAs open without a penalty. */
export const ACCESS_AGE = 59.5;

export type EarlyAccess = {
  /** Years from retiring until 59½. */
  years: number;
  /** What you'll spend in those years. */
  spending: number;
  /** Social Security, pensions and rent that come in during those years. */
  income: number;
  /** Health insurance until then, beyond what you'd pay on Medicare. */
  health: number;
  /** Mortgage payments left after you retire (your number covers them). A little high: some come after 59½. */
  mortgage: number;
  /** What you need you can reach early: spending − income + health + mortgage. */
  need: number;
  /** Your brokerage on your plan when you retire. */
  reachable: number;
  /** need − reachable, at least 0. */
  short: number;
  /** More into brokerage a month from now until you retire to cover what's short (0 when nothing is). */
  extraMonthly: number;
};

/** The before-59½ check, or null when you retire at 59½ or later (or already have). */
export function earlyAccess(s: PlanState, o: Pick<RunResult, "d" | "plan" | "homeBridge">): EarlyAccess | null {
  const d = o.d;
  const years = ACCESS_AGE - d.retireAge;
  if (!(years > 0) || d.years <= 0) return null;
  const spending = d.retireAnnual * years;
  // each income counts for the part of those years after it starts
  const income =
    (s.retirementIncome ?? []).reduce((a, x) => a + Math.max(0, num(x.monthly)) * 12 * Math.max(0, ACCESS_AGE - Math.max(d.retireAge, num(x.startAge))), 0) +
    Math.max(0, d.rentalIncomeAnnual) * years;
  // your own insurance until Medicare costs more than Medicare: the difference, for these years
  const health = s.medicare === undefined ? 0 : Math.max(0, num(s.healthcare) - Math.max(0, num(s.medicare))) * 12 * years;
  const mortgage = Math.max(0, o.homeBridge);
  const need = Math.max(0, spending - income) + health + mortgage;
  const M = d.years * 12;
  const taxable = accountForecasts(s, d, o.plan, d.r).find((a) => a.key === "taxable");
  const reachable = taxable ? (M > 0 ? (taxable.months[M - 1]?.balance ?? taxable.start) : taxable.start) : 0;
  const short = Math.max(0, need - reachable);
  const f = monthlyGrowthFactor(Math.pow(1 + d.r, 1 / 12) - 1, M);
  return { years, spending, income, health, mortgage, need, reachable, short, extraMonthly: short > 0.5 && f > 0 ? Math.ceil(short / f) : 0 };
}
