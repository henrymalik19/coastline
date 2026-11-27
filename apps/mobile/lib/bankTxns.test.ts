import { startTxnId, type PlanState, type Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { BANK_ID, dedupeBank, linkYnabToBank, mergeBankTxns, type BankTxn } from "./bankTxns";
import { freshPlan } from "./presets";
import { buildImport, parseYnab } from "./ynab";
import { applyYnabUpdate, planYnabUpdate } from "./ynabUpdate";

function setup() {
  const plan: PlanState = freshPlan();
  plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 1000, plaidAccountId: "pa1" }];
  const start: Txn = { id: startTxnId("chk"), accountId: "chk", date: "2026-11-01", amount: 1000, payee: "Starting balance", categoryId: "ready", cleared: "reconciled", source: "manual", updatedAt: 1 };
  return { plan, txns: [start] };
}
const bank = (o: Partial<BankTxn> & Pick<BankTxn, "transactionId">): BankTxn => ({ accountId: "pa1", date: "2026-11-10", amount: 5.25, name: "SQ *CORNER CAFE", merchantName: "Corner Cafe", pending: false, ...o });
const live = (txns: Txn[]) => txns.filter((t) => !t.deleted && !t.id.startsWith("start:"));

describe("bank transactions", () => {
  it("a new one comes in held for review, as money out, with the merchant's name", () => {
    const { plan, txns } = setup();
    const r = mergeBankTxns(txns, plan, [bank({ transactionId: "t1", pending: true })], 50);
    expect(r.added).toBe(1);
    expect(live(r.txns)).toEqual([{ id: BANK_ID + "t1", accountId: "chk", date: "2026-11-10", amount: -5.25, payee: "Corner Cafe", cleared: "uncleared", source: "plaid", importId: "t1", review: true, updatedAt: 50 }]);
  });

  it("the same rows again change nothing", () => {
    const { plan, txns } = setup();
    const rows = [bank({ transactionId: "t1" }), bank({ transactionId: "t2", amount: -2000, name: "PAYROLL", merchantName: null })];
    const once = mergeBankTxns(txns, plan, rows, 50).txns;
    const twice = mergeBankTxns(once, plan, rows, 60);
    expect(twice.txns).toEqual(once);
    expect([twice.added, twice.updated]).toEqual([0, 0]);
    expect(live(once).find((t) => t.importId === "t2")).toMatchObject({ amount: 2000, payee: "PAYROLL" });
  });

  it("only into accounts you've matched to a bank and keep transactions for, after their starting balance", () => {
    const { plan, txns } = setup();
    const rows = [bank({ transactionId: "old", date: "2026-11-01" }), bank({ transactionId: "other", accountId: "pa9" })];
    expect(mergeBankTxns(txns, plan, rows, 50).added).toBe(0);
    // no register: nothing
    expect(mergeBankTxns([], plan, [bank({ transactionId: "t1" })], 50).added).toBe(0);
  });

  it("when a pending one posts with a tip, it updates in place and keeps what you set", () => {
    const { plan, txns } = setup();
    const a = mergeBankTxns(txns, plan, [bank({ transactionId: "p1", pending: true })], 50).txns;
    const mine = a.map((t) => (t.importId === "p1" ? { ...t, categoryId: "food", memo: "coffee", review: undefined, updatedAt: 60 } : t));
    const b = mergeBankTxns(mine, plan, [bank({ transactionId: "p1", pending: true, removed: true }), bank({ transactionId: "c1", pendingTransactionId: "p1", amount: 6.5, date: "2026-11-11" })], 70);
    expect(live(b.txns)).toEqual([{ id: BANK_ID + "p1", accountId: "chk", date: "2026-11-11", amount: -6.5, payee: "Corner Cafe", categoryId: "food", memo: "coffee", cleared: "cleared", source: "plaid", importId: "c1", updatedAt: 70 }]);
    expect([b.updated, b.removed, b.added]).toEqual([1, 0, 0]);
  });

  it("one the bank takes back is removed; one you deleted never comes back", () => {
    const { plan, txns } = setup();
    const a = mergeBankTxns(txns, plan, [bank({ transactionId: "t1", pending: true })], 50).txns;
    expect(live(mergeBankTxns(a, plan, [bank({ transactionId: "t1", removed: true })], 60).txns)).toEqual([]);
    const gone = a.map((t) => (t.importId === "t1" ? { ...t, deleted: true, updatedAt: 55 } : t));
    expect(live(mergeBankTxns(gone, plan, [bank({ transactionId: "t1", amount: 9 })], 60).txns)).toEqual([]);
  });

  it("one you typed in is the same purchase: it becomes the bank's, keeping your category and memo", () => {
    const { plan, txns } = setup();
    const typed: Txn = { id: "m1", accountId: "chk", date: "2026-11-08", amount: -5.25, payee: "Cafe", categoryId: "food", memo: "latte", cleared: "uncleared", source: "manual", updatedAt: 40 };
    const r = mergeBankTxns([...txns, typed], plan, [bank({ transactionId: "t1" })], 50);
    expect(r.linked).toBe(1);
    expect(live(r.txns)).toEqual([{ id: BANK_ID + "t1", accountId: "chk", date: "2026-11-10", amount: -5.25, payee: "Cafe", categoryId: "food", memo: "latte", cleared: "cleared", source: "plaid", importId: "t1", updatedAt: 50 }]);
    // too far apart, or another amount: not the same
    const far = mergeBankTxns([...txns, { ...typed, date: "2026-11-01" }], plan, [bank({ transactionId: "t1" })], 50);
    expect([far.linked, far.added]).toEqual([0, 1]);
  });

  it("two devices bringing in the same one: one stays", () => {
    const t = (id: string): Txn => ({ id, accountId: "chk", date: "2026-11-10", amount: -5, cleared: "cleared", source: "plaid", importId: "c1", updatedAt: 1 });
    const out = dedupeBank([t("bank:p1"), t("bank:c1")], 9);
    expect(out.filter((x) => !x.deleted).map((x) => x.id)).toEqual(["bank:c1"]);
  });
});

