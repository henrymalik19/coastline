import { PERIODS, type Income, type PayDeduction, type PlanState } from "@coastfi/engine";
import { debtKind } from "./debts";
import { newId } from "./id";

/**
 * 401(k) loan repayments entered on a paycheck are linked to a "401(k) loan" debt:
 * the deduction holds the per-check amount, the debt holds the balance and rate, and the
 * debt's monthly payment is kept equal to per-check × checks per year ÷ 12. Take-home
 * doesn't subtract the repayment, so it's counted once (as the debt payment).
 */
export const isLoanDeduction = (d: PayDeduction) => d.kind === "k401_loan";

export const monthlyFromPaycheck = (perCheck: number, inc: Pick<Income, "freq">) => (Math.max(0, perCheck) * PERIODS[inc.freq]) / 12;

/** Which paycheck pays a debt, if it's linked to one. */
export function paycheckFor(state: PlanState, debtId: string): { income: Income; deduction: PayDeduction } | null {
  for (const income of state.incomes)
    for (const deduction of income.deductions ?? []) if (isLoanDeduction(deduction) && deduction.debtId === debtId) return { income, deduction };
  return null;
}

/**
 * Keep paycheck loan repayments and their debts in step (runs after every plan change):
 * - a new repayment (no debt yet) gets a new 401(k) loan debt;
 * - a repayment whose debt was removed on the Debts page is removed too;
 * - each linked debt's monthly payment follows the paycheck amount.
 */
export function syncPaycheckLoans(p: PlanState): void {
  for (const inc of p.incomes) {
    if (!inc.deductions?.some(isLoanDeduction)) continue;
    inc.deductions = inc.deductions.filter((d) => {
      if (!isLoanDeduction(d)) return true;
      if (!d.debtId) {
        d.debtId = newId();
        p.debts.push({ id: d.debtId, name: `${inc.name || "Job"} 401(k) loan`, kind: "k401_loan", balance: 0, apr: debtKind("k401_loan").typicalApr, minPayment: 0 });
      }
      const debt = p.debts.find((x) => x.id === d.debtId);
      if (!debt) return false; // the debt was removed: drop the repayment too
      debt.kind = "k401_loan";
      debt.minPayment = Math.round(monthlyFromPaycheck(d.amount, inc) * 100) / 100;
      return true;
    });
  }
}
