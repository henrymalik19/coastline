import { describe, expect, it } from "vitest";
import { baristaFi, fireBreakdown, fiLevels, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

const withExtras = (): PlanState => {
  const s = sampleState();
  return {
    ...s,
    healthcare: 600,
    budget: [...s.budget, { id: "fun", name: "Travel", amount: 400, inRetirement: true, essential: false }],
    retirementIncome: [{ id: "ss", name: "Social Security", kind: "socialSecurity", monthly: 2000, startAge: Math.max(s.retireAge, 67) }],
    debts: [...s.debts, { id: "m", name: "Home", kind: "mortgage", balance: 300_000, apr: 0.065, minPayment: 2_100, escrow: 400, minimumOnly: true }],
    accounts: [...s.accounts, { id: "h", name: "Home", type: "property", balance: 500_000, upkeep: 0.01 }],
    whatif: { ...s.whatif, spendDelta: 0.1 },
  };
};

describe("your number, step by step", () => {
  it("the pieces add up to the FIRE and Coast numbers", () => {
    const s = withExtras();
    const o = run(s, START);
    const b = fireBreakdown(s, o);
    expect(b.spending.reduce((a, x) => a + x.monthly, 0)).toBeCloseTo(o.d.retireMonthly, 6);
    expect(b.base + b.taxExtra + b.bridge + b.homeBridge).toBeCloseTo(o.fire, 4);
    expect(b.fire / b.growth).toBeCloseTo(o.coastNow, 4);
    expect(b.homeBridge).toBeGreaterThan(0);
  });

  it("what your money supports turns the FIRE number around", () => {
    const s = withExtras();
    const o = run(s, START);
    const b = fireBreakdown(s, o);
    // exactly the FIRE number supports exactly your retirement spending
    const atFire = fireBreakdown(s, { ...o, projectedFinal: o.fire });
    expect(atFire.planSupports).toBeCloseTo(o.d.retireAnnual, 4);
    expect(b.coastSupports > o.d.retireAnnual).toBe(o.d.invested >= o.coastNow);
  });

  it("Lean costs less than FI, Fat more; FI matches the plan", () => {
    const s = withExtras();
    const o = run(s, START);
    const [lean, fi, fat] = fiLevels(s, o);
    expect(fi!.fire).toBeCloseTo(o.fire, 6);
    expect(fi!.coastNow).toBeCloseTo(o.coastNow, 6);
    expect(lean!.monthly).toBeCloseTo(o.d.retireMonthly - 400 * 1.1, 6); // travel isn't essential
    expect(lean!.fire).toBeLessThan(fi!.fire);
    expect(fat!.fire).toBeGreaterThan(fi!.fire);
  });

  it("Barista FI: costs, plus what still needs saving to reach the number", () => {
    const o = run(withExtras(), START);
    const b = baristaFi(o);
    expect(b.costs).toBeCloseTo(o.d.monthlyExpenses, 6);
    const rm = Math.pow(1 + o.d.r, 1 / 12) - 1;
    const n = o.d.years * 12;
    const fv = o.d.invested * Math.pow(1 + o.d.r, o.d.years) + b.saving * ((Math.pow(1 + rm, n) - 1) / rm);
    if (b.saving > 0) expect(fv).toBeCloseTo(o.fire, 0);
    // already coasting: just your costs
    const rich = run({ ...withExtras(), accounts: [{ id: "x", name: "Brokerage", type: "taxable", balance: 1e8 }] }, START);
    expect(baristaFi(rich).saving).toBe(0);
  });
});
