import { describe, expect, it } from "vitest";
import { investFromTakeHome, type PlanState } from "../src";

const s = (over: Partial<PlanState>) =>
  ({
    plan: { steps: [], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
    accounts: [
      { id: "roth", name: "Roth IRA", type: "roth", balance: 0 },
      { id: "brk", name: "Brokerage", type: "taxable", balance: 0 },
      { id: "sav", name: "Savings", type: "cash", balance: 0 },
      { id: "k", name: "Work 401(k)", type: "pretax", balance: 0 },
    ],
    budget: [],
    currentInvestMonthly: 0,
    ...over,
  }) as PlanState;

describe("what you invest yourself from take-home pay", () => {
  it("uses the amount you typed", () => {
    expect(investFromTakeHome(s({ currentInvestMonthly: 250 }))).toEqual({ monthly: 250, fromBudget: false });
  });

  it("otherwise adds up the budget's investing categories (IRA, brokerage), not savings or the 401(k)", () => {
    const r = investFromTakeHome(
      s({
        budget: [
          { id: "1", name: "Roth IRA", group: "Savings", amount: 300, inRetirement: false, accountId: "roth" },
          { id: "2", name: "Invest", group: "Savings", amount: 100, inRetirement: false, accountId: "brk" },
          { id: "3", name: "Rainy day", group: "Savings", amount: 200, inRetirement: false, accountId: "sav" },
          { id: "4", name: "Groceries", group: "Food", amount: 500, inRetirement: true },
        ],
      }),
    );
    expect(r).toEqual({ monthly: 400, fromBudget: true });
  });

  it("is $0 when neither is set", () => {
    expect(investFromTakeHome(s({}))).toEqual({ monthly: 0, fromBudget: false });
  });
});
