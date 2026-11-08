import { describe, expect, it } from "vitest";
import { accountForecasts, accountGroup, derive, run } from "../src";
import { sampleState, START } from "./fixtures";

describe("account forecasts", () => {
  it("money in matches the plan, cash and debt follow the plan, investments grow", () => {
    const s = sampleState();
    const o = run(s, START);
    const f = accountForecasts(s, derive(s, START), o.plan, o.d.r);
    const get = (k: string) => f.find((a) => a.key === k)!;
    o.plan.months.slice(0, 24).forEach((m, i) => {
      expect(get("k401").months[i]!.total).toBeCloseTo(m.payPre + m.payMatch + m.alloc.k401 + m.alloc.matchGain, 9);
      expect(get("ira").months[i]!.total).toBeCloseTo(m.alloc.ira, 9);
      expect(get("cash").months[i]!.balance).toBeCloseTo(m.cash, 9);
    });
    const ira = get("ira");
    const rm = Math.pow(1 + o.d.r, 1 / 12) - 1;
    expect(ira.months[0]!.balance).toBeCloseTo(ira.start * (1 + rm) + ira.months[0]!.total, 6);
    // all investments together match the overall projection
    const inv = f.filter((a) => a.invested);
    const k = 24;
    expect(inv.reduce((a, x) => a + x.months[k - 1]!.balance, 0)).toBeCloseTo(o.projSeries[k]!, 2);
  });
});

describe("accountGroup", () => {
  it("uses what you picked, then the name, then the type", () => {
    expect(accountGroup({ name: "Fidelity 401(k)", type: "pretax" })).toBe("k401");
    expect(accountGroup({ name: "Traditional IRA", type: "pretax" })).toBe("ira");
    expect(accountGroup({ name: "Roth 401(k)", type: "roth" })).toBe("k401");
    expect(accountGroup({ name: "Old job plan", type: "pretax", counts: "other" })).toBe("other");
    expect(accountGroup({ name: "Savings", type: "cash" })).toBe("cash");
    expect(accountGroup({ name: "Home", type: "property" })).toBe(null);
    expect(accountGroup({ name: "Irving Trust", type: "roth" })).toBe("ira");
  });
});

describe("IRA money put in January to April for last year", () => {
  it("counts toward last year's total, not the year it goes in", () => {
    const s = sampleState();
    const o = run(s, START);
    const f0 = accountForecasts(s, derive(s, START), o.plan, o.d.r).find((a) => a.key === "ira")!;
    // pretend $1,000 of February's IRA money was for last year
    const i = o.plan.months.findIndex((m, j) => j > 0 && m.mo === 1);
    const months = o.plan.months.map((m, j) => (j === i ? { ...m, alloc: { ...m.alloc, ira: m.alloc.ira + 1000 }, priorIra: 1000 } : m));
    const f = accountForecasts(s, derive(s, START), { ...o.plan, months }, o.d.r).find((a) => a.key === "ira")!;
    const y = o.plan.months[i]!.y;
    const yr = (a: typeof f, year: number) => a.years.find((x) => x.year === year)!;
    expect(f.months[i]!.prior).toBe(1000);
    expect(yr(f, y - 1).employee).toBeCloseTo(yr(f0, y - 1).employee + 1000, 6);
    expect(yr(f, y).employee).toBeCloseTo(yr(f0, y).employee, 6);
  });
});
