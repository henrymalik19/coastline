import type { PlanState } from "@coastfi/engine";
import { DEFAULT_LIMITS } from "@coastfi/engine";

/** The prototype's sample plan (reference/index.html SAMPLE), with ids. Used for demos and first run. */
export function samplePlanState(): PlanState {
  return {
    version: 2,
    age: 30,
    retireAge: 60,
    healthcare: 600,
    currentInvestMonthly: 433,
    contribGrowth: 0,
    incomes: [
      {
        id: "i1", name: "Main job", freq: "biweekly", net: 2400, nextPayday: "2026-11-13",
        matchMode: "pct", gross: 3500, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02,
      },
      { id: "i2", name: "Side gig", freq: "monthly", net: 600, matchMode: "usd", pretax: 0, match: 0, fullMatch: true },
    ],
    budget: [
      { id: "b1", name: "Rent / mortgage", amount: 1800, inRetirement: true },
      { id: "b2", name: "Groceries", amount: 600, inRetirement: true },
      { id: "b3", name: "Transportation", amount: 400, inRetirement: true },
      { id: "b4", name: "Utilities & phone", amount: 250, inRetirement: true },
      { id: "b5", name: "Insurance", amount: 200, inRetirement: true },
      { id: "b6", name: "Fun & dining", amount: 400, inRetirement: true },
      { id: "b7", name: "Subscriptions", amount: 80, inRetirement: true },
    ],
    debts: [
      { id: "d1", name: "Credit card", balance: 3500, apr: 0.229, minPayment: 100 },
      { id: "d2", name: "Student loan", balance: 18000, apr: 0.055, minPayment: 300 },
    ],
    goals: [{ id: "g1", name: "House down payment", target: 30000, saved: 2000 }],
    accounts: [
      { id: "a1", name: "401(k)", type: "pretax", balance: 45000 },
      { id: "a2", name: "Roth IRA", type: "roth", balance: 18000 },
      { id: "a3", name: "Brokerage", type: "taxable", balance: 12000 },
      { id: "a4", name: "High-yield savings", type: "cash", balance: 15000 },
    ],
    limits: structuredClone(DEFAULT_LIMITS),
    plan: {
      steps: ["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "goal:g1", "k401", "lowDebt", "taxable"],
      starterEF: 2000, efMonths: 4, highApr: 0.07, marginalTax: 0.22, hsaEligible: false, hsaFamily: false, projectWith: "plan",
    },
    ret: 0.05, vol: 0.15, fee: 0.001, swr: 0.035, taxRate: 0.12,
    whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  };
}
