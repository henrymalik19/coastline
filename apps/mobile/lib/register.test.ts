import type { PlanState, Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { freshPlan } from "./presets";
import { applyTracked } from "./register";

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
    applyTracked(p, "t1", txn({ transferAccountId: "ira" }));
    expect(p.accounts[1]!.balance).toBe(10_500);
    applyTracked(p, "t1", txn({ transferAccountId: "ira", amount: -800 }));
    expect(p.accounts[1]!.balance).toBe(10_800);
    applyTracked(p, "t1", null);
    expect(p.accounts[1]!.balance).toBe(10_000);
    expect(p.budgetPlan!.tracked).toBeUndefined();
  });

  it("a withdrawal (money in to checking from the IRA) lowers it", () => {
    const p = plan();
    applyTracked(p, "t1", txn({ amount: 1_200, transferAccountId: "ira", categoryId: "ready" }));
    expect(p.accounts[1]!.balance).toBe(8_800);
  });

  it("a loan payment lowers what you owe", () => {
    const p = plan();
    applyTracked(p, "t1", txn({ amount: -300, transferAccountId: "car", categoryId: "debt:car" }));
    expect(p.debts[0]!.balance).toBe(4_700);
  });

  it("leaves transfers between budget accounts and plain spending alone", () => {
    const p = plan();
    applyTracked(p, "t1", txn({ categoryId: "item:x" }));
    expect(p.accounts[1]!.balance).toBe(10_000);
    expect(p.budgetPlan!.tracked).toBeUndefined();
  });
});
