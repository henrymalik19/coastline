import { describe, expect, it } from "vitest";
import { budgetView, registerBalance, transferPair, txnActivity, type BudgetState, type Txn } from "../src";

let n = 0;
const tx = (accountId: string, date: string, amount: number, more: Partial<Txn> = {}): Txn => ({
  id: "t" + ++n, accountId, date, amount, cleared: "cleared", source: "manual", updatedAt: 1, ...more,
});
const cards = { visa: "debt:visa" };

describe("transactions in the budget", () => {
  it("income is ready to assign, spending comes out of its category, transfers between budget accounts don't count", () => {
    const pay = tx("chk", "2026-11-14", 4000, { categoryId: "ready" });
    const food = tx("chk", "2026-11-15", -120, { categoryId: "food" });
    const move = tx("chk", "2026-11-16", -500, { transferAccountId: "sav" });
    const a = txnActivity([pay, food, move, transferPair(move)!], "2026-11", cards);
    expect(a.income).toBe(4000);
    expect(a.spent).toEqual({ food: 120 });
  });

  it("credit cards the envelope way: spending moves money to the card's payment; paying the card spends it", () => {
    const groceries = tx("visa", "2026-11-03", -200, { categoryId: "food" });
    const refund = tx("visa", "2026-11-04", 20, { categoryId: "food" });
    const payment = tx("chk", "2026-11-20", -180, { transferAccountId: "visa" });
    const a = txnActivity([groceries, refund, payment, transferPair(payment)!], "2026-11", cards);
    expect(a.spent.food).toBe(180);
    expect(a.cardFunded["debt:visa"]).toBe(180);
    expect(a.spent["debt:visa"]).toBe(180); // the payment, counted once

    const b: BudgetState = { start: "2026-11", startCash: 1000, months: { "2026-11": { assigned: { food: 300 } } } };
    const v = budgetView(b, [{ key: "food", moves: false, target: 300 }, { key: "debt:visa", moves: true, target: 0 }], "2026-11", { txns: [groceries, refund, payment, transferPair(payment)!], cards });
    expect(v.lines.food!.available).toBe(120);
    expect(v.lines["debt:visa"]!.funded).toBe(180);
    expect(v.lines["debt:visa"]!.available).toBe(0); // funded by the spending, then paid
  });

  it("a transfer to an IRA comes out of the category you picked, or ready to assign", () => {
    const linked = tx("chk", "2026-11-05", -500, { transferAccountId: "ira", categoryId: "roth" });
    const none = tx("chk", "2026-11-06", -200, { transferAccountId: "ira", categoryId: "ready" });
    const old = tx("chk", "2026-11-07", -100, { transferAccountId: "ira", categoryId: "acct:ira" }); // filed under the account's old line
    const a = txnActivity([linked, none, old], "2026-11", cards);
    expect(a.spent).toEqual({ roth: 500 });
    expect(a.income).toBe(-300);
  });

  it("splits spend from each category", () => {
    const t = tx("chk", "2026-11-09", -90, { splits: [{ categoryId: "food", amount: -60 }, { categoryId: "home", amount: -30 }] });
    expect(txnActivity([t], "2026-11", cards).spent).toEqual({ food: 60, home: 30 });
  });

  it("register balances: opening + everything since; deleted ones don't count", () => {
    const list = [tx("chk", "2026-11-01", -50), tx("chk", "2026-11-02", 100, { cleared: "uncleared" }), tx("chk", "2026-11-03", -10, { deleted: true }), tx("sav", "2026-11-01", 999)];
    expect(registerBalance(1000, list, "chk")).toBe(1050);
    expect(registerBalance(1000, list, "chk", true)).toBe(950);
  });

  it("with transactions, ready to assign + money in categories = cash in budget accounts", () => {
    const list = [
      tx("chk", "2026-11-01", 3000, { categoryId: "ready" }),
      tx("chk", "2026-11-02", -1200, { categoryId: "rent" }),
      tx("visa", "2026-11-05", -300, { categoryId: "food" }),
    ];
    const b: BudgetState = { start: "2026-11", startCash: 500, months: { "2026-11": { assigned: { rent: 1200, food: 400, "debt:visa": 0 } } } };
    const cats = [{ key: "rent", moves: false, target: 0 }, { key: "food", moves: false, target: 0 }, { key: "debt:visa", moves: true, target: 0 }];
    const v = budgetView(b, cats, "2026-11", { txns: list, cards });
    const inCats = Object.values(v.lines).reduce((a, l) => a + l.available, 0);
    const cash = 500 + 3000 - 1200; // checking
    const owedOnCard = 300;
    expect(v.readyToAssign + inCats).toBeCloseTo(cash, 9); // the card's payment category holds what you owe
    expect(v.lines["debt:visa"]!.available).toBe(owedOnCard);
  });
});
