import { describe, expect, it } from "vitest";
import { amortize, derive, loanSchedule, run, scheduledPayment, type Debt, type PlanState } from "../src";
import { START } from "./fixtures";

const blank = (over: Partial<PlanState> = {}): PlanState => ({
  version: 2, age: 50, retireAge: 60, healthcare: 0, currentInvestMonthly: 0,
  incomes: [{ id: "j", name: "Job", freq: "monthly", net: 9000, matchMode: "usd" }],
  budget: [{ id: "f", name: "Food", amount: 1000, inRetirement: true }],
  accounts: [], debts: [], goals: [], limits: [],
  plan: { steps: ["taxable"], starterEF: 0, efMonths: 0, highApr: 0.07, marginalTax: 0, hsaEligible: false, hsaFamily: false, projectWith: "plan" },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.04, taxRate: 0, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  ...over,
});

const mortgage = (over: Partial<Debt> = {}): Debt => ({ id: "m", name: "Home", kind: "mortgage", balance: 200_000, apr: 0.06, minPayment: 1_699.1, minimumOnly: true, ...over });

describe("mortgages in retirement", () => {
  it("amortizes: a 30-year $250k loan at 6% takes 360 payments of about $1,499", () => {
    const pay = scheduledPayment(250_000, 0.06, 360);
    expect(pay).toBeCloseTo(1498.88, 1);
    expect(amortize(250_000, 0.06, pay).months).toBe(360);
    expect(amortize(1000, 0.12, 5).months).toBeNull(); // the payment doesn't cover the interest
  });

  it("a mortgage paid off before you retire adds nothing to your number", () => {
    const s = blank({ debts: [mortgage({ balance: 50_000 })] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire).toEqual([]);
    expect(o.homeBridge).toBe(0);
    expect(o.fire).toBeCloseTo(run(blank(), START).fire, 6);
  });

  it("one that runs past retirement adds the payments left to your number", () => {
    // ~$200k left at 6% with $1,699 a month: about 15 years, so ~5 years into retirement
    const s = blank({ debts: [mortgage()] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire).toHaveLength(1);
    const left = o.mortgagesAtRetire[0]!;
    expect(left.months).toBeGreaterThan(50);
    expect(left.months).toBeLessThan(70);
    expect(o.homeBridge).toBeCloseTo(left.total, 6);
    expect(o.fire - run(blank(), START).fire).toBeCloseTo(left.total, 0);
  });

  it("escrow isn't part of the loan, and keeps counting in retirement", () => {
    const s = blank({ debts: [mortgage({ minPayment: 2_099.1, escrow: 400 })] });
    const o = run(s, START);
    expect(o.mortgagesAtRetire[0]!.total).toBeCloseTo(run(blank({ debts: [mortgage()] }), START).mortgagesAtRetire[0]!.total, 6);
    expect(o.d.retireMonthly).toBeCloseTo(1400, 6);
  });

  it("paying extra through the plan shrinks what's left at retirement", () => {
    const base = blank({ debts: [mortgage()] });
    const extra = blank({ debts: [mortgage({ minimumOnly: undefined })], plan: { ...base.plan, steps: ["lowDebt", "taxable"] } });
    expect(run(extra, START).homeBridge).toBeLessThan(run(base, START).homeBridge);
  });

  it("a paid-off home's tax, insurance and upkeep count in retirement", () => {
    const s = blank({ accounts: [{ id: "h", name: "Home", type: "property", balance: 400_000, homeCosts: 6_000, upkeep: 0.01 }] });
    const d = derive(s, START);
    expect(d.homeMonthly).toBeCloseTo((6_000 + 4_000) / 12, 6);
    expect(d.retireMonthly).toBeCloseTo(1000 + 10_000 / 12, 6);
  });
});

describe("loan schedule", () => {
  it("shows the payment number and how far ahead of schedule extra payments put you", () => {
    const pay = scheduledPayment(250_000, 0.06, 360);
    // 48 payments made (first in Nov 2022); on schedule you'd owe about $236k
    const onTrack = { ...mortgage(), balance: 0, minPayment: pay, term: 360, firstPayment: "2022-11", original: 250_000 };
    const plain = loanSchedule(onTrack, "2026-11")!;
    expect(plain.paymentNumber).toBe(49);
    expect(plain.scheduledEnd).toBe("2052-10");
    const owed = plain.expectedBalance!;
    expect(owed).toBeGreaterThan(230_000);
    expect(owed).toBeLessThan(240_000);
    expect(Math.abs(loanSchedule({ ...onTrack, balance: owed }, "2026-11")!.aheadMonths!)).toBeLessThanOrEqual(1);
    // $30k less than the schedule says: years ahead
    const ahead = loanSchedule({ ...onTrack, balance: owed - 30_000 }, "2026-11")!;
    expect(ahead.aheadMonths!).toBeGreaterThan(36);
    expect(ahead.actualEnd! < plain.scheduledEnd).toBe(true);
    expect(loanSchedule(mortgage(), "2026-11")).toBeNull(); // no term or first payment
  });
});
