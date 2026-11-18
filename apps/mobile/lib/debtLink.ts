/**
 * Budget categories that pay one of your loans (a "PITI" category for a mortgage): the plan already counts
 * the loan from Debts, so a category linked to it (BudgetItem.paysDebt) isn't counted again as spending.
 * This spots the likely ones, to suggest the link.
 */
import type { BudgetItem, Debt, PlanState, Txn } from "@coastfi/engine";
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

/**
 * What you really paid from a category in each of the last two full months before `month` (outflows,
 * split lines included; ones held for review left out). Undefined unless both months have payments.
 */
export function paidLastTwoMonths(txns: Txn[], itemId: string, month: string): [number, number] | undefined {
  const prev = (ym: string) => { const [y, m] = ym.split("-").map(Number) as [number, number]; return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };
  const months = [prev(prev(month)), prev(month)];
  const sums = months.map((m) => {
    let out = 0;
    for (const t of txns) {
      if (t.deleted || t.review || t.date.slice(0, 7) !== m) continue;
      for (const p of t.splits?.length ? t.splits : [{ categoryId: t.categoryId, amount: t.amount }]) if (p.categoryId === itemId) out -= p.amount;
    }
    return Math.round(out * 100) / 100;
  });
  return sums[0]! > 0.005 && sums[1]! > 0.005 ? [sums[0]!, sums[1]!] : undefined;
}

/**
 * Your real payments to a loan (from the category that pays it) moved away from the loan's payment, and
 * held steady for two months (an escrow change, say): the new amount to suggest, or undefined. Not when
 * you've said to keep the loan's (keptAt near it).
 */
export function newLoanPayment(d: Pick<Debt, "minPayment">, b: Pick<BudgetItem, "keptAt">, paid: [number, number] | undefined): number | undefined {
  if (!paid) return undefined;
  const [a, z] = paid;
  const avg = Math.round(((a + z) / 2) * 100) / 100;
  const steady = Math.abs(a - z) <= Math.max(5, avg * 0.01);
  const moved = Math.abs(avg - d.minPayment) > Math.max(5, d.minPayment * 0.01);
  const kept = b.keptAt !== undefined && Math.abs(b.keptAt - avg) <= Math.max(5, avg * 0.01);
  return steady && moved && !kept ? z : undefined;
}

/** Update a loan to a new payment: for a mortgage with escrow, the change is the escrow (taxes and insurance) moving. */
export function setLoanPayment(d: Debt, payment: number): void {
  const diff = Math.round((payment - d.minPayment) * 100) / 100;
  if (d.kind === "mortgage" && (d.escrow ?? 0) > 0) d.escrow = Math.max(0, Math.round(((d.escrow ?? 0) + diff) * 100) / 100);
  d.minPayment = Math.round(payment * 100) / 100;
}
