import { describe, expect, it } from "vitest";
import type { PlanState, Txn } from "@coastfi/engine";
import { freshPlan } from "./presets";
import { combineCategory, txnsIn, uncombineTxns } from "./combine";

describe("combining one category into another", () => {
  const setup = () => {
    const p: PlanState = freshPlan();
    p.budget = [
      { id: "dining", name: "Dining", amount: 100, inRetirement: true, group: "Food" },
      { id: "eat", name: "Eating Out", amount: 200, inRetirement: false, group: "Fun" },
      { id: "rent", name: "Rent", amount: 1500, inRetirement: true },
    ];
    p.budgetPlan = {
      start: "2026-10", startCash: 0, opening: { dining: 20, eat: 5 },
      months: {
        "2026-10": { assigned: { dining: 50 } },
        "2026-11": { assigned: { dining: 100, eat: 150, rent: 1500 }, cardDebt: [{ cat: "dining", card: "debt:v", amount: 10 }, { cat: "eat", card: "debt:v", amount: 5 }] },
      },
    };
    const tx = (id: string, extra: Partial<Txn>): Txn => ({ id, accountId: "chk", date: "2026-11-05", amount: -20, cleared: "cleared", source: "manual", updatedAt: 1, ...extra });
    const txns = [
      tx("a", { categoryId: "dining" }),
      tx("b", { categoryId: "eat" }),
      tx("c", { splits: [{ categoryId: "dining", amount: -5 }, { categoryId: "rent", amount: -15 }] }),
      tx("d", { categoryId: "dining", deleted: true }),
    ];
    return { p, txns };
  };

  it("moves its transactions, adds its amounts month by month, and removes it", () => {
    const { p, txns } = setup();
    expect(txnsIn(txns, "dining")).toBe(2);
    const r = combineCategory(p, txns, "dining", "eat", 9);
    expect(r.plan.budget.map((b) => b.id)).toEqual(["eat", "rent"]);
    // the other keeps its own name, group and switch; the plan amounts add
    expect(r.plan.budget[0]).toMatchObject({ name: "Eating Out", group: "Fun", inRetirement: false, amount: 300 });
    expect(r.plan.budgetPlan!.months["2026-10"]!.assigned).toEqual({ eat: 50 });
    expect(r.plan.budgetPlan!.months["2026-11"]!.assigned).toEqual({ eat: 250, rent: 1500 });
    expect(r.plan.budgetPlan!.months["2026-11"]!.cardDebt).toEqual([{ cat: "eat", card: "debt:v", amount: 15 }]);
    expect(r.plan.budgetPlan!.opening).toEqual({ eat: 25 });
    expect(r.txns.find((t) => t.id === "a")).toMatchObject({ categoryId: "eat", updatedAt: 9 });
    expect(r.txns.find((t) => t.id === "c")!.splits!.map((x) => x.categoryId)).toEqual(["eat", "rent"]);
    // a deleted one stays as it was; one not in it isn't touched
    expect(r.txns.find((t) => t.id === "d")!.categoryId).toBe("dining");
    expect(r.txns.find((t) => t.id === "b")!.updatedAt).toBe(1);
    expect(r.changed.map((t) => t.id)).toEqual(["a", "c"]);
  });

  it("undoes: the transactions it changed come back as they were (newer, so they sync)", () => {
    const { p, txns } = setup();
    const r = combineCategory(p, txns, "dining", "eat", 9);
    const back = uncombineTxns(r.txns, r.changed, 12);
    expect(back.find((t) => t.id === "a")).toMatchObject({ categoryId: "dining", updatedAt: 12 });
    expect(back.find((t) => t.id === "c")!.splits!.map((x) => x.categoryId)).toEqual(["dining", "rent"]);
  });
});
