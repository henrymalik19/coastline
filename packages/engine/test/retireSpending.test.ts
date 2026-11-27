import { describe, expect, it } from "vitest";
import { averageSpent, derive, fireBreakdown, fiLevels, run, type PlanState } from "../src";
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

describe("what each category costs in retirement", () => {
  it("its own retirement amount, else its plan amount", () => {
    const p = plan();
    p.budget[1]!.retireAmount = 600; // food for two instead of four
    const d = derive(p, START);
    expect(d.retireItems).toEqual({ rent: 2000, food: 600, fun: 500 });
    expect(d.retireMonthlyBudget).toBe(3100);
  });

  it("or what you assigned it this month on the Budget, when you choose that", () => {
    const ym = `${START.getFullYear()}-${String(START.getMonth() + 1).padStart(2, "0")}`;
    const p = plan({ retireAmountsFrom: "assigned", budgetPlan: { start: ym, startCash: 0, months: { [ym]: { assigned: { rent: 1800, food: 900 } } } } });
    p.budget[2]!.retireAmount = 400;
    expect(derive(p, START).retireItems).toEqual({ rent: 1800, food: 900, fun: 400 });
  });
});

describe("a category that pays a debt", () => {
  it("isn't counted again as spending: the debt counts from Debts, now and in retirement", () => {
    const debts = [{ id: "m", name: "Mortgage", kind: "mortgage" as const, balance: 200000, apr: 0.06, minPayment: 1500 }];
    const without = derive(plan({ debts }), START);
    const p = plan({ debts });
    p.budget.push({ id: "piti", name: "PITI", group: "Home", amount: 1500, inRetirement: true, paysDebt: "m" });
    const d = derive(p, START);
    expect(d.retireMonthlyBudget).toBe(without.retireMonthlyBudget);
    expect(d.monthlyExpenses).toBe(without.monthlyExpenses);
    expect(d.retireItems.piti).toBeUndefined();
  });
});

describe("what you've spent lately (12-month average)", () => {
  const t = (id: string, date: string, amount: number, categoryId: string, accountId = "chk") => ({ id, accountId, date, amount, categoryId, cleared: "cleared" as const, source: "manual" as const, updatedAt: 1 });

  it("averages each category over the full months before this one, from the first month with transactions", () => {
    const txns = [
      t("start:chk", "2026-07-01", 5000, "ready"),
      t("a", "2026-08-03", -120, "food"),
      t("b", "2026-09-10", -90, "food"),
      t("c", "2026-10-02", -150, "food"),
      t("r", "2026-10-15", 30, "food"), // a refund
      t("d", "2026-10-20", -60, "fun"),
      t("now", "2026-11-02", -999, "food"), // this month: not a full month yet
      { ...t("gone", "2026-09-11", -500, "food"), deleted: true },
    ];
    const a = averageSpent(txns, "2026-11", {});
    expect(a.months).toBe(3); // Aug, Sep, Oct
    expect(a.by).toEqual({ food: 110, fun: 20 }); // (120 + 90 + 150 − 30) ÷ 3, 60 ÷ 3
    // at most 12 months back: one older than that doesn't stretch it
    expect(averageSpent([t("old", "2024-01-05", -100, "food"), ...txns], "2026-11", {}).months).toBe(3);
    expect(averageSpent([t("yr", "2025-11-05", -100, "food"), ...txns], "2026-11", {}).months).toBe(12);
    expect(averageSpent([], "2026-11", {})).toEqual({ months: 0, by: {} });
  });

  it("a category set to its average uses it; nothing to average yet: its plan amount", () => {
    const p = plan({ spentAvg: { months: 6, by: { food: 640 } } });
    p.budget[1]!.retireFrom = "avg";
    p.budget[2]!.retireFrom = "avg"; // nothing spent on it lately: 0
    p.budget[0]!.retireAmount = 1500; // its own amount wins
    expect(derive(p, START).retireItems).toEqual({ rent: 1500, food: 640, fun: 0 });
    expect(derive({ ...p, spentAvg: { months: 0, by: {} } }, START).retireItems).toEqual({ rent: 1500, food: 1000, fun: 500 });
  });
});
