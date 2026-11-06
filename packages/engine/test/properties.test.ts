import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { checksInMonth, derive, limitsFor, resolveIncome, run, simulatePlan, type PlanState } from "../src";
import { ref, sampleState, START, stateArb } from "./fixtures";

const sim = (s: PlanState) => {
  const d = derive(s, START);
  return { d, plan: simulatePlan(s, d) };
};

describe("cash conservation (property)", () => {
  it("income - expenses + extra + shortfall === take-home allocations + leftover, every month", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const { plan } = sim(s);
        const extra = s.whatif.extra;
        for (const m of plan.months) {
          const a = m.alloc;
          const out = a.k401TakeHome + a.ira + a.taxable + a.ef + a.debt + a.hsa + a.goals + a.leftover;
          const inflow = m.income - m.expenses + extra + m.shortfall;
          expect(Math.abs(inflow - out)).toBeLessThan(0.01);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("contribution caps (property)", () => {
  it("yearly IRA / HSA / 401(k) employee totals never exceed the (prorated) cap", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const { d, plan } = sim(s);
        const byYear = new Map<number, typeof plan.months>();
        for (const m of plan.months) byYear.set(m.y, [...(byYear.get(m.y) ?? []), m]);
        for (const [y, months] of byYear) {
          const L = limitsFor(s.limits, y);
          const scale = y === START.getFullYear() ? (12 - START.getMonth()) / 12 : 1;
          const lastAge = d.age + months.at(-1)!.m / 12;
          const capIra = (L.ira + (lastAge >= 50 ? L.iraCatch : 0)) * scale;
          const capHsa = s.plan.hsaEligible ? ((s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (lastAge >= 55 ? L.hsaCatch : 0)) * scale : 0;
          const capK = (L.k401 + (lastAge >= 50 ? L.k401Catch : 0)) * scale;
          const sumOf = (f: (m: (typeof months)[number]) => number) => months.reduce((a, m) => a + f(m), 0);
          expect(sumOf((m) => m.alloc.ira)).toBeLessThanOrEqual(capIra + 1e-6);
          expect(sumOf((m) => m.alloc.hsa)).toBeLessThanOrEqual(capHsa + 1e-6);
          // payroll deferrals + waterfall extra together stay under the 401(k) limit
          expect(sumOf((m) => m.payPre + m.alloc.k401)).toBeLessThanOrEqual(capK + 1e-6);
        }
      }),
      { numRuns: 300 },
    );
  });
});

describe("determinism (property)", () => {
  it("run() is a pure function of (state, startDate)", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const a = run(s, START);
        const b = run(structuredClone(s), new Date(START));
        expect(a.mc).toEqual(b.mc);
        expect(a.crossing).toBe(b.crossing);
        expect(a.fire).toBe(b.fire);
      }),
      { numRuns: 25 },
    );
  });
});

/* ---------- parity with the prototype (reference/engine.js) ---------- */

type AnyRun = Record<string, unknown> & { whenBalance: (x: number) => number | null; whenCoastPct: (f: number) => number | null };

function expectParity(input: PlanState) {
  const s: PlanState = { ...input, adjustments: [] }; // the prototype has no one-off adjustments
  const ours = run(s, START) as unknown as AnyRun;
  // `payCut` is new in the port; when the prototype stays under the limit it is always 0.
  // fields new in the port are always 0 on plans the prototype can run the same way
  for (const m of (ours.plan as { months: Record<string, unknown>[] }).months) {
    for (const k of ["payCut", "adjIncome", "adjExpense", "borrowed"]) {
      expect(m[k]).toBe(0);
      delete m[k];
    }
  }
  const theirs = ref.run(structuredClone(s), START) as AnyRun;
  const strip = ({ whenBalance: _a, whenCoastPct: _b, ...rest }: AnyRun) => rest;
  expect(strip(ours)).toEqual(strip(theirs));
  for (const target of [1e4, 1e5, 5e5, 1e6, 3e6]) expect(ours.whenBalance(target)).toBe(theirs.whenBalance(target));
  for (const f of [0.25, 0.5, 0.75, 1]) expect(ours.whenCoastPct(f)).toBe(theirs.whenCoastPct(f));
}

/**
 * Intentional divergence: the prototype lets payroll 401(k) run past the annual limit.
 * The port stops deferrals at the limit and reserves room for scheduled payroll, so
 * parity is only expected when the prototype itself never exceeds the 401(k) limit.
 * In that case the two engines must agree exactly.
 */
function refStaysUnder401kCap(input: PlanState): boolean {
  const s: PlanState = { ...input, adjustments: [] };
  const run1 = (mode: "plan" | "current", extra: number) => {
    const d = ref.derive(structuredClone(s), START);
    return ref.simulatePlan(s, d, { mode, extraMonthly: extra }).months as { y: number; m: number; payPre: number; alloc: { k401: number } }[];
  };
  const extra = s.whatif.extra || 0;
  for (const months of [run1("plan", extra), run1("current", extra), run1(s.plan.projectWith, extra + 100)]) {
    const totals = new Map<number, { t: number; lastM: number }>();
    if (months.some((m) => (m as unknown as { cash: number }).cash < -1e-6)) return false; // port borrows instead of going below $0
    for (const m of months) {
      const e = totals.get(m.y) ?? { t: 0, lastM: m.m };
      totals.set(m.y, { t: e.t + m.payPre + m.alloc.k401, lastM: m.m });
    }
    for (const [y, { t, lastM }] of totals) {
      const L = limitsFor(s.limits, y);
      const scale = y === START.getFullYear() ? (12 - START.getMonth()) / 12 : 1;
      const cap = (L.k401 + (s.age + lastM / 12 >= 50 ? L.k401Catch : 0)) * scale;
      if (t > cap - 1e-6) return false;
    }
  }
  return true;
}

describe("parity with reference/engine.js", () => {
  it("sample state: identical run() output", () => {
    expect(refStaysUnder401kCap(sampleState())).toBe(true);
    expectParity(sampleState());
  });

  it("sample state in 'current' mode", () => {
    const s = sampleState();
    s.plan.projectWith = "current";
    expectParity(s);
  });

  it("random states under the 401(k) limit: identical run() output", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        fc.pre(refStaysUnder401kCap(s));
        expectParity(s);
      }),
      { numRuns: 60 },
    );
  });

  it("building blocks match", () => {
    fc.assert(
      fc.property(stateArb, fc.integer({ min: 2026, max: 2040 }), fc.integer({ min: 0, max: 11 }), (s, y, mo) => {
        for (const inc of s.incomes) {
          expect(resolveIncome(inc)).toEqual(ref.resolveIncome(inc));
          expect(checksInMonth(inc, y, mo)).toBe(ref.checksInMonth(inc, y, mo));
        }
        expect(limitsFor(s.limits, y)).toEqual(ref.limitsFor(s.limits, y));
      }),
      { numRuns: 30 },
    );
  });
});

describe("short months (property)", () => {
  it("cash never goes below $0: anything past your cash is borrowed on a card", () => {
    fc.assert(
      fc.property(stateArb, (s) => {
        const { plan } = sim(s);
        const startCash = s.accounts.filter((a) => a.type === "cash").reduce((t, a) => t + a.balance, 0);
        for (const m of plan.months) {
          expect(m.cash).toBeGreaterThanOrEqual(Math.min(0, startCash) - 1e-6);
          expect(m.borrowed).toBeGreaterThanOrEqual(0);
          expect(m.borrowed).toBeLessThanOrEqual(m.shortfall + 1e-6);
        }
      }),
      { numRuns: 300 },
    );
  });
});
