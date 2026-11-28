import { budgetScheduleMonths, run, type Txn } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { loanHistory, splitLoanMonth } from "./loanPay";
import { freshPlan } from "./presets";
import { applyTracked, loanPaymentParts, settleLoans } from "./register";

const pay = (id: string, date: string, amount: number): Txn => ({ id, accountId: "chk", transferAccountId: "home", date, amount: -amount, cleared: "cleared", source: "manual", updatedAt: 1 });

describe("a loan payment lowers what you owe by its principal", () => {
  it("the month's interest and escrow come out of the first payment; an extra one is all principal", () => {
    // $200,000 at 6%: $1,000 interest a month; $400 of the payment is escrow
    const parts = splitLoanMonth({ apr: 0.06, escrow: 400 }, 200_000, "2026-11", [
      { id: "extra", date: "2026-11-20", amount: 500 },
      { id: "regular", date: "2026-11-01", amount: 1_900 },
    ]);
    expect(parts.get("regular")).toEqual({ interest: 1000, escrow: 400, principal: 500 });
    expect(parts.get("extra")).toEqual({ interest: 0, escrow: 0, principal: 500 });
  });

  it("a payment smaller than the interest lowers nothing; a promo rate counts through its last month", () => {
    expect(splitLoanMonth({ apr: 0.12 }, 10_000, "2026-11", [{ id: "a", date: "2026-11-02", amount: 50 }]).get("a")).toEqual({ interest: 50, escrow: 0, principal: 0 });
    expect(splitLoanMonth({ apr: 0.12, promoApr: 0, promoUntil: "2026-12" }, 10_000, "2026-11", [{ id: "a", date: "2026-11-02", amount: 300 }]).get("a")!.principal).toBe(300);
  });

  it("saving, adding an extra, and deleting keep the balance right", () => {
    const plan = freshPlan();
    plan.accounts = [{ id: "chk", name: "Checking", type: "cash", balance: 5000 }];
    plan.debts = [{ id: "home", name: "Mortgage", kind: "mortgage", balance: 200_000, apr: 0.06, minPayment: 1_900, escrow: 400 }];
    const save = (txns: Txn[], t: Txn) => {
      const moved = applyTracked(plan, undefined, t);
      return settleLoans(plan, [...txns, { ...t, trackedAmount: moved }], [{ loan: "home", month: t.date.slice(0, 7) }]);
    };
    // what the form shows before saving
    expect(loanPaymentParts(plan, [], "home", "2026-11-01", 1_900)).toEqual({ interest: 1000, escrow: 400, principal: 500 });
    let txns = save([], pay("regular", "2026-11-01", 1_900));
    expect(plan.debts[0]!.balance).toBe(199_500);
    expect(loanPaymentParts(plan, txns, "home", "2026-11-20", 500)).toEqual({ interest: 0, escrow: 0, principal: 500 });
    txns = save(txns, pay("extra", "2026-11-20", 500));
    expect(plan.debts[0]!.balance).toBe(199_000);
    // the regular one deleted: the extra now pays the month's interest first
    const gone = txns.find((t) => t.id === "regular")!;
    applyTracked(plan, gone, null);
    txns = settleLoans(plan, txns.map((t) => (t.id === "regular" ? { ...t, deleted: true, trackedAmount: undefined } : t)), [{ loan: "home", month: "2026-11" }]);
    expect(plan.debts[0]!.balance).toBe(200_000);
    expect(txns.find((t) => t.id === "extra")!.trackedAmount).toBe(0);
  });
});

describe("a loan's payments, as its Activity lists them", () => {
  it("each one's interest, escrow and principal, and what was owed after it", () => {
    const d = { id: "home", balance: 199_000, escrow: 400, apr: 0.06 };
    const rows = loanHistory(d, [
      { ...pay("regular", "2026-11-01", 1_900), trackedAmount: 500 },
      { ...pay("extra", "2026-11-20", 500), trackedAmount: 500 },
      { ...pay("ynab", "2026-10-01", 1_900) },
    ]);
    expect(rows.get("regular")).toEqual({ note: "$1,000 interest · $400 escrow · $500 principal", after: 199_500 });
    expect(rows.get("extra")).toEqual({ note: "Extra: all principal", after: 199_000 });
    expect(rows.get("ynab")).toEqual({ note: "Not counted in the balance", after: 200_000 });
  });
});

