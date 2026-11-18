import { describe, expect, it } from "vitest";
import { budgetView, type BudgetState, type Txn } from "../src";

/**
 * A budget that starts from another app's numbers (an import): each category starts with what it had
 * left, and money can be taken back out of a category to Unassigned.
 */
describe("starting amounts and taking money back", () => {
  const cats = [
    { key: "food", moves: false, target: 0 },
    { key: "fun", moves: false, target: 0 },
    { key: "debt:chase", moves: true, target: 0 },
  ];
  const cards = { chase: "debt:chase" };
  // $1,000 in checking when the budget starts (startCash), $500 pay in November
  const txns: Txn[] = [{ id: "pay", accountId: "chk", date: "2026-11-01", amount: 500, categoryId: "ready", cleared: "cleared", source: "manual", updatedAt: 0 }];
  const view = (b: BudgetState, m = "2026-11") => budgetView(b, cats, m, { txns, cards });
  const base = (extra: Partial<BudgetState> = {}): BudgetState => ({ start: "2026-11", startCash: 1000, months: {}, ...extra });

  it("each category starts with its amount, and that money isn't in Unassigned", () => {
    const v = view(base({ opening: { food: 100, "debt:chase": 300 } }));
    expect(v.lines.food!.carried).toBe(100);
    expect(v.lines.food!.available).toBe(100);
    expect(v.lines["debt:chase"]!.available).toBe(300);
    expect(v.readyToAssign).toBe(1000 + 500 - 400);
  });

  it("a negative starting amount is cash overspending from before: it comes out of the first month", () => {
    const v = view(base({ opening: { food: 100, fun: -40 } }));
    expect(v.lines.fun!.available).toBe(0);
    expect(v.overspentBefore).toBe(40);
    expect(v.readyToAssign).toBe(1000 + 500 - 100 - 40);
  });

  it("a negative amount takes money back to Unassigned, never more than the category had", () => {
    const b = base({ opening: { food: 100 }, months: { "2026-11": { assigned: { food: -30 } } } });
    expect(view(b).lines.food!.assigned).toBe(-30);
    expect(view(b).lines.food!.available).toBe(70);
    expect(view(b).readyToAssign).toBe(1000 + 500 - 100 + 30);
    // asking for $250 back from $100: only $100 comes back
    const most = base({ opening: { food: 100 }, months: { "2026-11": { assigned: { food: -250, fun: -10 } } } });
    expect(view(most).lines.food!.assigned).toBe(-100);
    expect(view(most).lines.fun!.assigned).toBe(0);
    expect(view(most).readyToAssign).toBe(1000 + 500);
  });

  it("a transaction held for review doesn't count in the budget until it's accepted", () => {
    const shop: Txn = { id: "shop", accountId: "chk", date: "2026-11-05", amount: -40, categoryId: "food", cleared: "uncleared", source: "ynab", updatedAt: 0, review: true };
    const b = base({ opening: { food: 100 } });
    expect(budgetView(b, cats, "2026-11", { txns: [...txns, shop], cards }).lines.food!.spent).toBe(0);
    expect(budgetView(b, cats, "2026-11", { txns: [...txns, { ...shop, review: undefined }], cards }).lines.food!.spent).toBe(40);
  });

  it("the starting amounts only start the first month; later months carry on as usual", () => {
    const dec = view(base({ opening: { food: 100 } }), "2026-12");
    expect(dec.lines.food!.carried).toBe(100);
    expect(dec.readyToAssign).toBe(1000 + 500 - 100);
  });
});
