import fc from "fast-check";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { DEFAULT_LIMITS } from "../src";
import type { BaseStepKey, Income, PayFreq, PlanState, StepKey } from "../src";

/** Fixed start date for every test (PLAN.md §9). Local midnight, like the prototype's `new Date()`. */
export const START = new Date(2026, 10, 6);

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const ref: any = require(fileURLToPath(new URL("../../../reference/engine.js", import.meta.url)));

/** A realistic single-earner plan, used for snapshot and parity tests. */
export function sampleState(): PlanState {
  return {
    version: 2,
    age: 32,
    retireAge: 60,
    healthcare: 600,
    currentInvestMonthly: 300,
    incomes: [
      {
        id: "inc1", name: "Main job", freq: "biweekly", net: 2400, nextPayday: "2026-11-13",
        matchMode: "pct", gross: 3500, contribPct: 0.04,
        matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02,
      },
    ],
    budget: [
      { id: "b1", name: "Rent", amount: 1600, inRetirement: true },
      { id: "b2", name: "Groceries", amount: 500, inRetirement: true },
      { id: "b3", name: "Utilities", amount: 220, inRetirement: true },
      { id: "b4", name: "Car & transport", amount: 350, inRetirement: true },
      { id: "b5", name: "Fun", amount: 300, inRetirement: true },
      { id: "b6", name: "Student loan extra / misc", amount: 150, inRetirement: false },
    ],
    accounts: [
      { id: "a1", name: "401(k)", type: "pretax", balance: 42000 },
      { id: "a2", name: "Roth IRA", type: "roth", balance: 12000 },
      { id: "a3", name: "Brokerage", type: "taxable", balance: 3000 },
      { id: "a4", name: "Checking + savings", type: "cash", balance: 2500 },
    ],
    debts: [
      { id: "d1", name: "Credit card", balance: 3200, apr: 0.24, minPayment: 90 },
      { id: "d2", name: "Car loan", balance: 9000, apr: 0.065, minPayment: 280 },
      { id: "d3", name: "Student loan", balance: 14000, apr: 0.045, minPayment: 160 },
    ],
    goals: [{ id: "g1", name: "Vacation", target: 2500, saved: 300 }],
    limits: DEFAULT_LIMITS,
    plan: {
      steps: ["starterEF", "match", "highDebt", "fullEF", "goal:g1", "hsa", "ira", "k401", "lowDebt", "taxable"],
      starterEF: 2000, efMonths: 3, highApr: 0.07, marginalTax: 0.22,
      hsaEligible: true, hsaFamily: false, projectWith: "plan",
    },
    ret: 0.05, vol: 0.15, fee: 0.001, swr: 0.035, taxRate: 0.12, contribGrowth: 0,
    whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  };
}

/* ---------- random states for property tests ---------- */

