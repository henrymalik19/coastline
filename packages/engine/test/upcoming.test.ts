import { describe, expect, it } from "vitest";
import { budgetView, isUpcoming, registerBalance, txnActivity, type Txn } from "../src";

const txn = (over: Partial<Txn>): Txn => ({ id: "t", accountId: "chk", date: "2026-11-10", amount: -50, cleared: "uncleared", source: "manual", updatedAt: 0, ...over });

describe("upcoming transactions (dated after today)", () => {
  const today = "2026-11-17";
  const txns = [
    txn({ id: "pay", date: "2026-11-01", amount: 3000, categoryId: "ready" }),
    txn({ id: "food", date: "2026-11-10", amount: -120, categoryId: "groceries" }),
    txn({ id: "rent", date: "2026-11-28", amount: -1500, categoryId: "rent" }),
  ];

  it("knows which are upcoming", () => {
    expect(isUpcoming(txns[2]!, today)).toBe(true);
    expect(isUpcoming(txns[1]!, today)).toBe(false);
    expect(isUpcoming(txns[2]!)).toBe(false); // no date given: everything counts
    expect(isUpcoming(txn({ date: today }), today)).toBe(false); // today counts
  });

  it("leaves them out of the balance until their day", () => {
    expect(registerBalance(0, txns, "chk", false, today)).toBe(2880);
    expect(registerBalance(0, txns, "chk", false, "2026-11-28")).toBe(1380);
    expect(registerBalance(0, txns, "chk")).toBe(1380);
  });

  it("leaves them out of the month's spending until their day", () => {
    const now = txnActivity(txns, "2026-11", {}, today);
    expect(now.spent).toEqual({ groceries: 120 });
    expect(now.income).toBe(3000);
    expect(txnActivity(txns, "2026-11", {}, "2026-11-30").spent).toEqual({ groceries: 120, rent: 1500 });
  });

  it("keeps the category's money available until it's spent", () => {
    const b = { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { rent: 1500, groceries: 400 } } } };
    const cats = [{ key: "rent", moves: false, target: 1500 }, { key: "groceries", moves: false, target: 400 }];
    expect(budgetView(b, cats, "2026-11", { txns, cards: {}, asOf: today }).lines.rent!.available).toBe(1500);
    expect(budgetView(b, cats, "2026-11", { txns, cards: {}, asOf: "2026-11-28" }).lines.rent!.available).toBe(0);
  });
});