describe("two payments the same day", () => {
  it("the bigger one (the regular payment) pays the month's interest and escrow", () => {
    const parts = splitLoanMonth({ apr: 0.06, escrow: 400 }, 200_000, "2026-11", [
      { id: "a-extra", date: "2026-11-28", amount: 500 },
      { id: "z-regular", date: "2026-11-28", amount: 1_900 },
    ]);
    expect(parts.get("z-regular")!.principal).toBe(500);
    expect(parts.get("a-extra")!.principal).toBe(500);
  });
});

describe("an extra payment on a 401(k) loan", () => {
  it("lowers the loan by all of it and puts it back into your 401(k); deleting it undoes both", () => {
    const plan = freshPlan();
    plan.accounts = [
      { id: "chk", name: "Checking", type: "cash", balance: 5000 },
      { id: "k", name: "Hub International 401(k)", type: "pretax", balance: 80_000 },
    ];
    plan.debts = [{ id: "loan", name: "Hub International 401(k) loan", kind: "k401_loan", balance: 25_000, apr: 0.09, minPayment: 528, payroll: true }];
    const t: Txn = { id: "x", accountId: "chk", transferAccountId: "loan", date: "2026-11-28", amount: -1_000, cleared: "cleared", source: "manual", updatedAt: 1 };
    const moved = applyTracked(plan, undefined, t);
    const txns = settleLoans(plan, [{ ...t, trackedAmount: moved }], [{ loan: "loan", month: "2026-11" }]);
    expect([plan.debts[0]!.balance, plan.accounts[1]!.balance]).toEqual([24_000, 81_000]);
    expect(loanHistory(plan.debts[0]!, txns).get("x")!.note).toBe("Extra: all principal");
    applyTracked(plan, txns[0], null);
    expect([plan.debts[0]!.balance, plan.accounts[1]!.balance]).toEqual([25_000, 80_000]);
  });
});

describe("money assigned to a 401(k) loan's extra category", () => {
  it("is all extra in the forecast (the paycheck pays the payment)", () => {
    const plan = freshPlan();
    plan.debts = [{ id: "loan", name: "401(k) loan", kind: "k401_loan", balance: 25_000, apr: 0.09, minPayment: 528, payroll: true }];
    plan.budget = [{ id: "x", name: "401(k) loan extra", amount: 0, inRetirement: false, group: "Debt payments", paysDebt: "loan" }];
    plan.budgetPlan = { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { x: 300 } } } };
    expect(budgetScheduleMonths(plan)?.["debt:loan"]).toEqual({ "2026-11": 300 });
  });
});

describe("the forecast with that extra", () => {
  it("pays the loan down by it and puts it back into the 401(k)", () => {
    const plan = freshPlan();
    plan.incomes = [{ id: "job", name: "Hub", kind: "job", gross: 120_000, freq: "monthly", net: 7_000, netMode: "manual" } as never];
    plan.debts = [{ id: "loan", name: "401(k) loan", kind: "k401_loan", balance: 25_000, apr: 0.09, minPayment: 528, payroll: true }];
    plan.budget = [{ id: "x", name: "401(k) loan extra", amount: 0, inRetirement: false, group: "Debt payments", paysDebt: "loan" }];
    plan.budgetPlan = { start: "2026-11", startCash: 0, months: { "2026-11": { assigned: { x: 300 } } } };
    plan.plan.scheduleMonths = { ...(plan.plan.scheduleMonths ?? {}), ...budgetScheduleMonths(plan) };
    const r = run(plan, new Date(2026, 10, 15));
    const m = r.plan.months[0]!;
    expect(m.plannedBy?.find((x) => x.key === "debt:loan")?.got).toBe(300);
    expect(m.loanBackExtra).toBe(300);
  });
});
