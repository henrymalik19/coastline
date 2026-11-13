import { describe, expect, it } from "vitest";
import { defaultPlanState, diffRows, planToRows, PlanStateSchema, rowsToPlan, type PlanRows } from "../src";
import { canon, fullPlan } from "./fullPlan";

describe("plan ↔ rows", () => {
  it("a full plan comes back the same", () => {
    const s = PlanStateSchema.parse(fullPlan());
    const todo = { "2026-11": ["match", "ef"], "2026-10": ["ira"] };
    const back = rowsToPlan(planToRows(s, todo, true));
    // limits aren't saved with a plan (everyone shares one table)
    expect(canon(back.plan)).toEqual(canon({ ...s, limits: [] }));
    expect(PlanStateSchema.safeParse(back.plan).success).toBe(true);
    expect(back.todoDone).toEqual(todo);
    expect(back.onboarded).toBe(true);
  });

  it("a new plan comes back the same", () => {
    const s = defaultPlanState();
    expect(canon(rowsToPlan(planToRows(s)).plan)).toEqual(canon({ ...s, limits: [] }));
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
    expect(Object.keys(ch).sort()).toEqual(["account", "budget_assignment", "debt"]);
    expect(ch.account!.upsert.map((r) => r.id)).toEqual(["chk"]);
    // the Visa is gone, and the loan after it moved up one place
    expect(ch.debt!.delete).toEqual([{ id: "cc" }]);
    expect(ch.debt!.upsert.map((r) => [r.id, r.sort])).toEqual([["loan", 2]]);
    expect(ch.budget_assignment!.upsert).toEqual([{ month: "2026-11", key: "food", assigned: 950 }]);
    // the first save sends everything
    const all = diffRows(undefined, base) as Record<string, { upsert: unknown[] }>;
    expect(all.account!.upsert).toHaveLength(2);
    expect(all.property!.upsert).toHaveLength(2);
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

describe("homes and rentals from before properties", () => {
  it("property accounts and rental mortgages become properties, linked to their mortgage and rent", async () => {
    const { withProperties } = await import("../src");
    const s = defaultPlanState();
    s.incomes = [{ id: "i1", name: "710 Dillon Way", kind: "rental", freq: "monthly", net: 900, matchMode: "usd" }];
    s.accounts = [
      { id: "prop-i1", name: "710 Dillon Way", type: "property", balance: 300000 },
      { id: "home", name: "840 Madison", type: "property", balance: 500000, homeCosts: 6000, upkeep: 0.01 },
      { id: "chk", name: "Checking", type: "cash", balance: 1000 },
    ];
    s.debts = [
      { id: "d1", name: "710 Dillon Way", kind: "mortgage", balance: 175000, apr: 0.033, minPayment: 1147, rental: true },
      { id: "d2", name: "840 Madison", kind: "mortgage", balance: 360000, apr: 0.061, minPayment: 3572 },
    ];
    const out = withProperties(s);
    expect(out.accounts.map((a) => a.id)).toEqual(["chk"]);
    expect(out.debts.some((d) => "rental" in d)).toBe(false);
    expect(out.properties).toEqual([
      { id: "prop-i1", name: "710 Dillon Way", kind: "rental", value: 300000, mortgageId: "d1", incomeId: "i1" },
      { id: "home", name: "840 Madison", kind: "home", value: 500000, mortgageId: "d2", taxInsurance: 6000, upkeep: 0.01 },
    ]);
    // already converted: nothing changes
    expect(withProperties(out)).toBe(out);
  });
});
