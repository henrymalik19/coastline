import { startTxnId, type Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { keepCategory } from "./combine";
import { moveAccountTxns, txnsInAccount } from "./moveAccount";
import { freshPlan } from "./presets";

const tx = (o: Partial<Txn> & Pick<Txn, "id" | "accountId" | "amount">): Txn => ({ date: "2026-11-10", cleared: "cleared", source: "manual", updatedAt: 1, ...o });

describe("moving an account's transactions into another", () => {
  it("moves them, points transfers at the other one, drops a transfer between the two, and removes the account", () => {
    const plan = freshPlan();
    plan.accounts = [
      { id: "old", name: "Old checking", type: "cash", balance: 0 },
      { id: "new", name: "Checking", type: "cash", balance: 0 },
      { id: "sav", name: "Savings", type: "cash", balance: 0 },
    ];
    const txns = [
      tx({ id: startTxnId("old"), accountId: "old", amount: 500, payee: "Starting balance" }),
      tx({ id: startTxnId("new"), accountId: "new", amount: 1000, payee: "Starting balance" }),
      tx({ id: "a", accountId: "old", amount: -40, payee: "Gas" }),
      tx({ id: "b", accountId: "old", amount: -100, transferAccountId: "sav" }),
      tx({ id: "b2", accountId: "sav", amount: 100, transferAccountId: "old" }),
      tx({ id: "c", accountId: "old", amount: -25, transferAccountId: "new" }),
      tx({ id: "c2", accountId: "new", amount: 25, transferAccountId: "old" }),
    ];
    expect(txnsInAccount(txns, "old")).toBe(3);
    const r = moveAccountTxns(plan, txns, "old", "new", 9);
    const live = r.txns.filter((t) => !t.deleted);
    expect(r.plan.accounts.map((a) => a.id)).toEqual(["new", "sav"]);
    expect(live.find((t) => t.id === "a")?.accountId).toBe("new");
    expect([live.find((t) => t.id === "b")?.accountId, live.find((t) => t.id === "b2")?.transferAccountId]).toEqual(["new", "new"]);
    // the old one's start and the transfer between the two are gone
    expect(live.map((t) => t.id).sort()).toEqual(["a", "b", "b2", startTxnId("new")].sort());
    expect(r.moved).toBe(2);
  });
});

describe("a category in use can't be deleted", () => {
  const budget = [{ id: "kids", name: "Childcare" }, { id: "sit", name: "Babysitter", parentId: "kids" }, { id: "gas", name: "Gas" }, { id: "gym", name: "Gym" }];
  it("one with sub categories, or with transactions, says why; an empty one can go", () => {
    expect(keepCategory(budget, [], "kids")?.message).toContain("Babysitter");
    expect(keepCategory(budget, [tx({ id: "t", accountId: "chk", amount: -5, categoryId: "gas" })], "gas")?.title).toBe('"Gas" has transactions');
    expect(keepCategory(budget, [tx({ id: "t", accountId: "chk", amount: -5, splits: [{ categoryId: "gym", amount: -5 }] })], "gym")).not.toBeNull();
    expect(keepCategory(budget, [tx({ id: "t", accountId: "chk", amount: -5, categoryId: "gas", deleted: true })], "gas")).toBeNull();
  });
});
