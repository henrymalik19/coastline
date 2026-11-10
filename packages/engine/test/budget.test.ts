import { describe, expect, it } from "vitest";
import { budgetCategories, budgetScheduleMonths, budgetStartCash, budgetView, derive, simulatePlan, type BudgetState, type PlanState } from "../src";
import { START } from "./fixtures";

const blank = (over: Partial<PlanState> = {}): PlanState => ({
  version: 2, age: 30, retireAge: 40, healthcare: 0, currentInvestMonthly: 0,
  incomes: [], budget: [], accounts: [], debts: [], goals: [], limits: [],
  plan: { steps: [], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.035, taxRate: 0, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  ...over,
});

const cats = [
  { key: "food", moves: false, target: 500 },
  { key: "rent", moves: false, target: 2000 },
  { key: "acct:ira", moves: true, target: 300 },
];

describe("monthly budget", () => {
  it("unspent money carries over; overspending comes out of next month's ready to assign", () => {
    const b: BudgetState = {
      start: "2026-11",
      startCash: 1000,
      months: {
        "2026-11": { income: 4000, assigned: { food: 500, rent: 2000, "acct:ira": 300 }, spent: { food: 400, rent: 2000 } },
        "2026-12": { income: 4000, assigned: { food: 500, rent: 2000 }, spent: { food: 700 } },
        "2027-01": { income: 4000, assigned: { food: 500 } },
      },
    };
    const nov = budgetView(b, cats, "2026-11");
    expect(nov.readyToAssign).toBeCloseTo(1000 + 4000 - 2800 - (2500 + 500) /* assigned in later months */, 9);
    expect(nov.lines.food!.available).toBeCloseTo(100, 9);
    // assigned to the IRA but not moved yet (no transfer recorded): it stays available
    expect(nov.lines["acct:ira"]!.spent).toBe(0);
    expect(nov.lines["acct:ira"]!.available).toBeCloseTo(300, 9);
    const dec = budgetView(b, cats, "2026-12");
    expect(dec.lines.food!.carried).toBeCloseTo(100, 9);
    expect(dec.lines.food!.available).toBeCloseTo(-100, 9); // 100 + 500 − 700
    expect(dec.lines.rent!.available).toBeCloseTo(2000, 9); // assigned, not spent yet
    const jan = budgetView(b, cats, "2027-01");
    expect(jan.overspentBefore).toBeCloseTo(100, 9);
    expect(jan.lines.food!.carried).toBe(0); // overspending doesn't carry as a negative
    expect(jan.lines.rent!.carried).toBeCloseTo(2000, 9);
    // every dollar is accounted for: ready to assign + what's sitting in categories = cash you still have
    const cashIn = 1000 + 12000;
    const spentAll = 400 + 2000 + 700;
    const sitting = Object.values(jan.lines).reduce((a, l) => a + Math.max(0, l.available), 0);
    expect(jan.readyToAssign + sitting).toBeCloseTo(cashIn - spentAll, 9);
  });

  it("before the budget starts there's nothing to assign", () => {
    expect(budgetView({ start: "2027-01", startCash: 500, months: {} }, cats, "2026-12").started).toBe(false);
    expect(budgetView(undefined, cats, "2026-12").started).toBe(false);
  });

  it("what you assign to savings and debts is what the plan uses that month", () => {
    const base = blank({
      incomes: [{ id: "j", name: "Job", freq: "monthly", net: 8000, matchMode: "usd" }],
      budget: [{ id: "rent", name: "Rent", amount: 2000, inRetirement: true }],
      accounts: [{ id: "ira", name: "Roth IRA", type: "roth", balance: 0 }, { id: "cash", name: "Savings", type: "cash", balance: 0 }],
      debts: [{ id: "v", name: "Visa", kind: "credit_card", balance: 5000, apr: 0.2, minPayment: 100 }],
      limits: [{ year: 2026, k401: 24500, k401Catch: 8000, ira: 7500, iraCatch: 1100, hsaSelf: 4400, hsaFamily: 8750, hsaCatch: 1000 }],
      plan: { ...blank().plan, steps: ["highDebt", "ira", "taxable"] },
    });
    const s = blank({
      ...base,
      budgetPlan: { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { "acct:ira": 700, "debt:v": 1100, rent: 2000 } } } },
    });
    const m = simulatePlan(s, derive(s, START)).months;
    expect(m[0]!.alloc.ira).toBeCloseTo(700, 6);
    expect(m[0]!.alloc.debt).toBeCloseTo(1000, 6); // $1,100 assigned − the $100 minimum
    // cash you assign that's already in the account (the emergency fund) isn't new saving for the plan
    const withCash = blank({ ...s, accounts: s.accounts.map((x) => (x.id === "cash" ? { ...x, balance: 13000 } : x)), budgetPlan: { start: "2026-11", startCash: 13000, months: { "2026-11": { assigned: { "acct:cash": 13000, "acct:ira": 700 } } } } });
    const mc = simulatePlan(withCash, derive(withCash, START)).months[0]!;
    expect(mc.plannedAsk).toBeCloseTo(700, 6);
    expect(mc.plannedShort).toBe(0);
    // without the budget the plan pours everything into the Visa first
    const plain = simulatePlan(base, derive(base, START)).months;
    expect(plain[0]!.alloc.debt).toBeGreaterThan(4000);
  });

  it("categories come from the budget, bills, debts, savings accounts and goals", () => {
    const s = blank({
      incomes: [{ id: "j", name: "Job", freq: "monthly", net: 8000, matchMode: "usd" }],
      budget: [{ id: "rent", name: "Rent", amount: 2000, inRetirement: true, group: "Housing" }],
      accounts: [
        { id: "ira", name: "Roth IRA", type: "roth", balance: 0 },
        { id: "ira2", name: "Spouse IRA", type: "roth", balance: 0 },
        { id: "k", name: "401(k)", type: "pretax", balance: 0 },
      ],
      debts: [{ id: "v", name: "Visa", kind: "credit_card", balance: 5000, apr: 0.2, minPayment: 100 }],
      goals: [
        { id: "c", name: "Costco", target: 120, saved: 0, recurring: { every: 12, due: "2027-03" } },
        { id: "car", name: "Car", target: 10000, saved: 0 },
      ],
      plan: { ...blank().plan, steps: ["highDebt", "ira", "taxable"], schedule: { "acct:ira2": [{ from: "2026-11", amount: 50 }] } },
    });
    const d = derive(s, START);
    const c = budgetCategories(s, d, simulatePlan(s, d), START, "2026-11");
    const by = (k: string) => c.find((x) => x.key === k);
    expect(by("rent")).toMatchObject({ group: "Housing", kind: "spending", target: 2000 });
    expect(by("goal:c")).toMatchObject({ kind: "bill", target: 24 }); // $120 over Nov–Mar
    expect(by("debt:v")!.kind).toBe("debt");
    expect(by("debt:v")!.target).toBeGreaterThan(100); // minimum + the plan's extra
    expect(by("acct:ira2")!.target).toBe(50); // its own amount
    expect(by("acct:k")).toBeUndefined(); // the 401(k) is set per paycheck
    expect(by("goal:car")!.kind).toBe("saving");
    // a plan step with no account yet still gets a line (brokerage here); one with an account doesn't
    expect(by("taxable")).toMatchObject({ kind: "saving", name: "Brokerage (no account yet)", moves: true });
    expect(by("ira")).toBeUndefined();
    // ...but not when nothing goes there this month (a big debt comes first)
    const busy = blank({ ...s, debts: [{ id: "v", name: "Visa", kind: "credit_card", balance: 90000, apr: 0.2, minPayment: 100 }] });
    const db = derive(busy, START);
    expect(budgetCategories(busy, db, simulatePlan(busy, db), START, "2026-11").find((x) => x.key === "taxable")).toBeUndefined();
    expect(budgetScheduleMonths({ debts: [], goals: [], budgetPlan: { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { taxable: 400 } } } } })).toEqual({ taxable: { "2026-11": 400 } });
  });

  it("cash assigned in the first month: only the part above what's already there is new saving", () => {
    const accounts = [{ id: "ef", name: "Emergency Fund", type: "cash" as const, balance: 13000 }];
    const months = { "2026-11": { assigned: { "acct:ef": 13500 } }, "2026-12": { assigned: { "acct:ef": 1500 } } };
    expect(budgetScheduleMonths({ debts: [], goals: [], accounts, budgetPlan: { start: "2026-11", startCash: 0, months } })).toEqual({ "acct:ef": { "2026-11": 500, "2026-12": 1500 } });
    // all of it already there: nothing new
    const same = { "2026-11": { assigned: { "acct:ef": 13000 } } };
    expect(budgetScheduleMonths({ debts: [], goals: [], accounts, budgetPlan: { start: "2026-11", startCash: 0, months: same } })).toBeUndefined();
  });
});

describe("budgetStartCash", () => {
  it("counts every cash account, including ones added after the budget began", () => {
    const s = {
      accounts: [
        { id: "chk", name: "Checking", type: "cash" as const, balance: 13962.11 },
        { id: "sav", name: "Savings", type: "cash" as const, balance: 1000 },
        { id: "ira", name: "IRA", type: "roth" as const, balance: 50000 },
      ],
      budgetPlan: { start: "2026-11", startCash: 13962.11, months: {} },
    };
    expect(budgetStartCash(s)).toBeCloseTo(14962.11, 6);
  });
  it("an account with transactions counts from where its register started", () => {
    const s = {
      accounts: [{ id: "chk", name: "Checking", type: "cash" as const, balance: 1500 }],
      budgetPlan: { start: "2026-11", startCash: 0, months: {}, registers: { chk: { opening: 1000, since: "2026-11-02" } } },
    };
    // the other $500 came from transactions, which reach ready to assign on their own
    expect(budgetStartCash(s)).toBe(1000);
  });
});
