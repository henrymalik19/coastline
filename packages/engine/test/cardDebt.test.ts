import { describe, expect, it } from "vitest";
import { budgetView, type BudgetState, type Txn } from "../src";

/**
 * $100 in Groceries, $150 spent on the Chase card: $50 over. The three ways to handle it:
 * cover it, let it come out of next month's Unassigned (the default), or leave it on the card as debt.
 */
describe("overspending on a credit card", () => {
  const cats = [
    { key: "food", moves: false, target: 100 },
    { key: "fun", moves: false, target: 0 },
    { key: "debt:chase", moves: true, target: 0 },
  ];
  const cards = { chase: "debt:chase" };
  const txns: Txn[] = [
    { id: "pay", accountId: "chk", date: "2026-11-01", amount: 1000, categoryId: "ready", cleared: "cleared", source: "manual", updatedAt: 0 },
    { id: "shop", accountId: "chase", date: "2026-11-05", amount: -150, categoryId: "food", cleared: "cleared", source: "manual", updatedAt: 0 },
  ];
  const plan = (cardDebt?: BudgetState["months"][string]["cardDebt"], extra: Record<string, number> = {}): BudgetState => ({
    start: "2026-11",
    startCash: 0,
    months: { "2026-11": { assigned: { food: 100, fun: 200, ...extra }, ...(cardDebt ? { cardDebt } : {}) } },
  });
  const view = (b: BudgetState, m: string) => budgetView(b, cats, m, { txns, cards });

  it("by default the whole purchase is set aside for the card, and the $50 comes out of next month", () => {
    const nov = view(plan(), "2026-11");
    expect(nov.lines.food!.available).toBe(-50);
    expect(nov.lines["debt:chase"]!.available).toBe(150);
    expect(nov.lines.food!.onCards).toEqual({ "debt:chase": 150 });
    expect(view(plan(), "2026-12").overspentBefore).toBe(50);
    expect(view(plan(), "2026-12").readyToAssign).toBe(1000 - 300 - 50);
  });

  it("covered: nothing comes out of next month", () => {
    const b = plan(undefined, { food: 150, fun: 150 });
    expect(view(b, "2026-11").lines.food!.available).toBe(0);
    expect(view(b, "2026-12").overspentBefore).toBe(0);
  });

  it("left on the card as debt: next month's Unassigned isn't touched, and the card's line holds $50 less (short)", () => {
    const b = plan([{ cat: "food", card: "debt:chase", amount: 50 }]);
    const nov = view(b, "2026-11");
    expect(nov.lines.food!.available).toBe(-50);
    expect(nov.lines.food!.toDebt).toBe(50);
    expect(nov.lines["debt:chase"]!.available).toBe(100);
    expect(nov.lines["debt:chase"]!.uncovered).toBe(50);
    const dec = view(b, "2026-12");
    expect(dec.overspentBefore).toBe(0);
    expect(dec.readyToAssign).toBe(1000 - 300);
    // the category starts fresh; the card's line carries the $100 that's really set aside
    expect(dec.lines.food!.available).toBe(0);
    expect(dec.lines["debt:chase"]!.available).toBe(100);
  });

  it("never more than the category went over (a later refund or an assigned top-up shrinks it)", () => {
    const b = plan([{ cat: "food", card: "debt:chase", amount: 80 }], { food: 120 });
    const nov = view(b, "2026-11");
    expect(nov.lines.food!.toDebt).toBe(30);
    expect(nov.lines["debt:chase"]!.available).toBe(120);
    expect(view(b, "2026-12").overspentBefore).toBe(0);
  });

  it("partly: the rest still comes out of next month", () => {
    const b = plan([{ cat: "food", card: "debt:chase", amount: 20 }]);
    expect(view(b, "2026-12").overspentBefore).toBe(30);
    expect(view(b, "2026-11").lines["debt:chase"]!.available).toBe(130);
  });
});
