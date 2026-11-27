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

/**
 * Where investingNow goes, a typical month this year (the same 12 months): your 401(k) (from your paycheck
 * and any more your plan puts there), your employer's match, IRAs, HSA (yours and your employer's),
 * brokerage, and paying your own 401(k) loans back (its own payment, and any extra your plan sends to pay it
 * off early; both go back into your 401(k)). `other`: anything else, so it adds up.
 */
export type InvestingSplit = { k401: number; match: number; ira: number; hsa: number; taxable: number; loanBack: number; loanExtra: number; other: number };
export function investingSplit(o: Pick<RunResult, "plan">): InvestingSplit {
  const ms = o.plan.months.slice(0, 12);
  const out: InvestingSplit = { k401: 0, match: 0, ira: 0, hsa: 0, taxable: 0, loanBack: 0, loanExtra: 0, other: 0 };
  if (!ms.length) return out;
  for (const m of ms) {
    out.k401 += m.payPre + m.alloc.k401;
    out.match += m.payMatch;
    out.ira += m.alloc.ira;
    out.hsa += m.payHsa + m.payHsaEmployer + m.alloc.hsa;
    out.taxable += m.alloc.taxable;
    out.loanBack += m.loanBack - m.loanBackExtra;
    out.loanExtra += m.loanBackExtra;
  }
  const known = out.k401 + out.match + out.ira + out.hsa + out.taxable + out.loanBack + out.loanExtra;
  const total = ms.reduce((a, m) => a + m.pre + m.post, 0);
  out.other = Math.max(0, total - known);
  for (const k of Object.keys(out) as (keyof InvestingSplit)[]) out[k] /= ms.length;
  return out;
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

/** The first month (0 = now) your plan, investing until then, has enough to coast to your FIRE number. Null if never before you retire. */
function firstCoastMonth(s: PlanState, startDate: Date): { k: number | null; age: number } {
  const r = finalAndFire({ ...s, coastAge: undefined, whatif: { ...s.whatif, coastAge: undefined } }, startDate);
  const M = r.d.years * 12;
  for (let k = 0; k <= M; k++) if ((r.series[k] ?? 0) + 0.5 >= coastNumberAt(r.fire, r.d.r, (M - k) / 12)) return { k, age: r.d.age };
  return { k: null, age: r.d.age };
}

/**
 * Coast FI by `age`: by that birthday (when your plan would stop investing), what you'd have invested grows
 * into your FIRE number by retirement on its own.
 */
export function coastOk(s: PlanState, startDate: Date, age: number): boolean {
  const { k, age: now } = firstCoastMonth(s, startDate);
  return k !== null && now + k / 12 <= age + 1e-9;
}

/** The first birthday by which your plan has reached Coast FI (42 for 41 years 2 months): the age you could stop investing. Null when it doesn't before you retire. */
export function coastAgeOnPlan(s: PlanState, startDate: Date): number | null {
  const { k, age } = firstCoastMonth(s, startDate);
  return k === null ? null : Math.ceil(age + k / 12 - 1e-9);
}

/**
 * Ways to reach Coast FI by `age`, each enough on its own: invest more a month until then, spend less in
 * retirement (as a what-if spending change), or retire later. Null where it doesn't get there.
 */
export function coastWays(s: PlanState, startDate: Date, age: number): { extra: number; spendDelta: number | null; retireAge: number | null } {
  // by that birthday
  const months = Math.round((age - s.age) * 12);
  const extra = extraToCoastBy({ ...s, coastAge: undefined, whatif: { ...s.whatif, coastAge: undefined } }, startDate, months);
  const w = s.whatif ?? { extra: 0, retDelta: 0, spendDelta: 0 };
  const with_ = (x: Partial<PlanState["whatif"]>) => ({ ...s, whatif: { ...w, ...x } });
  // spending: the smallest cut that gets there (up to 80% less)
  let spendDelta: number | null = null;
  if (coastOk(with_({ spendDelta: -0.8 }), startDate, age)) {
    let lo = -0.8;
    let hi = 0;
    for (let i = 0; i < 16; i++) {
      const mid = (lo + hi) / 2;
      if (coastOk(with_({ spendDelta: mid }), startDate, age)) lo = mid;
      else hi = mid;
    }
    spendDelta = lo;
  }
  let retireAge: number | null = null;
  for (let a = Math.round(s.retireAge) + 1; a <= 75; a++) {
    if (coastOk(with_({ retireAge: a }), startDate, age)) {
      retireAge = a;
      break;
    }
  }
  return { extra, spendDelta, retireAge };
}

/**
 * The first whole age, up to `maxAge`, at which your plan as it is (still saving until then) reaches its
 * FIRE number at that age. Your retirement age when it already does; null when no age up to `maxAge` does.
 */
export function retireAgeOnPlan(s: PlanState, startDate: Date, maxAge = 75): number | null {
  const from = Math.round(s.retireAge);
  for (let a = from; a <= Math.max(from, maxAge); a++) {
    const x = finalAndFire({ ...s, retireAge: a, whatif: { ...s.whatif, retireAge: undefined } }, startDate);
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
