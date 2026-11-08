import { describe, expect, it } from "vitest";
import { accountForecasts, derive, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

/** The sample plan with a spouse and their Roth IRA. */
function withSpouse(extra: Partial<PlanState> = {}): PlanState {
  const s = sampleState();
  return {
    ...s,
    spouse: { name: "Sam", age: 40 },
    accounts: [...s.accounts, { id: "sp-roth", name: "Sam Roth IRA", type: "roth", balance: 5000, owner: "spouse" }],
    ...extra,
  };
}

describe("spouse's IRA", () => {
  it("has its own limit: each IRA stays under its own cap, and both are filled", () => {
    const s = withSpouse({ incomes: sampleState().incomes.map((x) => ({ ...x, net: x.net * 3 })) });
    const o = run(s, START);
    const f = accountForecasts(s, derive(s, START), o.plan, o.d.r);
    const mine = f.find((a) => a.key === "ira")!;
    const theirs = f.find((a) => a.key === "iraSpouse")!;
    expect(theirs.accounts.map((a) => a.id)).toEqual(["sp-roth"]);
    expect(mine.accounts.some((a) => a.id === "sp-roth")).toBe(false);
    for (const yr of [2027, 2028]) {
      const a = mine.years.find((x) => x.year === yr)!;
      const b = theirs.years.find((x) => x.year === yr)!;
      expect(a.employee).toBeLessThanOrEqual(a.limit! + 0.01);
      expect(b.employee).toBeLessThanOrEqual(b.limit! + 0.01);
      expect(b.employee).toBeGreaterThan(b.limit! - 1);
    }
    // the IRA money in total is both
    o.plan.months.slice(0, 24).forEach((m, i) => {
      expect(mine.months[i]!.total + theirs.months[i]!.total).toBeCloseTo(m.alloc.ira, 9);
    });
  });

  it("changes nothing without a spouse: an account marked as theirs is then yours", () => {
    const base = sampleState();
    const s = { ...withSpouse(), spouse: undefined };
    const plain = { ...s, accounts: s.accounts.map((a) => ({ ...a, owner: undefined })) };
    expect(run(s, START).plan.months).toEqual(run(plain, START).plan.months);
    expect(run(base, START).plan.months[0]!.iraSpouse).toBeUndefined();
  });

  it("gets what you assign to it in the budget", () => {
    const s = withSpouse();
    s.budgetPlan = { start: "2026-11", startCash: 0, months: { "2026-12": { assigned: { "acct:sp-roth": 625 } } } };
    const o = run(s, START);
    expect(o.plan.months[1]!.iraSpouse).toBeCloseTo(625, 6);
  });

  it("uses last year's room January to April, from what they've put in", () => {
    const s = withSpouse({ contributed: { year: 2026, k401: 0, ira: 0, hsa: 0, iraSpouse: 7000 } });
    s.budgetPlan = {
      start: "2026-11",
      startCash: 0,
      months: { "2026-11": { assigned: { "acct:sp-roth": 0 } }, "2026-12": { assigned: { "acct:sp-roth": 0 } }, "2027-01": { assigned: { "acct:sp-roth": 800 } } },
    };
    const o = run(s, START);
    const jan = o.plan.months[2]!;
    expect(jan.iraSpouse).toBeCloseTo(800, 6);
    expect(jan.priorIraSpouse).toBeCloseTo(500, 6);
  });
});
