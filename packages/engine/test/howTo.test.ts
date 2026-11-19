import { describe, expect, it } from "vitest";
import { coastNumberAt, extraToCoastBy, extraToRetire, finalAndFire, investingNow, monthlyGrowthFactor, project, retireAgeOnPlan, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

/** The plan's months with `extra` more invested (Roth/taxable side) in each of the first `upTo` months. */
const withExtra = (o: ReturnType<typeof run>, extra: number, upTo: number) => ({
  ...o.plan,
  months: o.plan.months.map((m, i) => (i < upTo ? { ...m, post: m.post + extra } : m)),
});

// spending a lot in retirement, so the plan falls short at its retirement age
const short = (): PlanState => {
  const s = sampleState();
  return { ...s, retireSpending: 120_000 };
};

describe("how you get there", () => {
  it("$1 a month grows like the forecast's months", () => {
    expect(monthlyGrowthFactor(0, 12)).toBe(12);
    expect(monthlyGrowthFactor(0.05, 0)).toBe(0);
    const rm = Math.pow(1.05, 1 / 12) - 1;
    let v = 0;
    for (let i = 0; i < 24; i++) v = v * (1 + rm) + 1;
    expect(monthlyGrowthFactor(0.05, 24)).toBeCloseTo(v, 9);
  });

  it("investing the extra each month reaches the FIRE number at retirement", () => {
    const o = run(short(), START);
    expect(o.projectedFinal).toBeLessThan(o.fire);
    const extra = extraToRetire(o);
    expect(extra).toBeGreaterThan(0);
    const M = o.d.years * 12;
    expect(project(o.d, withExtra(o, extra, M), o.d.r).final).toBeCloseTo(o.projectedFinal + (o.fire - o.projectedFinal), 2);
  });

  it("nothing more when the plan already gets there", () => {
    const s = sampleState();
    const o = run({ ...s, retireSpending: 1_000 }, START);
    expect(o.projectedFinal).toBeGreaterThanOrEqual(o.fire);
    expect(extraToRetire(o)).toBe(0);
    expect(retireAgeOnPlan({ ...s, retireSpending: 1_000 }, START)).toBe(Math.round(s.retireAge));
  });

  it("investing the extra until an age reaches the Coast number then", () => {
    const o = run(short(), START);
    const k = 60; // five years from now
    const extra = extraToCoastBy(o, k);
    expect(extra).toBeGreaterThan(0);
    const at = project(o.d, withExtra(o, extra, k), o.d.r).series[k]!;
    expect(at).toBeCloseTo(coastNumberAt(o.fire, o.d.r, (o.d.years * 12 - k) / 12), 2);
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

  it("what you invest now is the plan's first year, a month at a time", () => {
    const o = run(sampleState(), START);
    const ms = o.plan.months.slice(0, 12);
    expect(investingNow(o)).toBeCloseTo(ms.reduce((a, m) => a + m.pre + m.post, 0) / 12, 9);
    expect(investingNow(o)).toBeGreaterThan(0);
  });
});
