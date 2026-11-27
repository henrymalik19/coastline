/**
 * Retiring before 59½: 401(k)s and IRAs can't be touched without a 10% penalty until then, so the
 * years in between are paid from money you can reach early: your brokerage, what you've put into a Roth IRA
 * (so far, as you entered it, and from now on: contributions, not growth, come out any time), and cash
 * beyond your emergency fund. Early-withdrawal rules (72(t)) aren't counted.
 * Today's dollars; the brokerage money isn't grown during those years (a little conservative).
 */
import { accountForecasts, accountGroup } from "./forecast";
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
  brokerage: number;
  /** What you've put into a Roth IRA: so far (as you entered it) plus what your plan adds until you retire. Contributions come out any time. */
  rothContrib: number;
  /** Of `rothContrib`, what you'd put in before today (Account.contributions). */
  rothSoFar: number;
  /** Cash beyond your emergency fund when you retire. */
  spareCash: number;
  /** All of it: brokerage + Roth IRA contributions + spare cash. */
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
  const forecasts = accountForecasts(s, d, o.plan, d.r);
  const taxable = forecasts.find((a) => a.key === "taxable");
  const brokerage = taxable ? (M > 0 ? (taxable.months[M - 1]?.balance ?? taxable.start) : taxable.start) : 0;
  // IRA money counts only when your IRAs are Roth (a traditional IRA is locked like a 401(k))
  const iras = (s.accounts ?? []).filter((a) => accountGroup(a) === "ira");
  const roth = iras.length > 0 && iras.every((a) => a.type === "roth");
  const rothSoFar = roth ? iras.reduce((t, a) => t + Math.max(0, Math.min(num(a.contributions), num(a.balance))), 0) : 0;
  const rothContrib =
    rothSoFar +
    (roth ? forecasts.filter((a) => a.key === "ira" || a.key === "iraSpouse").reduce((t, a) => t + a.months.slice(0, M).reduce((x, m) => x + m.plan + m.paycheck, 0), 0) : 0);
  const cashThen = M > 0 ? (o.plan.months[M - 1]?.cash ?? 0) : 0;
  const spareCash = Math.max(0, cashThen - Math.max(0, num(o.plan.fullTarget)));
  const reachable = brokerage + rothContrib + spareCash;
  const short = Math.max(0, need - reachable);
  const f = monthlyGrowthFactor(Math.pow(1 + d.r, 1 / 12) - 1, M);
  return { years, spending, income, health, mortgage, need, brokerage, rothContrib, rothSoFar, spareCash, reachable, short, extraMonthly: short > 0.5 && f > 0 ? Math.ceil(short / f) : 0 };
}
