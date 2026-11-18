/**
 * Budget categories that pay one of your loans (a "PITI" category for a mortgage): the plan already counts
 * the loan from Debts, so a category linked to it (BudgetItem.paysDebt) isn't counted again as spending.
 * This spots the likely ones, to suggest the link.
 */
import type { BudgetItem, Debt, PlanState } from "@coastfi/engine";
import { fullName } from "./company";
import { isCard } from "./register";

const key = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "");
const PAYS = /piti|mortgage|loan|payment|principal|p&i/i;

/**
 * The loan a category looks like it pays (not a card, not paid from your paycheck), or undefined. Sure:
 * only the clear ones (named like the loan, or like a payment); otherwise an amount within 1% of a loan's
 * payment is enough to ask.
 */
export function debtItPays(p: Pick<PlanState, "debts" | "budget">, b: BudgetItem, sure = false): Debt | undefined {
  if (b.paysDebt || b.accountId || b.hidden || b.noSuggest) return undefined;
  const taken = new Set(p.budget.flatMap((x) => (x.paysDebt ? [x.paysDebt] : [])));
  return p.debts.find((d) => {
    if (isCard(d) || d.payroll || !(d.minPayment > 0) || taken.has(d.id)) return false;
    const names = [d.name, fullName(d)].map(key).filter((n) => n.length >= 4);
    const near = names.some((n) => key(b.group ?? "") === n || key(b.name).includes(n));
    const sameAmount = Math.abs(b.amount - d.minPayment) <= d.minPayment * 0.03;
    const exact = Math.abs(b.amount - d.minPayment) <= d.minPayment * 0.01;
    return (near && (PAYS.test(b.name) || sameAmount)) || (sameAmount && PAYS.test(b.name)) || (!sure && exact);
  });
}

/** Link each category that looks like it pays a loan to that loan (one category per loan). */
export function linkDebtCategories(p: Pick<PlanState, "debts" | "budget">): number {
  let n = 0;
  for (const b of p.budget) {
    const d = debtItPays(p, b, true);
    if (d) { b.paysDebt = d.id; n++; }
  }
  return n;
}
