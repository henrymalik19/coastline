import { describe, expect, it } from "vitest";
import { accountForecasts, BUDGET_ITEM, budgetCategories, derive, simulatePlan, FICA, HSA_ELIGIBLE, HSAEMP, k401Cost, PAYDED, PAYGROSS, PAYNET, run, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

/** The sample plan with some amounts changing over time. */
function withChanges(schedule: NonNullable<PlanState["plan"]["schedule"]>, scheduleMonths?: PlanState["plan"]["scheduleMonths"], tweak?: (s: PlanState) => void): PlanState {
  const s = sampleState();
  s.plan = { ...s.plan, schedule: { ...(s.plan.schedule ?? {}), ...schedule }, ...(scheduleMonths ? { scheduleMonths } : {}) };
  tweak?.(s);
  return s;
}
const rows = (s: PlanState) => run(s, START).plan.months;
const at = (s: PlanState, ym: string) => rows(s).find((r) => `${r.y}-${String(r.mo + 1).padStart(2, "0")}` === ym)!;

describe("amounts that change over time", () => {
  it("a raise from a month on: more take-home after tax, and a % of pay 401(k) and match follow it", () => {
    const base = sampleState();
    const s = withChanges({ [PAYGROSS + "inc1"]: [{ from: "2027-01", amount: 3850 }] });
    const mt = base.plan.marginalTax;
    // before the raise nothing changes
    expect(at(s, "2026-12")).toEqual(at(base, "2026-12"));
    const a = at(base, "2027-03");
    const b = at(s, "2027-03");
    const c = b.checks[0]!;
    // 4% of the extra $350 goes to the 401(k); the match (100% of 3% + 50% of 2%) on it grows too
    expect(b.payPre - a.payPre).toBeCloseTo(350 * 0.04 * c, 6);
    expect(b.payMatch - a.payMatch).toBeCloseTo(350 * 0.035 * c, 6);
    expect(b.income - a.income).toBeCloseTo(350 * c * (1 - mt - FICA) - 350 * 0.04 * c * k401Cost(mt), 6);
    // and it lasts
    expect(at(s, "2029-03").income).toBeGreaterThan(at(base, "2029-03").income);
  });

  it("a one-month change applies to that month only (an unpaid month)", () => {
    const base = sampleState();
    const s = withChanges({}, { [PAYGROSS + "inc1"]: { "2027-02": 0 } });
    expect(at(s, "2027-02").income).toBeLessThan(at(base, "2027-02").income);
    expect(at(s, "2027-02").payPre).toBe(0);
    expect(at(s, "2027-03").income).toBeCloseTo(at(base, "2027-03").income, 6);
  });

  it("a deduction going up comes out of take-home in full", () => {
    const base = sampleState();
    base.incomes[0]!.deductions = [{ id: "h", kind: "health", amount: 100 }];
    const s = structuredClone(base);
    s.plan.schedule = { [PAYDED + "inc1:h"]: [{ from: "2027-01", amount: 160 }] };
    const a = at(base, "2027-03");
    const b = at(s, "2027-03");
    expect(a.income - b.income).toBeCloseTo(60 * b.checks[0]!, 6);
  });

  it("typed take-home (other income) changes by month", () => {
    const s0 = sampleState();
    s0.incomes.push({ id: "rent", name: "Rental", kind: "other", freq: "monthly", net: 800, matchMode: "usd", pretax: 0, match: 0, fullMatch: true });
    const s = structuredClone(s0);
    s.plan.schedule = { [PAYNET + "rent"]: [{ from: "2027-06", amount: 900 }] };
    expect(at(s, "2027-05").income).toBeCloseTo(at(s0, "2027-05").income, 6);
    expect(at(s, "2027-06").income - at(s0, "2027-06").income).toBeCloseTo(100, 6);
  });

  it("a budget item changes by month: in the plan's spending and in that month's budget", () => {
    const base = sampleState();
    const s = withChanges({ [BUDGET_ITEM + "b1"]: [{ from: "2027-01", amount: 1700 }] });
    expect(at(s, "2026-12").expenses).toBeCloseTo(at(base, "2026-12").expenses, 6);
    expect(at(s, "2027-01").expenses - at(base, "2027-01").expenses).toBeCloseTo(100, 6);
    const d = derive(s, START);
    const target = (m: string) => budgetCategories(s, d, simulatePlan(s, d), START, m).find((c) => c.key === "b1")!.target;
    expect(target("2026-12")).toBe(1600);
    expect(target("2027-01")).toBe(1700);
  });

  it("an HSA you're eligible for from a month on: no HSA money from the plan before, a limit from that year", () => {
    const s = withChanges({ [HSA_ELIGIBLE]: [{ from: "2027-01", amount: 1 }] }, undefined, (x) => {
      x.plan.hsaEligible = false;
      x.plan.hsaPayroll = false;
      x.incomes = x.incomes.map((i) => ({ ...i, net: i.net * 3 }));
      x.accounts.push({ id: "h", name: "HSA", type: "hsa", balance: 0 });
    });
    const o = run(s, START);
    const before = o.plan.months.filter((r) => r.y === 2026);
    expect(before.every((r) => r.alloc.hsa === 0)).toBe(true);
    expect(o.plan.months.filter((r) => r.y === 2027).some((r) => r.alloc.hsa > 0)).toBe(true);
    const f = accountForecasts(s, derive(s, START), o.plan, o.d.r).find((a) => a.key === "hsa")!;
    expect(f.years.find((y) => y.year === 2026)?.limit).toBeUndefined();
    expect(f.years.find((y) => y.year === 2027)?.limit).toBeGreaterThan(0);
  });

  it("employer HSA money changes by month", () => {
    const base = sampleState();
    base.plan.hsaEligible = true;
    base.incomes[0]!.hsaEmployer = 600;
    const s = structuredClone(base);
    s.plan.schedule = { [HSAEMP + "inc1"]: [{ from: "2027-01", amount: 1200 }] };
    expect(at(s, "2026-12").payHsaEmployer).toBeCloseTo(50, 6);
    expect(at(s, "2027-01").payHsaEmployer).toBeCloseTo(100, 6);
  });
});
