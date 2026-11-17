import { describe, expect, it } from "vitest";
import { derive, simulatePlan, type PlanState } from "../src";
import { sampleState, START } from "./fixtures";

const withExtra = (extra: number): PlanState => {
  const s = sampleState();
  return { ...s, whatif: { ...s.whatif, extra } };
};
const forecast = (s: PlanState) => simulatePlan(s, derive(s, START), { autoFill: false });

describe("the Forecast table (no auto-fill) with a what-if's extra savings", () => {
  it("puts the extra through your steps instead of leaving it unassigned", () => {
    const base = forecast(withExtra(0)).months[0]!;
    const more = forecast(withExtra(500)).months[0]!;
    const placed = (m: typeof base) => m.alloc.ef + m.alloc.debt + m.alloc.k401 + m.alloc.ira + m.alloc.hsa + m.alloc.taxable + m.alloc.goals;
    expect(placed(more) - placed(base)).toBeGreaterThan(0);
    // take-home used: at most the extra (pre-tax 401(k) money can add a bit more than that to the account)
    const used = base.alloc.leftover + 500 - more.alloc.leftover;
    expect(used).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(500 + 1e-6);
  });

  it("still leaves money you haven't assigned where it is", () => {
    const base = forecast(withExtra(0)).months[0]!;
    const more = forecast(withExtra(500)).months[0]!;
    // the leftover only shrinks by what the extra didn't cover, never below what it was without the extra
    expect(more.alloc.leftover).toBeGreaterThanOrEqual(base.alloc.leftover - 1e-6);
  });

  it("changes nothing without a what-if", () => {
    expect(forecast(withExtra(0))).toEqual(forecast(sampleState()));
  });
});
