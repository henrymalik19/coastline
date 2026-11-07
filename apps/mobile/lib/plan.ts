import { derive, k401Cost, run, simulatePlan, type MonthRow, type PlanResult, type PlanState, type RunResult } from "@coastfi/engine";
import { useMemo } from "react";
import { money } from "./format";
import { useStore } from "./store";
import { syncPaycheckLoans } from "./loans";
import { estimateBracket } from "./tax";
import type { Theme } from "./theme";

/** Today, as a stable Date that changes at most once a day (the engine never reads the clock). */
function useToday(): Date {
  const key = new Date().toDateString();
  return useMemo(() => new Date(), [key]);
}

/**
 * The plan as the engine should see it:
 * - projections always follow the plan (the "what you invest today" path is only a comparison
 *   on the Plan page; the old setting to switch them was confusing and is gone);
 * - unless the user typed their own tax bracket, use the estimate from their income and
 *   filing status (so it follows raises and new jobs).
 */
export function effectivePlan(saved: PlanState): PlanState {
  // plans saved before paycheck 401(k) loans came out of take-home: bring them up to date
  const stale = saved.incomes.some((i) => i.deductions?.some((d) => d.kind === "k401_loan" && !saved.debts.find((x) => x.id === d.debtId)?.payroll));
  if (stale) {
    const fixed = structuredClone(saved);
    syncPaycheckLoans(fixed);
    saved = fixed;
  }
  let plan = saved.plan;
  if (plan.projectWith !== "plan") plan = { ...plan, projectWith: "plan" };
  if (!plan.marginalTaxManual) {
    const est = estimateBracket(saved.incomes, saved.filingStatus ?? "single");
    if (est && Math.abs(est.total - plan.marginalTax) >= 1e-9) plan = { ...plan, marginalTax: est.total };
  }
  return plan === saved.plan ? saved : { ...saved, plan };
}

/**
 * Runs the engine on the saved plan. Re-runs only when the plan changes.
 * `result` includes any what-ifs (projections, dates, odds). `actual` is the month-by-month plan
 * without them: what to really do this month (to-dos, Monthly) never includes hypothetical money.
 */
export function usePlan(): { state: PlanState; result: RunResult; start: Date; actual: PlanResult; whatIfOn: boolean } {
  const saved = useStore((s) => s.plan);
  const state = useMemo(() => effectivePlan(saved), [saved]);
  const start = useToday();
  const result = useMemo(() => run(state, start), [state, start]);
  const whatIfOn = !!(state.whatif && (state.whatif.extra || state.whatif.retDelta || state.whatif.spendDelta));
  const actual = useMemo(() => {
    if (!state.whatif?.extra) return result.plan;
    const real = { ...state, whatif: { extra: 0, retDelta: 0, spendDelta: 0 } };
    return simulatePlan(real, derive(real, start));
  }, [state, start, result]);
  return { state, result, start, actual, whatIfOn };
}

/** Plain-English line for a month that comes up short. */
export function shortfallText(m: MonthRow): string {
  const fromCash = m.shortfall - m.borrowed;
  if (m.borrowed > 0.5) {
    return fromCash > 0.5
      ? `Short ${money(m.shortfall)}: ${money(fromCash)} from cash, ${money(m.borrowed)} on a credit card. The next months rebuild your cash and pay off the card, in your plan's order.`
      : `Short ${money(m.shortfall)}, all on a credit card (no cash left). The next months pay it off in your plan's order.`;
  }
  return `Short ${money(m.shortfall)} this month, covered from your cash. The plan refills it.`;
}

export type Todo = { key: string; title: string; detail?: string; amount?: number; color: string };

/** A month's actions, in plan order. Formatting only; amounts come from the engine. */
export function monthTodos(m: MonthRow, t: Theme, marginalTax: number, rothShare = 0): Todo[] {
  const a = m.alloc;
  const out: Todo[] = [];
  if (m.emergency) {
    // emergency mode: the only job is to hold on to cash
    if (a.leftover > 0.5) out.push({ key: "em", title: "Keep it in cash (emergency mode)", detail: "Investing and extra payments are paused", amount: a.leftover, color: t.series.ef });
    return out;
  }
  if (a.matchGain > 0.5)
    out.push({ key: "match", title: "Raise your 401(k) to the full-match %", detail: `Your employer adds ${money(a.matchGain)} more this month`, amount: a.k401TakeHome - a.k401Step, color: t.series.k401 });
  if (a.debt > 0.5) out.push({ key: "debt", title: "Pay extra toward debt", detail: "Highest interest rate first", amount: a.debt, color: t.series.debt });
  if (a.ef > 0.5) out.push({ key: "ef", title: "Add to your emergency fund", detail: "Keep it in high-yield savings", amount: a.ef, color: t.series.ef });
  if (a.hsa > 0.5) out.push({ key: "hsa", title: "Contribute to your HSA", amount: a.hsa, color: t.series.hsa });
  if (a.ira > 0.5) out.push({ key: "ira", title: "Contribute to your IRA", amount: a.ira, color: t.series.ira });
  if (a.goals > 0.5) out.push({ key: "goals", title: "Save toward your goals", amount: a.goals, color: t.series.goals });
  if (a.k401Step > 0.5)
    out.push({ key: "k401", title: "Put extra into your 401(k)", detail: `${money(a.k401Step / k401Cost(marginalTax, rothShare))} into your 401(k)`, amount: a.k401Step, color: t.series.k401 });
  if (a.taxable > 0.5) out.push({ key: "taxable", title: "Invest in your brokerage", amount: a.taxable, color: t.series.taxable });
  return out;
}
