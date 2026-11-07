import type { Derived, PlanState } from "@coastfi/engine";

/** Net worth: invested + cash + property + money saved toward goals − debts. One formula for every screen. */
export function netWorth(d: Derived, s: PlanState): number {
  return d.invested + d.bal.cash + (d.bal.property ?? 0) + s.goals.reduce((a, g) => a + (+g.saved || 0), 0) - d.debtTotal;
}
