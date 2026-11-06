import { run, type MonthRow, type PlanState, type RunResult } from "@coastfi/engine";
import { samplePlanState } from "@coastfi/schema";
import { useMemo } from "react";
import { money } from "./format";
import type { Theme } from "./theme";

/**
 * Runs the engine for the current plan. Until onboarding/storage land (Phase 2)
 * this is the prototype's sample plan, and screens say so.
 */
export function usePlan(): { state: PlanState; result: RunResult; start: Date; isSample: boolean } {
  return useMemo(() => {
    const start = new Date(); // the UI injects the date; the engine never reads the clock
    const state = samplePlanState();
    return { state, result: run(state, start), start, isSample: true };
  }, []);
}

export type Todo = { key: string; title: string; detail?: string; amount?: number; color: string };

/** This month's actions, in plan order. Formatting only; amounts come from the engine. */
export function monthTodos(m: MonthRow, t: Theme, marginalTax: number): Todo[] {
  const a = m.alloc;
  const out: Todo[] = [];
  if (a.matchGain > 0.5)
    out.push({ key: "match", title: "Raise your 401(k) to the full-match %", detail: `Your employer adds ${money(a.matchGain)} more this month`, amount: a.k401TakeHome - a.k401Step, color: t.series.k401 });
  if (a.debt > 0.5) out.push({ key: "debt", title: "Pay extra toward debt", detail: "Highest interest rate first", amount: a.debt, color: t.series.debt });
  if (a.ef > 0.5) out.push({ key: "ef", title: "Add to your emergency fund", detail: "Keep it in high-yield savings", amount: a.ef, color: t.series.ef });
  if (a.hsa > 0.5) out.push({ key: "hsa", title: "Contribute to your HSA", amount: a.hsa, color: t.series.hsa });
  if (a.ira > 0.5) out.push({ key: "ira", title: "Contribute to your IRA", amount: a.ira, color: t.series.ira });
  if (a.goals > 0.5) out.push({ key: "goals", title: "Save toward your goals", amount: a.goals, color: t.series.goals });
  if (a.k401Step > 0.5)
    out.push({ key: "k401", title: "Put extra into your 401(k)", detail: `${money(a.k401Step / (1 - marginalTax))} pre-tax`, amount: a.k401Step, color: t.series.k401 });
  if (a.taxable > 0.5) out.push({ key: "taxable", title: "Invest in your brokerage", amount: a.taxable, color: t.series.taxable });
  return out;
}
