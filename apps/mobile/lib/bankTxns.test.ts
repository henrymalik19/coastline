import { startTxnId, type PlanState, type Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { BANK_ID, bankStarts, dedupeBank, linkYnabToBank, mergeBankTxns, type BankTxn } from "./bankTxns";
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

describe("bank start date", () => {
  const today = "2026-11-27";
  function fresh(start = "2026-11") {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0, plaidAccountId: "pa1" }];
    plan.debts = [{ id: "visa", name: "Visa", kind: "credit_card", balance: 0, apr: 0.2, minPayment: 25, plaidAccountId: "pc1" }];
    plan.budgetPlan = { start, startCash: 0, months: {} };
    return plan;
  }
  const apply = (plan: PlanState, b: ReturnType<typeof bankStarts>) => {
    for (const s of b) { const x = plan.accounts.find((a) => a.id === s.accountId) ?? plan.debts.find((d) => d.id === s.accountId); if (x) x.bankFrom = s.from; }
  };

  it("an account with none here starts on the budget's first day, at what it held then", () => {
    const plan = fresh();
    const rows = [
      bank({ transactionId: "old", date: "2026-10-30", amount: 99 }), // before the budget: not counted, not brought in
      bank({ transactionId: "a", date: "2026-11-03", amount: 50 }),
      bank({ transactionId: "pay", date: "2026-11-15", amount: -1000, name: "PAYROLL", merchantName: null }),
      bank({ transactionId: "p", date: "2026-11-26", amount: 20, pending: true }), // not in the bank's balance yet
      bank({ transactionId: "c1", accountId: "pc1", date: "2026-11-10", amount: 30 }),
    ];
    const st = bankStarts(plan, [], rows, new Map([["pa1", 2450], ["pc1", 130]]), today, 1);
    expect(st.map((s) => [s.accountId, s.from, s.start?.amount, s.start?.date])).toEqual([
      ["chk", "2026-11-01", 1500, "2026-11-01"], // 2450 now, less +1000 in and −50 out since
      ["visa", "2026-11-01", -100, "2026-11-01"], // owes 130 now, 30 of it since
    ]);
    apply(plan, st);
    const r = mergeBankTxns(st.map((s) => s.start!), plan, rows, 2);
    expect(live(r.txns).map((t) => t.importId).sort()).toEqual(["a", "c1", "p", "pay"]);
    // once you've accepted them: the bank's balance, less what's pending (its available balance)
    const all = r.txns.map((t) => ({ ...t, review: undefined }));
    const bal = (id: string) => Math.round(all.filter((t) => t.accountId === id && !t.deleted).reduce((a, t) => a + t.amount, 0) * 100) / 100;
    expect([bal("chk"), bal("visa")]).toEqual([2450 - 20, -130]);
  });

  it("at most 30 days back, and none before the budget starts", () => {
    const old = bankStarts(fresh("2026-06"), [], [bank({ transactionId: "a" })], new Map([["pa1", 100]]), today, 1);
    expect(old[0]!.from).toBe("2026-10-28");
    const p = fresh();
    delete p.budgetPlan;
    expect(bankStarts(p, [], [bank({ transactionId: "a" })], new Map(), today, 1)).toEqual([]);
  });

  it("one with transactions here already (YNAB's) goes on from its newest; earlier ones stay as they are", () => {
    const plan = fresh("2026-07");
    const start: Txn = { id: startTxnId("chk"), accountId: "chk", date: "2026-07-01", amount: 500, payee: "Starting balance", categoryId: "ready", cleared: "reconciled", source: "ynab", updatedAt: 1 };
    const y: Txn = { id: "y1", accountId: "chk", date: "2026-11-20", amount: -40, payee: "Shell", categoryId: "gas", cleared: "cleared", source: "ynab", importId: "y1", updatedAt: 1 };
    const rows = [bank({ transactionId: "b0", date: "2026-11-05", amount: 12 }), bank({ transactionId: "b1", date: "2026-11-20", amount: 40 }), bank({ transactionId: "b2", date: "2026-11-25", amount: 8 })];
    const st = bankStarts(plan, [start, y], rows, new Map([["pa1", 999]]), today, 1);
    expect(st).toEqual([{ accountId: "chk", from: "2026-11-20" }]);
    apply(plan, st);
    const r = mergeBankTxns([start, y], plan, rows, 2);
    // b0 is before: YNAB's to bring in. b1 is YNAB's Shell (linked, keeping its category). b2 is new.
    expect(live(r.txns).map((t) => [t.importId, t.categoryId, t.ynabId]).sort()).toEqual([["b1", "gas", "y1"], ["b2", undefined, undefined]]);
    // already has its date: nothing to do
    expect(bankStarts(plan, r.txns, rows, new Map(), today, 3)).toEqual([]);
  });

  it("from then on, a YNAB one that isn't the bank's isn't added; before then it is", () => {
    const b: Txn = { id: "bank:x", accountId: "chk", date: "2026-11-21", amount: -40, cleared: "cleared", source: "plaid", importId: "x", review: true, updatedAt: 5 };
    const y = (id: string, date: string, amount: number): Txn => ({ id, accountId: "chk", date, amount, payee: id, categoryId: "food", cleared: "cleared", source: "ynab", importId: id, updatedAt: 6 });
    const r = linkYnabToBank([b], [y("match", "2026-11-21", -40), y("after", "2026-11-22", -9), y("before", "2026-11-19", -9)], 9, new Map([["chk", "2026-11-20"]]));
    expect(r.rest.map((t) => t.id)).toEqual(["before"]);
    expect(r.linked.map((t) => [t.id, t.payee, t.ynabId])).toEqual([["bank:x", "match", "match"]]);
    expect(r.skipped).toBe(1);
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

  it("an import from a month after the account's bank start date starts it on that day, and leaves the rest to the bank", () => {
    const plan: PlanState = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 0, plaidAccountId: "pa1", bankFrom: "2026-10-28" }];
    plan.budget = [{ id: "food", name: "Groceries", amount: 600, inRetirement: true, group: "Everyday" }];
    const csv = HEAD + row("11/05/2026", "Shell", "Everyday", "Groceries", "$40.00") + row("10/30/2026", "Kroger", "Everyday", "Groceries", "$20.00") + row("10/15/2026", "Rent", "Everyday", "Groceries", "$100.00");
    let n = 0;
    const r = buildImport(plan, parseYnab(csv), { from: "2026-11", thisMonth: "2026-11", accounts: { Checking: { action: "match", id: "chk" } }, categories: {}, removeEmpty: false, newId: () => `n${++n}` });
    expect(r.txns.filter((t) => t.accountId === "chk").map((t) => [t.id, t.date, t.amount])).toEqual([[startTxnId("chk"), "2026-10-28", -100]]);
    expect(r.summary.transactionsFromBank).toBe(2);
  });

  it("you'd already set a category on the bank one: YNAB's doesn't replace it", () => {
    const b: Txn = { id: "bank:x", accountId: "chk", date: "2026-11-05", amount: -40, payee: "Shell", categoryId: "gas", cleared: "cleared", source: "plaid", importId: "x", updatedAt: 5 };
    const y: Txn = { id: "y1", accountId: "chk", date: "2026-11-04", amount: -40, payee: "Shell Oil", categoryId: "food", cleared: "cleared", source: "ynab", importId: "y1", updatedAt: 6 };
    const r = linkYnabToBank([b], [y], 9);
    expect(r.rest).toEqual([]);
    expect(r.linked).toEqual([{ ...b, ynabId: "y1", updatedAt: 9 }]);
  });
});
