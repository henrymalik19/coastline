/**
 * Registers: the budget accounts that hold transactions (cash accounts and credit cards), each one
 * starting with a "Starting balance" transaction, and keeping the plan's balances in step with them.
 */
import { budgetStartCash, isStartTxn, registerBalance, startTxnId, type BudgetState, type PlanState, type Txn } from "@coastfi/engine";

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

/** True when some month still has money on the old per-account lines. */
export function hasOldSavingsLines(p: PlanState): boolean {
  return Object.values(p.budgetPlan?.months ?? {}).some((e) => !!e.assigned && Object.keys(e.assigned).some((k) => k.startsWith("acct:")));
}

/**
 * The Budget used to have a line per account. Now there's one Emergency fund line ("cash"), and
 * investing is a category you add and link to its account: money on a cash account's line moves to
 * Emergency fund, money on an investing account's line moves to the category linked to it (else back
 * to ready to assign). Changes `p` in place; safe to run again.
 */
export function foldSavingsLines(p: PlanState): void {
  if (!p.budgetPlan || !hasOldSavingsLines(p)) return;
  const cash = new Set(p.accounts.filter((a) => a.type === "cash").map((a) => "acct:" + a.id));
  const linked = new Map<string, string>();
  for (const b of p.budget) if (b.accountId && !linked.has("acct:" + b.accountId)) linked.set("acct:" + b.accountId, b.id);
  const fold = (r: Record<string, number> | undefined) => {
    if (!r) return r;
    const out = { ...r };
    for (const k of Object.keys(out)) {
      if (!k.startsWith("acct:")) continue;
      const to = cash.has(k) ? "cash" : linked.get(k);
      if (to) out[to] = (out[to] ?? 0) + (out[k] ?? 0);
      delete out[k];
    }
    return Object.keys(out).length ? out : undefined;
  };
  const months: typeof p.budgetPlan.months = {};
  for (const [m, e] of Object.entries(p.budgetPlan.months)) months[m] = { ...e, assigned: fold(e.assigned) };
  p.budgetPlan.months = months;
}

/**
 * The budget as it stands: it starts with the cash in every cash account, including ones added after
 * the budget began (not only what was there on day one).
 */
export function liveBudget(p: PlanState, txns: Txn[] = []): BudgetState | undefined {
  return p.budgetPlan ? { ...p.budgetPlan, startCash: Math.round(budgetStartCash(p, txns) * 100) / 100 } : undefined;
}

/** An account's register has started: it has a "Starting balance" transaction. */
export const hasRegister = (txns: Txn[], accountId: string) => txns.some((t) => !t.deleted && t.id === startTxnId(accountId));

/** "Starting balance", for an account's first transaction. */
export { isStartTxn };

/** Credit card account id → its payment category key. */
export function cardMap(p: PlanState): Record<string, string> {
  return Object.fromEntries(p.debts.filter(isCard).map((d) => [d.id, "debt:" + d.id]));
}

/**
 * Start an account's register: a "Starting balance" transaction for what's in it today (a card:
 * what you owe, as a negative). A cash account's goes to ready to assign; a card's has no category.
 * Null when it already has one or the budget hasn't started.
 */
export function startTxnFor(p: PlanState, txns: Txn[], accountId: string, today: string): Txn | null {
  if (!p.budgetPlan || hasRegister(txns, accountId)) return null;
  const acct = budgetAccounts(p).find((a) => a.id === accountId);
  if (!acct) return null;
  return {
    id: startTxnId(accountId), accountId, date: today, amount: Math.round(acct.balance * 100) / 100, payee: "Starting balance",
    ...(acct.kind === "cash" ? { categoryId: "ready" } : {}), cleared: "reconciled", source: "manual", updatedAt: Date.now(),
  };
}

/** Set each started account's balance from its transactions (cash: the balance; card: what you owe). */
export function applyRegisterBalances(p: PlanState, txns: Txn[]): void {
  for (const acct of budgetAccounts(p)) {
    if (!hasRegister(txns, acct.id)) continue;
    const bal = Math.round(registerBalance(0, txns, acct.id) * 100) / 100;
    const a = p.accounts.find((x) => x.id === acct.id);
    if (a) {
      a.balance = bal;
      continue;
    }
    const d = p.debts.find((x) => x.id === acct.id);
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
 * Keep an investment account or loan in step with a transfer to or from it: first undo what the
 * transaction moved before (`prev.trackedAmount`), then apply it as it is now. Returns what it
 * moved now (kept on the transaction), or undefined. `next` null = it was deleted.
 */
export function applyTracked(p: PlanState, prev: Txn | undefined, next: Txn | null): number | undefined {
  if (prev?.trackedAmount && prev.transferAccountId) moveTracking(p, prev.transferAccountId, -prev.trackedAmount);
  const to = next && !next.deleted ? next.transferAccountId : undefined;
  const isTracking = !!to && !budgetAccounts(p).some((a) => a.id === to) && (p.accounts.some((a) => a.id === to) || p.debts.some((d) => d.id === to));
  if (!next || !to || !isTracking) return undefined;
  // money out of checking (−) goes into the account (+), and the other way for a withdrawal
  const amount = round2(-next.amount);
  moveTracking(p, to, amount);
  return amount;
}
