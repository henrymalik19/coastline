import type { Income } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { paycheck, withAutoNet } from "./paycheck";

const job: Income = {
  id: "j", name: "Job", kind: "job", freq: "biweekly", net: 0, netMode: "auto",
  matchMode: "pct", gross: 3500, contribPct: 0.05, matchRate1: 1, matchUpTo1: 0.03,
  taxes: { federal: 300, state: 120, socialSecurity: 217, medicare: 50.75 },
  deductions: [{ id: "h", kind: "health", amount: 110 }, { id: "u", kind: "union", amount: 20 }],
};

describe("paycheck", () => {
  it("take-home = gross − 401(k) − taxes − deductions", () => {
    const p = paycheck(job);
    expect(p.k401).toBeCloseTo(175, 6);
    expect(p.taxes).toBeCloseTo(687.75, 6);
    expect(p.deductions).toBe(130);
    expect(p.pretaxDeductions).toBe(110);
    expect(p.net).toBeCloseTo(3500 - 175 - 687.75 - 130, 2);
  });

  it("uses the $ amount in '$ per check' mode, and never goes below 0", () => {
    expect(paycheck({ ...job, matchMode: "usd", pretax: 200 }).k401).toBe(200);
    expect(paycheck({ ...job, gross: 100 }).net).toBe(0);
  });
});

describe("withAutoNet", () => {
  it("recalculates take-home in auto mode", () => {
    expect(withAutoNet(job, { gross: 4000 }).net).toBeCloseTo(4000 - 200 - 687.75 - 130, 2);
  });
  it("leaves take-home alone in manual mode and for non-jobs", () => {
    expect(withAutoNet({ ...job, netMode: "manual" }, { gross: 4000 })).toEqual({ gross: 4000 });
    expect(withAutoNet({ ...job, kind: "rental" }, { net: 900 })).toEqual({ net: 900 });
  });
});
