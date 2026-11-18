import type { Derived, PlanState } from "@coastfi/engine";

/**
 * What you owe that counts against net worth: every debt except a 401(k) loan repaid from your paycheck.
 * That one is already out of your 401(k)'s balance (the balance you enter is after the loan), so
 * subtracting it again would count it twice.
 */
export const owedForNetWorth = (s: PlanState) => (s.debts ?? []).reduce((a, x) => a + (x.payroll ? 0 : Math.max(0, +x.balance || 0)), 0);

/** Net worth: invested + cash + property + money saved toward goals − what you owe. One formula for every screen. */
export function netWorth(d: Derived, s: PlanState): number {
  return d.invested + d.bal.cash + (d.bal.property ?? 0) + s.goals.reduce((a, g) => a + (+g.saved || 0), 0) - owedForNetWorth(s);
}
