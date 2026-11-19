import { describe, expect, it } from "vitest";
import { accountForecasts, earlyAccess, monthlyGrowthFactor, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

const at = (retireAge: number, extra: Partial<PlanState> = {}): PlanState => ({ ...sampleState(), retireAge, ...extra });

describe("before 59½", () => {
  it("only when you retire before 59½", () => {
    expect(earlyAccess(at(60), run(at(60), START))).toBeNull();
    expect(earlyAccess(at(59.5), run(at(59.5), START))).toBeNull();
    expect(earlyAccess(at(55), run(at(55), START))).not.toBeNull();
  });

  it("the years until 59½ at your retirement spending, against your brokerage then", () => {
    const s = at(55);
    const o = run(s, START);
    const e = earlyAccess(s, o)!;
    expect(e.years).toBeCloseTo(4.5, 9);
    expect(e.spending).toBeCloseTo(o.d.retireAnnual * 4.5, 6);
    expect(e.need).toBeCloseTo(Math.max(0, e.spending - e.income) + e.health + e.mortgage, 6);
    const tx = accountForecasts(s, o.d, o.plan, o.d.r).find((a) => a.key === "taxable")!;
    expect(e.reachable).toBeCloseTo(tx.months[o.d.years * 12 - 1]!.balance, 6);
    expect(e.short).toBeCloseTo(Math.max(0, e.need - e.reachable), 6);
  });

  it("income that starts before 59½ counts for the years after it starts", () => {
    const s = at(55, { retirementIncome: [{ id: "p", name: "Pension", kind: "pension", monthly: 1000, startAge: 57 }] });
    const e = earlyAccess(s, run(s, START))!;
    expect(e.income).toBeCloseTo(1000 * 12 * 2.5, 6);
    const later = at(55, { retirementIncome: [{ id: "ss", name: "Social Security", kind: "socialSecurity", monthly: 2000, startAge: 67 }] });
    expect(earlyAccess(later, run(later, START))!.income).toBe(0);
  });

  it("health insurance above Medicare until 59½, and a mortgage still owed, add to it", () => {
    const base = sampleState();
    const s = at(55, {
      healthcare: 900,
      medicare: 300,
      debts: [...base.debts, { id: "m", name: "Home", kind: "mortgage", balance: 300_000, apr: 0.065, minPayment: 2_100, escrow: 400, minimumOnly: true }],
    });
    const o = run(s, START);
    const e = earlyAccess(s, o)!;
    expect(e.health).toBeCloseTo(600 * 12 * 4.5, 6);
    expect(e.mortgage).toBeCloseTo(o.homeBridge, 6);
    expect(e.mortgage).toBeGreaterThan(0);
  });

  it("the extra into brokerage each month grows into what's short", () => {
    const s = at(55, { retireSpending: 90_000 });
    const o = run(s, START);
    const e = earlyAccess(s, o)!;
    expect(e.short).toBeGreaterThan(0);
    const f = monthlyGrowthFactor(Math.pow(1 + o.d.r, 1 / 12) - 1, o.d.years * 12);
    expect(e.extraMonthly * f).toBeGreaterThanOrEqual(e.short);
    expect((e.extraMonthly - 1) * f).toBeLessThan(e.short);
  });
});
