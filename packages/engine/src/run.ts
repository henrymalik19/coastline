import { derive } from "./derive";
import { monteCarlo } from "./montecarlo";
import { simulatePlan } from "./plan";
import { coastCrossing, coastNumberAt, fireNumber, project } from "./project";
import type { MonteCarloResult, PlanState, RunResult } from "./types";

/** Monte Carlo seed used by `run` (fixed, so results are reproducible). */
export const MC_SEED = 20261106;

function coastOnly(s: PlanState, startDate: Date, extraMonthly: number): number | null {
  const d = derive(s, startDate);
  const plan = simulatePlan(s, d, { extraMonthly });
  const proj = project(d, plan, d.r);
  const fire = fireNumber(d, proj.preShareFinal);
  return coastCrossing(proj, d, fire, d.r);
}

/** Everything the UI needs. Pure: same state + startDate gives the same result. */
export function run(s: PlanState, startDate: Date): RunResult {
  const d = derive(s, startDate);
  const plan = simulatePlan(s, d);
  const proj = project(d, plan, d.r);
  const fire = fireNumber(d, proj.preShareFinal);
  const coastNow = coastNumberAt(fire, d.r, d.years);
  const crossing = coastCrossing(proj, d, fire, d.r);
  const rCons = d.r - 0.015;
  const projC = project(d, plan, rCons);
  const fireC = fireNumber(d, projC.preShareFinal);
  const crossingC = coastCrossing(projC, d, fireC, rCons);
  const mc: MonteCarloResult =
    d.years > 0
      ? monteCarlo(d, plan, d.r, fire, { seed: MC_SEED })
      : { bands: [], probFire: d.invested >= fire ? 1 : 0, probCoastNow: d.invested >= fire ? 1 : 0 };
  const coastCurve = Array.from({ length: d.years + 1 }, (_, t) => coastNumberAt(fire, d.r, d.years - t));

  const baseExtra = (s.whatif && s.whatif.extra) || 0;
  const plus100 = coastOnly(s, startDate, baseExtra + 100);
  const altMode = simulatePlan(s, d, { mode: plan.mode === "plan" ? "current" : "plan" });
  const projAlt = project(d, altMode, d.r);

  const M = d.years * 12;
  const whenBalance = (target: number): number | null => {
    for (let k = 0; k < proj.series.length; k++) if (proj.series[k]! >= target) return k;
    return null;
  };
  const whenCoastPct = (f: number): number | null => {
    for (let k = 0; k <= M; k++) if (proj.series[k]! >= f * coastNumberAt(fire, d.r, (M - k) / 12)) return k;
    return null;
  };

  return {
    d, plan, fire, coastNow, crossing, rCons, fireC, crossingC, mc, coastCurve,
    preShareFinal: proj.preShareFinal,
    projectedFinal: proj.final,
    projSeries: proj.series,
    altFinal: projAlt.final,
    altMode: altMode.mode,
    progress: coastNow > 0 ? d.invested / coastNow : 0,
    progressFire: fire > 0 ? d.invested / fire : 0,
    freedomDays: d.retireAnnual > 0 ? d.invested / (d.retireAnnual / 365) : Infinity,
    coastSoonerMonths: crossing !== null && plus100 !== null ? Math.round((crossing - plus100) * 12) : null,
    whenBalance,
    whenCoastPct,
  };
}
