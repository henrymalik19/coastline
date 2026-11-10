/**
 * Registers: the budget accounts that hold transactions (cash accounts and credit cards), where each
 * one's register starts, and keeping the plan's balances in step with the transactions.
 */
import { budgetStartCash, registerBalance, type BudgetState, type PlanState, type Txn } from "@coastfi/engine";

export type BudgetAccount = { id: string; name: string; kind: "cash" | "card"; balance: number };

/** A credit card: its type says so, or (no type set) its name looks like one. */
export const isCard = (d: Pick<PlanState["debts"][number], "kind" | "name" | "payroll">) =>
  !d.payroll && (d.kind === "credit_card" || (!d.kind && /\b(card|visa|mastercard|master card|amex|american express|discover)\b/i.test(d.name ?? "")));

/** Cash accounts and credit cards: the accounts you budget from. A card's balance is what you owe, as a negative. */
export function budgetAccounts(p: PlanState): BudgetAccount[] {
  return [
    ...p.accounts.filter((a) => a.type === "cash").map((a) => ({ id: a.id, name: a.name.trim() || "Cash", kind: "cash" as const, balance: a.balance })),
    ...p.debts.filter(isCard).map((d) => ({ id: d.id, name: d.name?.trim() || "Credit card", kind: "card" as const, balance: -d.balance })),
  ];
}

/** True when some month still has money on the old per-account savings lines. */
export function hasOldSavingsLines(p: PlanState): boolean {
  return Object.values(p.budgetPlan?.months ?? {}).some((e) => [e.assigned, e.spent].some((r) => r && Object.keys(r).some((k) => k.startsWith("acct:"))));
}

/**
 * The Budget used to have a line per savings account. Now there's one Emergency fund line ("cash")
 * and investing isn't a category: money on a cash account's line moves to Emergency fund, and money on
 * an IRA/brokerage line goes back to ready to assign. Changes `p` in place; safe to run again.
 */
export function foldSavingsLines(p: PlanState): void {
  if (!p.budgetPlan || !hasOldSavingsLines(p)) return;
  const cash = new Set(p.accounts.filter((a) => a.type === "cash").map((a) => "acct:" + a.id));
  const fold = (r: Record<string, number> | undefined) => {
    if (!r) return r;
    const out = { ...r };
    for (const k of Object.keys(out)) {
      if (!k.startsWith("acct:")) continue;
      if (cash.has(k)) out.cash = (out.cash ?? 0) + (out[k] ?? 0);
      delete out[k];
    }
    return Object.keys(out).length ? out : undefined;
  };
  const months: typeof p.budgetPlan.months = {};
  for (const [m, e] of Object.entries(p.budgetPlan.months)) months[m] = { ...e, assigned: fold(e.assigned), spent: fold(e.spent) };
  p.budgetPlan.months = months;
}

/**
 * The budget as it stands: it starts with the cash in every cash account, including ones added after
 * the budget began (not only what was there on day one).
 */
export function liveBudget(p: PlanState): BudgetState | undefined {
  return p.budgetPlan ? { ...p.budgetPlan, startCash: Math.round(budgetStartCash(p) * 100) / 100 } : undefined;
}

/** Credit card account id → its payment category key. */
export function cardMap(p: PlanState): Record<string, string> {
  return Object.fromEntries(p.debts.filter(isCard).map((d) => [d.id, "debt:" + d.id]));
}

/** Start an account's register at its balance today (only once). Needs a started budget. */
export function ensureRegister(p: PlanState, accountId: string, today: string): void {
  if (!p.budgetPlan) return;
  const regs = { ...(p.budgetPlan.registers ?? {}) };
  if (regs[accountId]) return;
  const acct = budgetAccounts(p).find((a) => a.id === accountId);
  if (!acct) return;
  regs[accountId] = { opening: Math.round(acct.balance * 100) / 100, since: today };
  p.budgetPlan.registers = regs;
}

/** Set each registered account's balance from its transactions (cash: the balance; card: what you owe). */
export function applyRegisterBalances(p: PlanState, txns: Txn[]): void {
  const regs = p.budgetPlan?.registers ?? {};
  for (const [id, r] of Object.entries(regs)) {
    const bal = Math.round(registerBalance(r.opening, txns, id) * 100) / 100;
    const a = p.accounts.find((x) => x.id === id);
    if (a) {
      a.balance = bal;
      continue;
    }
    const d = p.debts.find((x) => x.id === id);
    if (d) d.balance = Math.max(0, -bal);
  }
}

/** Accounts you don't budget from that a transfer can move money to or from: investments and loans. */
export type TrackingAccount = { id: string; name: string; kind: "acct" | "debt"; key: string; balance: number };
export function trackingAccounts(p: PlanState): TrackingAccount[] {
  return [
    ...p.accounts.filter((a) => a.type !== "cash" && a.type !== "property").map((a) => ({ id: a.id, name: a.name.trim() || "Account", kind: "acct" as const, key: "acct:" + a.id, balance: a.balance })),
    ...p.debts.filter((d) => !isCard(d) && !d.payroll && d.balance > 0).map((d) => ({ id: d.id, name: d.name?.trim() || "Loan", kind: "debt" as const, key: "debt:" + d.id, balance: d.balance })),
  ];
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Move an account you don't budget by `amount` (money into it: an IRA grows, a loan's balance drops). */
function moveTracking(p: PlanState, id: string, amount: number): void {
  const a = p.accounts.find((x) => x.id === id);
  if (a) {
    a.balance = round2((+a.balance || 0) + amount);
    return;
  }
  const d = p.debts.find((x) => x.id === id);
  if (d) d.balance = Math.max(0, round2(d.balance - amount));
}

/**
 * Keep an investment account or loan in step with a transfer to or from it: first undo what this
 * transaction moved before (if anything), then apply it as it is now. `t` null = it was deleted.
 */
export function applyTracked(p: PlanState, txnId: string, t: Txn | null): void {
  if (!p.budgetPlan) return;
  const tracked = { ...(p.budgetPlan.tracked ?? {}) };
  const prev = tracked[txnId];
  if (prev) {
    moveTracking(p, prev.to, -prev.amount);
    delete tracked[txnId];
  }
  const to = t && !t.deleted ? t.transferAccountId : undefined;
  const isTracking = !!to && !budgetAccounts(p).some((a) => a.id === to) && (p.accounts.some((a) => a.id === to) || p.debts.some((d) => d.id === to));
  if (t && to && isTracking) {
    // money out of checking (−) goes into the account (+), and the other way for a withdrawal
    const amount = round2(-t.amount);
    moveTracking(p, to, amount);
    tracked[txnId] = { to, amount };
  }
  p.budgetPlan.tracked = Object.keys(tracked).length ? tracked : undefined;
}
