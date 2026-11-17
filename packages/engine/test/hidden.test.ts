import { describe, expect, it } from "vitest";
import { budgetCategories, budgetView, derive, simulatePlan, type Txn } from "../src";
import { START, sampleState } from "./fixtures";

describe("hidden categories", () => {
  const withHidden = () => {
    const s = sampleState();
    s.budget.push({ id: "moving", name: "Moving", amount: 900, inRetirement: true, group: "Life", hidden: true });
    return s;
  };

  it("stay out of the plan: no monthly amount, not in the retirement number", () => {
    const plain = derive(sampleState(), START);
    const d = derive(withHidden(), START);
    expect(d.budgetTotal).toBe(plain.budgetTotal);
    expect(d.retireMonthlyBudget).toBe(plain.retireMonthlyBudget);
  });

  it("are still categories (target 0, marked hidden), so their spending counts", () => {
    const s = withHidden();
    const d = derive(s, START);
    const cats = budgetCategories(s, d, simulatePlan(s, d), START, "2026-11");
    const moving = cats.find((c) => c.key === "moving")!;
    expect(moving).toMatchObject({ hidden: true, target: 0, kind: "spending" });
    const txns: Txn[] = [
      { id: "pay", accountId: "chk", date: "2026-11-01", amount: 2000, categoryId: "ready", cleared: "cleared", source: "manual", updatedAt: 0 },
      { id: "van", accountId: "chk", date: "2026-11-05", amount: -300, categoryId: "moving", cleared: "cleared", source: "manual", updatedAt: 0 },
    ];
    const b = { start: "2026-11", startCash: 0, months: {} };
    const nov = budgetView(b, cats, "2026-11", { txns, cards: {} });
    // overspent (nothing assigned): it shows as overspent, and next month's money to assign is lower by it
    expect(nov.lines.moving!.available).toBe(-300);
    expect(budgetView(b, cats, "2026-12", { txns, cards: {} }).overspentBefore).toBe(300);
  });
});
