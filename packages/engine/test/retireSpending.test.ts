import { describe, expect, it } from "vitest";
import { derive, fireBreakdown, fiLevels, run, type PlanState } from "../src";
import { START } from "./fixtures";

const plan = (over: Partial<PlanState> = {}): PlanState => ({
  version: 2, age: 30, retireAge: 60, healthcare: 0, currentInvestMonthly: 0,
  incomes: [],
  budget: [
    { id: "rent", name: "Rent", group: "Housing", amount: 2000, inRetirement: true },
    { id: "food", name: "Food", group: "Food", amount: 1000, inRetirement: true, essential: true },
    { id: "fun", name: "Fun", group: "Personal", amount: 500, inRetirement: true, essential: false },
    { id: "commute", name: "Commute", group: "Transportation", amount: 300, inRetirement: false },
  ],
  accounts: [], debts: [], goals: [], limits: [],
  plan: { steps: [], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.04, taxRate: 0, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  ...over,
});

describe("retirement spending: budget or a set amount", () => {
  it("adds up the budget's retirement items when no amount is set", () => {
    const d = derive(plan(), START);
    expect(d.retireSpendingSet).toBe(false);
    expect(d.retireMonthlyBudget).toBe(3500);
    expect(d.retireMonthly).toBe(3500);
    expect(run(plan(), START).fire).toBeCloseTo((3500 * 12) / 0.04, 6);
  });

  it("uses a set yearly amount instead, and still reports the budget's total", () => {
    const s = plan({ retireSpending: 60_000 });
    const d = derive(s, START);
    expect(d.retireSpendingSet).toBe(true);
    expect(d.retireMonthly).toBe(5000);
    expect(d.retireAnnual).toBe(60_000);
    expect(d.retireMonthlyBudget).toBe(3500);
    expect(run(s, START).fire).toBeCloseTo(60_000 / 0.04, 6);
  });

  it("treats 0 as not set", () => {
    expect(derive(plan({ retireSpending: 0 }), START).retireMonthly).toBe(3500);
  });

  it("applies the what-if spending change to the set amount", () => {
    const s = plan({ retireSpending: 60_000, whatif: { extra: 0, retDelta: 0, spendDelta: -0.1 } });
    expect(derive(s, START).retireAnnual).toBeCloseTo(54_000, 6);
    const b = fireBreakdown(s, run(s, START));
    expect(b.spending.map((x) => x.key)).toEqual(["set", "whatif"]);
    expect(b.spending[1]!.monthly).toBeCloseTo(-500, 6);
  });

  it("still subtracts Social Security from a set amount", () => {
    const s = plan({ retireSpending: 60_000, retirementIncome: [{ id: "ss", name: "Social Security", kind: "socialSecurity", monthly: 2000, startAge: 60 }] });
    expect(run(s, START).fire).toBeCloseTo((60_000 - 24_000) / 0.04, 6);
  });

  it("keeps Lean FI no higher than the set amount", () => {
    const s = plan({ retireSpending: 24_000 });
    const lean = fiLevels(s, run(s, START)).find((l) => l.key === "lean")!;
    expect(lean.monthly).toBe(2000);
  });
});
