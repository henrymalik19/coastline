import { run, type MonthRow, type PlanState, type RunResult } from "@coastfi/engine";
import { useMemo } from "react";
import { money } from "./format";
import { useStore } from "./store";
import type { Theme } from "./theme";

/** Today, as a stable Date that changes at most once a day (the engine never reads the clock). */
function useToday(): Date {
  const key = new Date().toDateString();
  return useMemo(() => new Date(), [key]);
}

/** Runs the engine on the saved plan. Re-runs only when the plan changes. */
export function usePlan(): { state: PlanState; result: RunResult; start: Date; isSample: boolean } {
  const state = useStore((s) => s.plan);
  const onboarded = useStore((s) => s.onboarded);
  const start = useToday();
  const result = useMemo(() => run(state, start), [state, start]);
  return { state, result, start, isSample: !onboarded };
}

export type Todo = { key: string; title: string; detail?: string; amount?: number; color: string };

/** A month's actions, in plan order. Formatting only; amounts come from the engine. */
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
