import type { PlanState, Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { applyRegisterBalances, applyTracked, foldSavingsLines, liveBudget, startTxnFor } from "./register";

function plan(): PlanState {
  const p = freshPlan();
  p.accounts = [
    { id: "chk", name: "Checking", type: "cash", balance: 2_000 },
    { id: "ira", name: "Roth IRA", type: "roth", balance: 10_000 },
  ];
  p.debts = [{ id: "car", name: "Car", kind: "car", balance: 5_000, apr: 0.05, minPayment: 300 }];
  p.budgetPlan = { start: "2026-11", startCash: 2_000, months: {} };
  return p;
}
const txn = (x: Partial<Txn>): Txn => ({ id: "t1", accountId: "chk", date: "2026-11-05", amount: -500, cleared: "cleared", source: "manual", updatedAt: 1, ...x });

describe("transfers to accounts you don't budget", () => {
  it("a transfer to the IRA adds to it; changing and deleting it moves it back", () => {
    const p = plan();
    const first = txn({ transferAccountId: "ira" });
    const moved = applyTracked(p, undefined, first);
    expect(moved).toBe(500);
    expect(p.accounts[1]!.balance).toBe(10_500);
    // the transaction keeps what it moved, so a change undoes exactly that first
    const changed = txn({ transferAccountId: "ira", amount: -800 });
    expect(applyTracked(p, { ...first, trackedAmount: moved }, changed)).toBe(800);
    expect(p.accounts[1]!.balance).toBe(10_800);
    expect(applyTracked(p, { ...changed, trackedAmount: 800 }, null)).toBeUndefined();
    expect(p.accounts[1]!.balance).toBe(10_000);
  });

  it("a withdrawal (money in to checking from the IRA) lowers it", () => {
    const p = plan();
    applyTracked(p, undefined, txn({ amount: 1_200, transferAccountId: "ira", categoryId: "ready" }));
    expect(p.accounts[1]!.balance).toBe(8_800);
  });

  it("a loan payment lowers what you owe", () => {
    const p = plan();
    applyTracked(p, undefined, txn({ amount: -300, transferAccountId: "car", categoryId: "debt:car" }));
    expect(p.debts[0]!.balance).toBe(4_700);
  });

  it("old per-account lines: cash folds into Emergency fund, an IRA's into the category linked to it", () => {
    const p = plan();
    p.accounts.push({ id: "sav", name: "Savings", type: "cash", balance: 0 }, { id: "brk", name: "Brokerage", type: "taxable", balance: 0 });
    p.budget.push({ id: "roth", name: "Roth IRA", amount: 0, inRetirement: false, accountId: "ira" });
    p.budgetPlan!.months = { "2026-11": { assigned: { "acct:chk": 100, "acct:sav": 200, "acct:ira": 300, "acct:brk": 40, rent: 50, cash: 5 } } };
    foldSavingsLines(p);
    // the brokerage has no category: its money goes back to ready to assign
    expect(p.budgetPlan!.months["2026-11"]!.assigned).toEqual({ rent: 50, cash: 305, roth: 300 });
    foldSavingsLines(p);
    expect(p.budgetPlan!.months["2026-11"]!.assigned).toEqual({ rent: 50, cash: 305, roth: 300 });
  });

  it("leaves transfers between budget accounts and plain spending alone", () => {
    const p = plan();
    expect(applyTracked(p, undefined, txn({ categoryId: "item:x" }))).toBeUndefined();
    expect(p.accounts[1]!.balance).toBe(10_000);
  });
});

describe("starting balances", () => {
  it("an account's first transaction starts its register; its balance is the sum of its transactions", () => {
    const p = plan();
    const spend = txn({ amount: -150, categoryId: "food" });
    const start = startTxnFor(p, [spend], "chk", "2026-11-05")!;
    expect(start).toMatchObject({ id: "start:chk", amount: 2_000, categoryId: "ready", payee: "Starting balance" });
    expect(startTxnFor(p, [start, spend], "chk", "2026-11-05")).toBeNull(); // only once
    applyRegisterBalances(p, [start, spend]);
    expect(p.accounts[0]!.balance).toBe(1_850);
    // its money now reaches ready to assign through the starting balance, not the start cash
    expect(liveBudget(p, [start, spend])!.startCash).toBe(0);
    expect(liveBudget(p, [])!.startCash).toBe(1_850);
  });

  it("a card's starting balance is what you owe, with no category", () => {
    const p = plan();
    p.debts.push({ id: "visa", name: "Visa", kind: "credit_card", balance: 300, apr: 0.24, minPayment: 30 });
    const start = startTxnFor(p, [], "visa", "2026-11-05")!;
    expect(start.amount).toBe(-300);
    expect(start.categoryId).toBeUndefined();
    applyRegisterBalances(p, [start, txn({ id: "c1", accountId: "visa", amount: -50, categoryId: "food" })]);
    expect(p.debts.find((d) => d.id === "visa")!.balance).toBe(350);
  });
});
