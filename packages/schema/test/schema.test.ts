import { run } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { CheckinSchema, defaultPlanState, parsePlanState, PlanStateError } from "../src";

const START = new Date(2026, 10, 6);

describe("parsePlanState", () => {
  it("v2 JSON round-trips without loss", () => {
    const s = defaultPlanState();
    s.incomes.push({
      id: "i1", name: "Job", freq: "biweekly", net: 2400, nextPayday: "2026-11-13",
      matchMode: "pct", gross: 3500, contribPct: 0.04, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02,
    });
    s.debts.push({ id: "d1", name: "Card", balance: 3000, apr: 0.24, minPayment: 90, plaidAccountId: "plaid_x" });
    s.goals.push({ id: "g1", name: "Trip", target: 2000, saved: 0 });
    s.plan.steps.splice(3, 0, "goal:g1");
    const json = JSON.stringify(s);
    const parsed = parsePlanState(json);
    expect(parsed).toEqual(s);
    expect(JSON.stringify(parsed)).toBe(json);
  });

  it("parsed state runs through the engine", () => {
    const res = run(parsePlanState(JSON.stringify(defaultPlanState())), START);
    expect(Number.isFinite(res.fire)).toBe(true);
  });

  it("rejects bad steps, dates and versions with readable issues", () => {
    const bad = { ...defaultPlanState(), plan: { ...defaultPlanState().plan, steps: ["nope"] } };
    expect(() => parsePlanState(bad)).toThrow(PlanStateError);
    const badDate = defaultPlanState();
    badDate.incomes.push({ id: "i", name: "J", freq: "weekly", net: 1, nextPayday: "11/13/2026", matchMode: "usd" });
    expect(() => parsePlanState(badDate)).toThrow(/validation/);
    expect(() => parsePlanState({ version: 3 })).toThrow(/Unsupported plan version: 3/);
    expect(() => parsePlanState("[]")).toThrow(PlanStateError);
  });

});

describe("income kinds, budget groups, check-ins", () => {
  it("income kind and budget group round-trip; unknown kinds are rejected", () => {
    const s = defaultPlanState();
    s.incomes.push({ id: "r1", name: "Duplex", kind: "rental", freq: "monthly", net: 900, matchMode: "usd", pretax: 0, match: 0, fullMatch: true });
    s.budget.push({ id: "b1", name: "Groceries", group: "Food", amount: 500, inRetirement: true });
    expect(parsePlanState(JSON.stringify(s))).toEqual(s);
    const bad = JSON.parse(JSON.stringify(s));
    bad.incomes[0].kind = "lottery";
    expect(() => parsePlanState(bad)).toThrow(PlanStateError);
  });

  it("income kind and budget group don't change the math", () => {
    const s = defaultPlanState();
    s.incomes.push({ id: "j", name: "Job", freq: "monthly", net: 5000, matchMode: "usd", pretax: 300, match: 150 });
    s.budget.push({ id: "b", name: "Rent", amount: 1500, inRetirement: true });
    const a = run(s, START);
    s.incomes[0]!.kind = "job";
    s.budget[0]!.group = "Housing";
    const b = run(s, START);
    expect(b.fire).toBe(a.fire);
    expect(b.crossing).toBe(a.crossing);
  });

  it("check-ins validate", () => {
    expect(CheckinSchema.parse({ month: "2026-11", invested: 1, cash: 2, debt: 3, netWorth: 0, expectedNextInvested: 1 }).month).toBe("2026-11");
    expect(() => CheckinSchema.parse({ month: "Nov 2026", invested: 1, cash: 2, debt: 3, netWorth: 0, expectedNextInvested: 1 })).toThrow();
  });
});

describe("one-off adjustments", () => {
  it("round-trip, and reject bad months / kinds / negative amounts", () => {
    const s = defaultPlanState();
    s.adjustments = [{ id: "a", month: "2027-01", kind: "expense", amount: 1500, note: "Car repair" }];
    expect(parsePlanState(JSON.stringify(s))).toEqual(s);
    for (const bad of [
      { id: "a", month: "Jan 2027", kind: "expense", amount: 1, note: "" },
      { id: "a", month: "2027-01", kind: "lottery", amount: 1, note: "" },
      { id: "a", month: "2027-01", kind: "expense", amount: -5, note: "" },
    ]) {
      expect(() => parsePlanState({ ...s, adjustments: [bad] })).toThrow(PlanStateError);
    }
  });

  it("plans saved before adjustments existed still load", () => {
    const s = defaultPlanState();
    delete (s as { adjustments?: unknown }).adjustments;
    expect(parsePlanState(JSON.stringify(s)).adjustments).toBeUndefined();
  });
});

describe("emergency mode settings", () => {
  it("round-trip; bad end month rejected", () => {
    const s = defaultPlanState();
    s.emergency = { active: true, until: "2027-02", essentialsOnly: true, pause401k: false };
    s.budget.push({ id: "b", name: "Streaming", amount: 20, inRetirement: true, essential: false });
    expect(parsePlanState(JSON.stringify(s))).toEqual(s);
    expect(() => parsePlanState({ ...s, emergency: { ...s.emergency, until: "Feb 2027" } })).toThrow(PlanStateError);
  });
});
