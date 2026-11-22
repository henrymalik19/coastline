import { describe, expect, it } from "vitest";
import { salvagePlan, salvageTxns } from "./salvage";
import { freshPlan } from "./presets";

const txn = (id: string) => ({ id, accountId: "a", date: "2026-01-02", amount: -5, cleared: "cleared", source: "manual", updatedAt: 1 });

describe("reading a damaged saved copy", () => {
  it("keeps a plan whose items all pass", () => {
    const r = salvagePlan(freshPlan());
    expect(r.plan).toBeDefined();
    expect(r.dropped).toBe(0);
  });
  it("drops only the bad item instead of blanking the whole plan", () => {
    const plan = freshPlan() as unknown as Record<string, unknown[]>;
    const good = plan.budget!.length;
    plan.budget = [...plan.budget!, { id: "broken", name: 5 }];
    const r = salvagePlan(plan);
    expect(r.plan?.budget.length).toBe(good);
    expect(r.dropped).toBe(1);
  });
  it("gives up only when the plan itself is unreadable", () => {
    expect(salvagePlan({ version: 2, age: "old" }).plan).toBeUndefined();
    expect(salvagePlan(null).plan).toBeUndefined();
  });
  it("keeps the good transactions when one is bad", () => {
    const r = salvageTxns([txn("a"), { id: "b", amount: "x" }, txn("c")]);
    expect(r.txns.map((t) => t.id)).toEqual(["a", "c"]);
    expect(r.dropped).toBe(1);
    expect(salvageTxns(undefined)).toEqual({ txns: [], dropped: 0 });
  });
});

describe("one bad account entry", () => {
  for (const bad of [{ id: "x", name: "Broken", type: "cash", balance: "abc" }, { id: "x", name: 5 }, null, "junk"]) {
    it(`keeps the plan with ${JSON.stringify(bad)}`, () => {
      const p = freshPlan() as unknown as { accounts: unknown[] };
      p.accounts = [...p.accounts, bad];
      expect(salvagePlan(p).plan).toBeDefined();
    });
  }
});
