import { describe, expect, it } from "vitest";
import { budgetView, type BudgetState, type Txn } from "../src";

/** Money in or out with no category yet comes out of (or goes into) ready to assign until it gets one. */
describe("money with no category yet", () => {
  const cats = [
    { key: "food", moves: false, target: 0 },
    { key: "debt:chase", moves: true, target: 0 },
  ];
  const cards = { chase: "debt:chase" };
  const b: BudgetState = { start: "2026-11", startCash: 1000, months: { "2026-11": { assigned: { food: 100 } } } };
  const tx = (id: string, extra: Partial<Txn>): Txn => ({ id, accountId: "chk", date: "2026-11-05", amount: -4, cleared: "cleared", source: "manual", updatedAt: 0, ...extra });
  const view = (txns: Txn[]) => budgetView(b, cats, "2026-11", { txns, cards });

  it("spending from cash comes out of ready to assign, and moves to its category once it has one", () => {
    expect(view([]).readyToAssign).toBe(900);
    const v = view([tx("coffee", {})]);
    expect(v.readyToAssign).toBe(896);
    expect(v.uncategorized).toBe(-4);
    expect(v.income).toBe(0);
    const w = view([tx("coffee", { categoryId: "food" })]);
    expect(w.readyToAssign).toBe(900);
    expect(w.lines.food!.available).toBe(96);
    expect(w.uncategorized).toBeUndefined();
  });

  it("on a card, it's set aside for the card from ready to assign", () => {
    const v = view([tx("clinic", { accountId: "chase", amount: -15 })]);
    expect(v.readyToAssign).toBe(885);
    expect(v.lines["debt:chase"]!.available).toBe(15);
  });

  it("money in with no category goes into ready to assign", () => {
    expect(view([tx("gift", { amount: 50 })]).readyToAssign).toBe(950);
  });

  it("transfers, starting balances and ones held for review don't count", () => {
    const v = view([
      tx("xfer", { transferAccountId: "sav" }),
      tx("start:chase", { accountId: "chase", amount: -300 }),
      tx("held", { review: true }),
    ]);
    expect(v.readyToAssign).toBe(900);
    expect(v.uncategorized).toBeUndefined();
  });
});
