import { describe, expect, it } from "vitest";
import type { Checkin } from "@coastfi/schema";
import { investedHistory, streakFrom, vsPlan } from "./historyCore";

const rec = (month: string, invested: number, expectedNextInvested: number): Checkin => ({ month, invested, expectedNextInvested, cash: 0, debt: 0, netWorth: invested });
const nov = new Date(2026, 10, 14);

describe("vsPlan", () => {
  it("needs two months in a row", () => {
    expect(vsPlan([rec("2026-10", 100, 110)], nov)).toBeNull();
    expect(vsPlan([rec("2026-08", 100, 110), rec("2026-10", 120, 130)], nov)).toBeNull();
  });
  it("adds up each finished month against the month before's plan, leaving out this month", () => {
    const v = vsPlan([rec("2026-08", 100, 110), rec("2026-09", 115, 125), rec("2026-10", 120, 130), rec("2026-11", 999, 0)], nov)!;
    // Sep: 115 - 110 = +5; Oct: 120 - 125 = -5
    expect(v.total).toBe(0);
    expect(v.last).toBe(-5);
    expect(v.lastMonth).toBe("2026-10");
    expect(v.since).toBe("2026-09");
    expect(v.months).toBe(2);
  });
});

describe("investedHistory", () => {
  it("is the past month-ends, then this month live", () => {
    const h = investedHistory([rec("2026-09", 1, 0), rec("2026-10", 2, 0), rec("2026-11", 3, 0)], 50, nov);
    expect(h).toEqual([
      { month: "2026-09", invested: 1, expected: undefined },
      { month: "2026-10", invested: 2, expected: 0 },
      { month: "2026-11", invested: 50, expected: 0 },
    ]);
  });
});

describe("streakFrom", () => {
  it("counts back from last month while this one is still going", () => {
    const s = streakFrom(new Set(["2026-08", "2026-09", "2026-10"]), nov, "budget");
    expect(s.n).toBe(3);
    expect(s.thisMonth).toBe(false);
    expect(s.last12).toHaveLength(12);
  });
  it("includes this month once it counts, and stops at a gap", () => {
    expect(streakFrom(new Set(["2026-08", "2026-10", "2026-11"]), nov, "budget").n).toBe(2);
  });
});