const money = (max: number) => fc.integer({ min: 0, max: max * 100 }).map((c) => c / 100);
const rate = (min: number, max: number) => fc.integer({ min: Math.round(min * 1e4), max: Math.round(max * 1e4) }).map((b) => b / 1e4);
const FREQS: PayFreq[] = ["weekly", "biweekly", "semimonthly", "monthly"];
const BASE_STEPS: BaseStepKey[] = ["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "k401", "lowDebt", "taxable"];
const isoDay = fc.integer({ min: 0, max: 60 }).map((n) => new Date(Date.UTC(2026, 10, 1 + n)).toISOString().slice(0, 10));

const incomeArb = (i: number): fc.Arbitrary<Income> =>
  fc.record({
    freq: fc.constantFrom(...FREQS),
    net: money(6000),
    nextPayday: fc.option(isoDay, { nil: undefined }),
    pct: fc.boolean(),
    gross: money(9000),
    contribPct: rate(0, 0.15),
    matchRate1: rate(0, 1),
    matchUpTo1: rate(0, 0.06),
    matchRate2: rate(0, 1),
    matchUpTo2: rate(0, 0.04),
    pretax: money(1500),
    match: money(500),
    fullMatch: fc.boolean(),
  }).map(({ pct, ...r }) => ({
    id: `inc${i}`, name: `Income ${i}`, freq: r.freq, net: r.net, nextPayday: r.nextPayday,
    ...(pct
      ? { matchMode: "pct" as const, gross: r.gross, contribPct: r.contribPct, matchRate1: r.matchRate1, matchUpTo1: r.matchUpTo1, matchRate2: r.matchRate2, matchUpTo2: r.matchUpTo2 }
      : { matchMode: "usd" as const, pretax: r.pretax, match: r.match, fullMatch: r.fullMatch }),
  }));

const indexed = <T>(max: number, f: (i: number) => fc.Arbitrary<T>) =>
  fc.integer({ min: 0, max }).chain((n) => (n === 0 ? fc.constant([] as T[]) : fc.tuple(...Array.from({ length: n }, (_, i) => f(i)))));

export const stateArb: fc.Arbitrary<PlanState> = fc
  .record({
    age: fc.integer({ min: 20, max: 62 }),
    yearsToRetire: fc.integer({ min: 0, max: 35 }),
    healthcare: money(1500),
    currentInvestMonthly: money(3000),
    incomes: indexed(2, incomeArb),
    budget: indexed(4, (i) => fc.record({ id: fc.constant(`b${i}`), name: fc.constant(`Item ${i}`), amount: money(3000), inRetirement: fc.boolean() })),
    accounts: indexed(4, (i) =>
      fc.record({ id: fc.constant(`a${i}`), name: fc.constant(`Acct ${i}`), type: fc.constantFrom("pretax", "roth", "taxable", "hsa", "cash" as const), balance: money(200000) }),
    ),
    debts: indexed(3, (i) =>
      fc.record({ id: fc.constant(`d${i}`), name: fc.constant(`Debt ${i}`), balance: money(30000), apr: rate(0, 0.3), minPayment: money(500) }),
    ),
    goals: indexed(2, (i) => fc.record({ id: fc.constant(`g${i}`), name: fc.constant(`Goal ${i}`), target: money(20000), saved: money(5000) })),
    steps: fc.shuffledSubarray(BASE_STEPS),
    goalsInPlan: fc.boolean(),
    starterEF: money(3000),
    efMonths: fc.integer({ min: 0, max: 9 }),
    highApr: rate(0, 0.15),
    marginalTax: rate(0, 0.45),
    hsaEligible: fc.boolean(),
    hsaFamily: fc.boolean(),
    projectWith: fc.constantFrom("plan", "current" as const),
    ret: rate(0, 0.08),
    vol: rate(0, 0.25),
    fee: rate(0, 0.01),
    swr: rate(0.025, 0.05),
    taxRate: rate(0, 0.3),
    contribGrowth: rate(0, 0.03),
    extra: fc.integer({ min: -500, max: 1000 }),
    retDelta: rate(-0.02, 0.02),
    spendDelta: rate(-0.2, 0.2),
  })
  .map((r) => {
    const steps: StepKey[] = [...r.steps];
    if (r.goalsInPlan) r.goals.forEach((g, i) => steps.splice(Math.min(i + 1, steps.length), 0, `goal:${g.id}`));
    return {
      version: 2,
      age: r.age,
      retireAge: r.age + r.yearsToRetire,
      healthcare: r.healthcare,
      currentInvestMonthly: r.currentInvestMonthly,
      incomes: r.incomes,
      budget: r.budget,
      accounts: r.accounts,
      debts: r.debts,
      goals: r.goals,
      limits: DEFAULT_LIMITS,
      plan: {
        steps, starterEF: r.starterEF, efMonths: r.efMonths, highApr: r.highApr, marginalTax: r.marginalTax,
        hsaEligible: r.hsaEligible, hsaFamily: r.hsaFamily, projectWith: r.projectWith,
      },
      ret: r.ret, vol: r.vol, fee: r.fee, swr: r.swr, taxRate: r.taxRate, contribGrowth: r.contribGrowth,
      whatif: { extra: r.extra, retDelta: r.retDelta, spendDelta: r.spendDelta },
    } satisfies PlanState;
  });
