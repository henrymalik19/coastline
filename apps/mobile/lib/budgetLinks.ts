/**
 * Which Budget line a plan step or a month's to-do belongs to, so the Plan and Home can link to it.
 * Paycheck things (the 401(k), the full match, a paycheck HSA) have no line: they're set on the job.
 */
import { isHighInterest, paysExtra, rateIn, type PlanState } from "@coastfi/engine";

export function budgetKeyFor(s: PlanState, what: string, month: string): string | null {
  const debtFor = (high?: boolean) => {
    const list = s.debts
      .filter((x) => x.balance > 0 && !x.payroll && paysExtra(x))
      .filter((x) => (high === undefined ? true : isHighInterest(x, s.plan.highApr) === high))
      .sort((a, b) => rateIn(b, month) - rateIn(a, month));
    return list[0] ? "debt:" + list[0].id : null;
  };
  // the emergency fund is one line; investing (IRA, HSA, brokerage) has no Budget line
  if (what === "ef" || what === "em" || what === "starterEF" || what === "fullEF") return "cash";
  if (what === "debt") return debtFor();
  if (what === "highDebt") return debtFor(true);
  if (what === "lowDebt") return debtFor(false);
  if (what.startsWith("goal:")) return what;
  if (what === "goals") {
    const g = s.goals.find((x) => !x.recurring && x.saved < x.target);
    return g ? "goal:" + g.id : null;
  }
  return null; // k401, match: set per paycheck
}
