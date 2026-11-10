import { BUDGET_ITEM, HSA_ELIGIBLE, HSAEMP, PAY401, PAYGROSS, PAYHSA, type PlanState } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { paycheck } from "./paycheck";
import { freshPlan } from "./presets";
import { rollForward } from "./rollForward";
import { estimateJobTaxes } from "./tax";

function plan(): PlanState {
  const p = freshPlan();
  p.incomes = [
    {
      id: "j", name: "Job", kind: "job", freq: "biweekly", net: 0, netMode: "auto", matchMode: "pct", gross: 3000, contribPct: 0.05,
      matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02, taxes: { federal: 0, state: 0, socialSecurity: 0, medicare: 0 }, deductions: [],
    },
  ];
  p.incomes[0]!.taxes = estimateJobTaxes(p, p.incomes[0]!);
  p.incomes[0]!.net = paycheck(p.incomes[0]!).net;
  p.budget = [{ id: "rent", name: "Rent", amount: 1600, inRetirement: true }];
  p.plan.hsaEligible = false;
  return p;
}

describe("rollForward", () => {
  it("does nothing before a change's month", () => {
    const p = plan();
    p.plan.schedule = { [PAYGROSS + "j"]: [{ from: "2027-01", amount: 3300 }] };
    const before = structuredClone(p);
    expect(rollForward(p, "2026-12")).toBe(false);
    expect(p).toEqual(before);
  });

  it("puts started changes in their fields and keeps what's still ahead", () => {
    const p = plan();
    p.plan.schedule = {
      [HSA_ELIGIBLE]: [{ from: "2027-01", amount: 1 }],
      [PAYHSA + "j"]: [{ from: "2027-01", amount: 150 }],
      [HSAEMP + "j"]: [{ from: "2027-01", amount: 600 }],
      [BUDGET_ITEM + "rent"]: [{ from: "2027-01", amount: 1700 }, { from: "2028-01", amount: 1800 }],
      [PAYGROSS + "j"]: [{ from: "2027-01", amount: 3300 }],
      "acct:x": [{ from: "2026-11", amount: 100 }],
    };
    p.plan.scheduleMonths = { [PAYGROSS + "j"]: { "2026-12": 0, "2027-03": 0 } };
    expect(rollForward(p, "2027-02")).toBe(true);
    const j = p.incomes[0]!;
    expect(p.plan.hsaEligible).toBe(true);
    expect(j.hsaPre).toBe(150);
    expect(j.hsaEmployer).toBe(600);
    expect(j.gross).toBe(3300);
    expect(p.budget[0]!.amount).toBe(1700);
    // still ahead, and not an input: stays
    expect(p.plan.schedule).toEqual({ [BUDGET_ITEM + "rent"]: [{ from: "2028-01", amount: 1800 }], "acct:x": [{ from: "2026-11", amount: 100 }] });
    // a past one-month change is gone, a coming one stays
    expect(p.plan.scheduleMonths).toEqual({ [PAYGROSS + "j"]: { "2027-03": 0 } });
    // taxes were the estimate: they follow the raise, and take-home is worked out again
    expect(j.taxes).toEqual(estimateJobTaxes(p, j));
    expect(j.net).toBe(paycheck(j).net);
  });

  it("keeps taxes you typed", () => {
    const p = plan();
    p.incomes[0]!.taxes = { federal: 300, state: 100, socialSecurity: 186, medicare: 43.5 };
    p.plan.schedule = { [PAYGROSS + "j"]: [{ from: "2027-01", amount: 3300 }] };
    rollForward(p, "2027-01");
    expect(p.incomes[0]!.taxes).toEqual({ federal: 300, state: 100, socialSecurity: 186, medicare: 43.5 });
    expect(p.incomes[0]!.net).toBe(paycheck(p.incomes[0]!).net);
  });

  it("a 401(k) change as a % of pay becomes the job's %", () => {
    const p = plan();
    p.plan.schedule = { [PAY401 + "j"]: [{ from: "2027-01", amount: 240, pct: 0.08 }] };
    rollForward(p, "2027-01");
    expect(p.incomes[0]!.contribPct).toBe(0.08);
  });

  it("leaves a change whose job is gone", () => {
    const p = plan();
    p.plan.schedule = { [PAYGROSS + "gone"]: [{ from: "2027-01", amount: 1 }] };
    expect(rollForward(p, "2027-01")).toBe(false);
  });
});
