import { describe, expect, it } from "vitest";
import { PlanStateSchema, withProperties } from "@coastfi/schema";
import { planFromSnapshot, snapshotOf } from "./planSnapshot";
import { freshPlan } from "./presets";

describe("plan snapshots (plan history)", () => {
  it("a device's plan comes back the same from a snapshot", () => {
    const plan = freshPlan();
    plan.budget = [...plan.budget, { id: "old", name: "Old Restaurants", amount: 0, inRetirement: false, group: "Hidden", hidden: true } as (typeof plan.budget)[number]];
    const snap = snapshotOf(plan, { "2026-11": ["a"] }, true, 1234);
    const back = planFromSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(back.client_updated_at).toBe(1234);
    expect(back.onboarded).toBe(true);
    expect(back.todo_done).toEqual({ "2026-11": ["a"] });
    const ok = PlanStateSchema.safeParse(back.state);
    expect(ok.success).toBe(true);
    expect(ok.success && ok.data.budget.find((b) => b.id === "old")?.hidden).toBe(true);
    expect(ok.success && ok.data.budget.length).toBe(withProperties(plan).budget.length);
  });
  it("reads an old plan still saved as JSON", () => {
    const back = planFromSnapshot({ plan: { client_updated_at: 5, onboarded: true, legacy_state: { x: 1 }, legacy_todo_done: {} } });
    expect(back.legacy).toBe(true);
    expect(back.state).toEqual({ x: 1 });
  });
});
