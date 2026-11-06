import { run } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { defaultPlanState, importPrototypeJson, parsePlanState, PlanStateError } from "../src";
import v1 from "./fixtures/prototype-v1.json";
import v2 from "./fixtures/prototype-v2.json";

const START = new Date(2026, 10, 6);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ref: any = createRequire(import.meta.url)("../../../reference/engine.js");

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

describe("importPrototypeJson", () => {
  it("prototype v2 export (its SAMPLE): ids added, '' payday dropped, check-ins split out, nothing else lost", () => {
    const raw = JSON.parse(JSON.stringify(v2));
    const { state, checkins, fromVersion } = importPrototypeJson(JSON.stringify(raw));
    expect(fromVersion).toBe(2);
    expect(checkins).toEqual(raw.checkins);
    expect(state.budget.map((b) => b.id)).toEqual(["b1", "b2", "b3", "b4", "b5", "b6", "b7"]);
    expect(state.accounts.map((a) => a.id)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(state.incomes[1]!.nextPayday).toBeUndefined();
    expect("_updatedAt" in state).toBe(false);
    // every field the prototype had survives (minus ids we added and the split-out keys)
    const strip = (rows: { id?: string }[]) => rows.map(({ id: _id, ...r }) => r);
    expect(strip(state.budget)).toEqual(raw.budget);
    expect(strip(state.accounts)).toEqual(raw.accounts);
    expect(state.debts).toEqual(raw.debts);
    expect(state.goals).toEqual(raw.goals);
    expect(state.plan).toEqual(raw.plan);
    expect(state.limits).toEqual(raw.limits);
    const { nextPayday: _np, ...side } = raw.incomes[1];
    expect(state.incomes).toEqual([raw.incomes[0], side]);
    for (const k of ["age", "retireAge", "healthcare", "currentInvestMonthly", "contribGrowth", "ret", "vol", "fee", "swr", "taxRate"]) {
      expect(state[k as keyof typeof state]).toEqual(raw[k]);
    }
  });

  it("imported v2 state gives the same engine result as the prototype on its raw JSON", () => {
    const { state } = importPrototypeJson(JSON.stringify(v2));
    const ours = run(state, START);
    const theirs = ref.run(JSON.parse(JSON.stringify(v2)), START);
    expect(ours.fire).toBe(theirs.fire);
    expect(ours.crossing).toBe(theirs.crossing);
    expect(ours.crossingC).toBe(theirs.crossingC);
    expect(ours.mc.probFire).toBe(theirs.mc.probFire);
    expect(ours.plan.events).toEqual(theirs.plan.events);
  });

  it("prototype v1 export migrates the way the prototype's migrate() does", () => {
    const { state, checkins, fromVersion } = importPrototypeJson(v1);
    expect(fromVersion).toBe(1);
    expect(checkins).toEqual([]);
    expect(state).toMatchObject({
      version: 2, age: 34, retireAge: 58, healthcare: 800, ret: 0.045, vol: 0.16, fee: 0.0005, swr: 0.0375, taxRate: 0.1, contribGrowth: 0.005,
      currentInvestMonthly: Math.round((100 * 52) / 12),
      debts: [], goals: [],
    });
    expect(state.incomes).toEqual([
      { id: "inc1", name: "Main job", freq: "weekly", net: 1150, pretax: 120, match: 60, fullMatch: true,
        matchMode: "usd", gross: 0, contribPct: 0, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0, matchUpTo2: 0 },
    ]);
    expect(state.budget).toEqual([
      { id: "b1", name: "Rent", amount: 1700, inRetirement: true },
      { id: "b2", name: "Daycare", amount: 900, inRetirement: false },
    ]);
    expect(state.accounts.map((a) => [a.id, a.type, a.balance])).toEqual([["a1", "pretax", 61000], ["a2", "cash", 9000]]);
    expect(state.plan.steps.some((s) => s.startsWith("goal:"))).toBe(false);
  });

  it("goal steps are synced to the goals list", () => {
    const raw = JSON.parse(JSON.stringify(v2));
    raw.goals.push({ id: "g2", name: "Car", target: 8000, saved: 0 });
    raw.plan.steps.unshift("goal:gone");
    const { state } = importPrototypeJson(raw);
    expect(state.plan.steps).toEqual(["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "goal:g1", "k401", "lowDebt", "goal:g2", "taxable"]);
  });

  it("rejects junk with a readable message", () => {
    expect(() => importPrototypeJson("not json")).toThrow(/valid export/);
    expect(() => importPrototypeJson("[1,2]")).toThrow(PlanStateError);
  });
});