const HEAD = `"Account","Flag","Date","Payee","Category Group/Category","Category Group","Category","Memo","Outflow","Inflow","Cleared"\n`;
const row = (date: string, payee: string, group: string, cat: string, out: string, inflow = "$0.00") =>
  `"Checking","","${date}","${payee}","${group}: ${cat}","${group}","${cat}","","${out}","${inflow}","Cleared"\n`;

describe("bank transactions and YNAB", () => {
  function both() {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0, plaidAccountId: "pa1" }];
    plan.budget = [{ id: "food", name: "Groceries", amount: 600, inRetirement: true, group: "Everyday" }];
    let n = 0;
    const newId = () => `n${++n}`;
    const v1 = HEAD + row("11/02/2026", "Kroger", "Everyday", "Groceries", "$120.00");
    const r = buildImport(plan, parseYnab(v1), { from: "2026-11", thisMonth: "2026-11", accounts: { Checking: { action: "match", id: "chk" } }, categories: {}, removeEmpty: false, newId });
    return { plan: r.plan, txns: r.txns.map((t) => ({ ...t, updatedAt: 100 })), newId };
  }

  it("a bank one YNAB already has links to it, keeping YNAB's category and id", () => {
    const { plan, txns } = both();
    const r = mergeBankTxns(txns, plan, [bank({ transactionId: "k1", date: "2026-11-03", amount: 120, merchantName: "KROGER #12" })], 200);
    const k = live(r.txns);
    expect(k).toHaveLength(1);
    const ynab = txns.find((t) => t.payee === "Kroger")!;
    expect(k[0]).toMatchObject({ id: BANK_ID + "k1", source: "plaid", payee: "Kroger", categoryId: "food", ynabId: ynab.id, date: "2026-11-03" });
    // a later YNAB update finds it: nothing new, nothing gone
    const v2 = HEAD + row("11/02/2026", "Kroger", "Everyday", "Groceries", "$120.00");
    const u = planYnabUpdate(plan, parseYnab(v2), r.txns, 200, "2026-11");
    expect([u.add.length, u.gone.length, u.changed.length, u.replaced.length]).toEqual([0, 0, 0, 0]);
  });

  it("a YNAB one the bank brought in first links to the bank's instead of coming in twice", () => {
    const { plan, txns, newId } = both();
    const a = mergeBankTxns(txns, plan, [bank({ transactionId: "s1", date: "2026-11-05", amount: 40, merchantName: "SHELL OIL" })], 200).txns;
    const v2 = HEAD + row("11/04/2026", "Shell", "Everyday", "Groceries", "$40.00") + row("11/02/2026", "Kroger", "Everyday", "Groceries", "$120.00");
    const u = planYnabUpdate(plan, parseYnab(v2), a, 200, "2026-11", newId);
    expect(u.add).toEqual([]);
    expect(u.changed.map((t) => [t.id, t.payee, t.categoryId, !!t.review])).toEqual([[BANK_ID + "s1", "Shell", "food", false]]);
    const out = applyYnabUpdate(a, u, 200, true, 300);
    expect(live(out).map((t) => t.payee).sort()).toEqual(["Kroger", "Shell"]);
    // the same export again: nothing
    const again = planYnabUpdate(plan, parseYnab(v2), out, 300, "2026-11", newId);
    expect([again.add.length, again.changed.length, again.gone.length]).toEqual([0, 0, 0]);
  });

  it("a fresh YNAB import doesn't bring back one that's now the bank's", () => {
    const { plan, txns, newId } = both();
    const a = mergeBankTxns(txns, plan, [bank({ transactionId: "k1", date: "2026-11-03", amount: 120 })], 200).txns;
    const v1 = HEAD + row("11/02/2026", "Kroger", "Everyday", "Groceries", "$120.00");
    const r = buildImport(plan, parseYnab(v1), { from: "2026-11", thisMonth: "2026-11", accounts: { Checking: { action: "match", id: "chk" } }, categories: {}, removeEmpty: false, existing: a, newId });
    expect(r.txns.filter((t) => t.payee === "Kroger").map((t) => t.id)).toEqual([]);
    expect(r.replaced).toEqual([]);
  });

  it("you'd already set a category on the bank one: YNAB's doesn't replace it", () => {
    const b: Txn = { id: "bank:x", accountId: "chk", date: "2026-11-05", amount: -40, payee: "Shell", categoryId: "gas", cleared: "cleared", source: "plaid", importId: "x", updatedAt: 5 };
    const y: Txn = { id: "y1", accountId: "chk", date: "2026-11-04", amount: -40, payee: "Shell Oil", categoryId: "food", cleared: "cleared", source: "ynab", importId: "y1", updatedAt: 6 };
    const r = linkYnabToBank([b], [y], 9);
    expect(r.rest).toEqual([]);
    expect(r.linked).toEqual([{ ...b, ynabId: "y1", updatedAt: 9 }]);
  });
});
