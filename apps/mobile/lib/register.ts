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
