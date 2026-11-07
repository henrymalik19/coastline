import { describe, expect, it } from "vitest";
import { accountForecasts, derive, run } from "../src";
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
