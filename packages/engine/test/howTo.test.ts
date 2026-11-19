import { describe, expect, it } from "vitest";
import { amortize, coastNumberAt, extraToCoastBy, extraToRetire, finalAndFire, investingNow, investingStarts, loanPayment, monthlyGrowthFactor, mortgagePayoffs, retireAgeOnPlan, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

// spending a lot in retirement, so the plan falls short at its retirement age
const short = (): PlanState => ({ ...sampleState(), retireSpending: 120_000 });

describe("how you get there", () => {
  it("$1 a month grows month by month", () => {
    expect(monthlyGrowthFactor(0, 12)).toBe(12);
    expect(monthlyGrowthFactor(0.004, 0)).toBe(0);
    let v = 0;
    for (let i = 0; i < 24; i++) v = v * 1.004 + 1;
    expect(monthlyGrowthFactor(0.004, 24)).toBeCloseTo(v, 9);
  });

  it("the extra a month runs the real forecast: enough, and a dollar less isn't", () => {
    const s = short();
    const extra = extraToRetire(s, START);
    expect(extra).toBeGreaterThan(0);
    expect(Number.isFinite(extra)).toBe(true);
    const M = finalAndFire(s, START).d.years * 12;
    const at = finalAndFire(s, START, { amount: extra, months: M });
    expect(at.final + 0.5).toBeGreaterThanOrEqual(at.fire);
    const less = finalAndFire(s, START, { amount: extra - 1, months: M });
    expect(less.final + 0.5).toBeLessThan(less.fire);
  });

  it("nothing more when the plan already gets there", () => {
    const s = { ...sampleState(), retireSpending: 1_000 };
    expect(extraToRetire(s, START)).toBe(0);
    expect(retireAgeOnPlan(s, START)).toBe(Math.round(s.retireAge));
  });

  it("the extra until an age reaches the Coast number then (and stops after)", () => {
    const s = short();
    const k = 60;
    const extra = extraToCoastBy(s, START, k);
    expect(extra).toBeGreaterThan(0);
    const r = finalAndFire(s, START, { amount: extra, months: k });
    const M = r.d.years * 12;
    expect(r.series[k]! + 0.5).toBeGreaterThanOrEqual(coastNumberAt(r.fire, r.d.r, (M - k) / 12));
    const less = finalAndFire(s, START, { amount: extra - 1, months: k });
    expect(less.series[k]! + 0.5).toBeLessThan(coastNumberAt(less.fire, less.d.r, (M - k) / 12));
    // the extra stops after k months: the rest of the forecast is the plan's own
    const plain = finalAndFire(s, START);
    expect(r.series[k]! - plain.series[k]!).toBeGreaterThan(0);
  });

  it("the age your plan gets there: the first age that's enough, the one before isn't", () => {
    const s = short();
    const a = retireAgeOnPlan(s, START, 90);
    expect(a).not.toBeNull();
    expect(a!).toBeGreaterThan(s.retireAge);
    const at = finalAndFire({ ...s, retireAge: a! }, START);
    expect(at.final + 0.5).toBeGreaterThanOrEqual(at.fire);
    const before = finalAndFire({ ...s, retireAge: a! - 1 }, START);
    expect(before.final).toBeLessThan(before.fire);
  });

  it("what you invest now, and when it starts", () => {
    const o = run(sampleState(), START);
    const ms = o.plan.months.slice(0, 12);
    expect(investingNow(o)).toBeCloseTo(ms.reduce((a, m) => a + m.pre + m.post, 0) / 12, 9);
    expect(investingStarts(o)).toBe(0);
    // no paycheck: nothing goes in
    const none = run({ ...sampleState(), incomes: [], currentInvestMonthly: 0 }, START);
    expect(investingNow(none)).toBe(0);
    expect(investingStarts(none)).toBeNull();
  });

  it("paying a mortgage off by retirement: the extra on the loan clears it then", () => {
    const base = sampleState();
    const loan = { id: "m", name: "Home", kind: "mortgage" as const, balance: 300_000, apr: 0.065, minPayment: 2_100, escrow: 400, minimumOnly: true };
    const s: PlanState = { ...base, debts: [...base.debts, loan] };
    const o = run(s, START);
    const [p] = mortgagePayoffs(s, o);
    expect(p).toBeDefined();
    expect(p!.owedAtRetire).toBeGreaterThan(0);
    const M = o.d.years * 12;
    // only minimums go on it in the plan, so paying minimum + extra pays it off within the months left
    expect(amortize(loan.balance, loan.apr, loanPayment(loan) + p!.extra).months!).toBeLessThanOrEqual(M);
    expect(amortize(loan.balance, loan.apr, loanPayment(loan) + p!.extra - 10).months!).toBeGreaterThan(M);
  });

  it("runs fast enough for the screen", () => {
    const s = short();
    const t0 = performance.now();
    extraToRetire(s, START);
    extraToCoastBy(s, START, 120);
    retireAgeOnPlan(s, START);
    expect(performance.now() - t0).toBeLessThan(3000);
    console.log("how-to ms", Math.round(performance.now() - t0));
  });
});
