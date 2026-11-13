import { describe, expect, it } from "vitest";
import { defaultPlanState, diffRows, planToRows, PlanStateSchema, rowsToPlan, type PlanRows } from "../src";
import { canon, fullPlan } from "./fullPlan";

describe("plan ↔ rows", () => {
  it("a full plan comes back the same", () => {
    const s = PlanStateSchema.parse(fullPlan());
    const todo = { "2026-11": ["match", "ef"], "2026-10": ["ira"] };
    const back = rowsToPlan(planToRows(s, todo, true));
    expect(canon(back.plan)).toEqual(canon(s));
    expect(PlanStateSchema.safeParse(back.plan).success).toBe(true);
    expect(back.todoDone).toEqual(todo);
    expect(back.onboarded).toBe(true);
  });

  it("a new plan comes back the same", () => {
    const s = defaultPlanState();
    expect(canon(rowsToPlan(planToRows(s)).plan)).toEqual(canon(s));
  });

  it("rows survive the trip (what the database sends back is what was saved)", () => {
    const rows = planToRows(fullPlan());
    const again = planToRows(rowsToPlan(rows).plan);
    expect(diffRows(rows, again)).toEqual({});
  });

  it("a save sends only what changed", () => {
    const s = fullPlan();
    const base = planToRows(s);
    const next = structuredClone(s);
    next.accounts[1]!.balance = 14000;
    next.debts = next.debts.filter((d) => d.id !== "cc");
    next.budgetPlan!.months["2026-11"] = { assigned: { food: 950 } };
    const ch = diffRows(base, planToRows(next));
    expect(Object.keys(ch).sort()).toEqual(["account", "budget_amount", "debt"]);
    expect(ch.account!.upsert.map((r) => r.id)).toEqual(["chk"]);
    // the Visa is gone, and the loan after it moved up one place
    expect(ch.debt!.delete).toEqual([{ id: "cc" }]);
    expect(ch.debt!.upsert.map((r) => [r.id, r.sort])).toEqual([["loan", 2]]);
    expect(ch.budget_amount!.upsert).toEqual([{ month: "2026-11", key: "food", assigned: 950, spent: null }]);
    // the first save sends everything
    const all = diffRows(undefined, base) as Record<string, { upsert: unknown[] }>;
    expect(all.account!.upsert).toHaveLength(3);
  });

  it("every column the rows use exists for each table", () => {
    // keep the SQL and the mapping in step: the same column names on every row of a table
    const rows: PlanRows = planToRows(fullPlan());
    for (const [table, list] of Object.entries(rows.tables)) {
      const cols = new Set(list.flatMap((r) => Object.keys(r)));
      for (const r of list) expect([table, Object.keys(r).length]).toEqual([table, cols.size]);
    }
  });
});
