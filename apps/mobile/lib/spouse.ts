import type { PlanState } from "@coastfi/engine";

/** What to call your spouse: their name, else "Your spouse" (or "Spouse" mid-sentence when `short`). */
export function spouseName(s: Pick<PlanState, "spouse">, short = false): string {
  return s.spouse?.name.trim() || (short ? "Spouse" : "Your spouse");
}

/** "Sam's IRA", or "Your spouse's IRA". */
export function spouseIraLabel(s: Pick<PlanState, "spouse">): string {
  return `${spouseName(s)}'s IRA`;
}

/** Give your spouse's IRA its own spot in your priority order (right after yours) the first time it's needed. */
export function ensureSpouseStep(p: PlanState): void {
  const steps = p.plan.steps;
  if (steps.includes("iraSpouse")) return;
  const i = steps.indexOf("ira");
  steps.splice(i >= 0 ? i + 1 : steps.length, 0, "iraSpouse");
}
