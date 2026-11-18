import { describe, expect, it } from "vitest";
import { budgetStartCash, budgetView, startTxnId, type Txn } from "../src";

const tx = (id: string, date: string, amount: number, extra: Partial<Txn> = {}): Txn => ({ id, accountId: "chk", date, amount, cleared: "cleared", source: "ynab", updatedAt: 0, ...extra });

describe("the budget's starting money", () => {
  // years of history in checking, but the budget starts in November
  const txns = [
    tx(startTxnId("chk"), "2019-01-01", 1000, { categoryId: "ready" }),
    tx("pay-old", "2026-10-01", 3000, { categoryId: "ready" }),
    tx("rent-old", "2026-10-03", -1500, { categoryId: "rent" }),
    tx("pay", "2026-11-01", 3000, { categoryId: "ready" }),
  ];
  const s = { accounts: [{ id: "chk", name: "Checking", type: "cash" as const, balance: 5500 }] };

  it("is what the account held when the budget started; older transactions are history", () => {
    expect(budgetStartCash(s, txns, "2026-11")).toBe(2500);
    expect(budgetStartCash(s, txns)).toBe(0); // no start month given: as before
    const b = { start: "2026-11", startCash: budgetStartCash(s, txns, "2026-11"), months: { "2026-11": { assigned: { rent: 1500 } } } };
    expect(budgetView(b, [{ key: "rent", moves: false, target: 1500 }], "2026-11", { txns, cards: {} }).readyToAssign).toBe(2500 + 3000 - 1500);
  });
});
