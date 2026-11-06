/**
 * Plan-step status for the Plan tab (port of the prototype's stepInfo/renderPlan).
 * Reads engine output only; no money math beyond display.
 */
import { BUCKET_LABELS, limitsFor, PERIODS, STEP_LABELS, type PlanState, type RunResult, type StepKey } from "@coastfi/engine";
import { debtLabel } from "./debts";
import { money, monthLabel, percent } from "./format";

export type StepInfo = {
  key: StepKey;
  label: string;
  meta: string;
  done: boolean;
  skip?: boolean;
  /** Needs the user to do something outside the app (e.g. change payroll). */
  action?: boolean;
  progress?: number;
};

export function stepInfo(step: StepKey, s: PlanState, o: RunResult, start: Date): StepInfo | null {
  const pl = o.plan;
  const d = o.d;
  const ev = (k: string) => pl.events.find((e) => e.key === k);
  const when = (m: number | null | undefined) => (m === null || m === undefined ? null : m === 0 ? "this month" : monthLabel(start, m));

  if (step === "starterEF" || step === "fullEF") {
    const tgt = step === "starterEF" ? pl.starterTarget : pl.fullTarget;
    const done = d.bal.cash >= tgt - 0.5;
    const e = ev(step);
    return {
      key: step,
      label: step === "starterEF" ? `Starter emergency fund: ${money(tgt)}` : `Full emergency fund: ${s.plan.efMonths} months (${money(tgt)})`,
      done,
      progress: tgt > 0 ? Math.min(1, d.bal.cash / tgt) : 1,
      meta: done ? `Done. ${money(d.bal.cash)} in cash` : `${money(d.bal.cash)} of ${money(tgt)} · ${e ? `done ${when(e.m)}` : "not reached in the plan"}`,
    };
  }
  if (step === "match") {
    const missing = d.incomes.filter((i) => !i.fullMatch);
    const any = d.incomes.some((i) => i.match > 0);
    const e = ev("match");
    const parts = missing.map((i) =>
      i.gapPre > 0
        ? `raise ${i.name} from ${percent(i.contribPct ?? 0, 2)} to ${percent(i.maxPct ?? 0, 2)} (+${money(i.gapPre)}/check)`
        : `raise ${i.name} until you get the full match`,
    );
    return {
      key: step,
      label: STEP_LABELS.match + (d.matchLeftPerYear > 0 ? ` (+${money(d.matchLeftPerYear)}/yr)` : ""),
      done: !missing.length,
      action: missing.length > 0,
      meta: missing.length
        ? parts.join("; ").replace(/^./, (c) => c.toUpperCase()) + (e ? (e.m === 0 ? " · the plan does this now" : ` · the plan does this ${when(e.m)}`) : "")
        : any ? "You're getting the full match" : "No employer match listed",
    };
  }
  if (step === "highDebt" || step === "lowDebt") {
    const hi = step === "highDebt";
    const thr = s.plan.highApr;
    const list = s.debts.filter((x) => (hi ? x.apr >= thr : x.apr < thr));
    const bal = list.reduce((a, x) => a + (+x.balance || 0), 0);
    const ends = list.map((x) => ev("debt:" + x.id)).filter(Boolean);
    const last = ends.length === list.length && ends.length ? Math.max(...ends.map((e) => e!.m)) : null;
    return {
      key: step,
      label: hi ? `Pay off high-interest debt (≥ ${percent(thr, 1)} APR)` : `Pay down low-interest debt (< ${percent(thr, 1)} APR)`,
      done: bal <= 0.5,
      meta: bal <= 0.5 ? "None" : `${list.map((x) => `${debtLabel(x)} ${money(x.balance)}`).join(", ")} · ${last !== null ? "paid off " + when(last) : "not paid off within the plan"}`,
    };
  }
  if (step === "hsa" || step === "ira" || step === "k401") {
    if (step === "hsa" && !s.plan.hsaEligible) return { key: step, label: STEP_LABELS.hsa, done: false, skip: true, meta: "Skipped: no HSA-eligible health plan (change in Settings)" };
    const ff = pl.firstFund[step];
    const mx = pl.maxedYears[step];
    const L = limitsFor(s.limits, start.getFullYear() + 1);
    const cap = step === "k401" ? L.k401 : step === "ira" ? L.ira : s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf;
    let meta = ff === undefined ? (step === "k401" && mx.length ? "Payroll contributions already max it" : "Not reached within the plan") : `Starts ${when(ff)}`;
    if (mx.length) meta += ` · fully maxed ${mx[0] === start.getFullYear() ? "this year" : "from " + mx[0]}`;
    if (step === "k401" && ff !== undefined) {
      const m = pl.months.find((x) => x.alloc.k401Step > 0.5 && !x.extraCheck);
      const main = s.incomes.find((i) => (i.pretax ?? 0) > 0 || (i.match ?? 0) > 0 || i.matchMode === "pct") ?? s.incomes[0];
      if (m && main) meta += ` · then raise ${main.name}'s 401(k) by about ${money(((m.alloc.k401Step / (1 - s.plan.marginalTax)) * 12) / PERIODS[main.freq])}/check`;
    }
    return { key: step, label: `${STEP_LABELS[step]} (${money(cap)}/yr)`, done: false, meta };
  }
  if (step === "taxable") {
    const ff = pl.firstFund.taxable;
    return { key: step, label: STEP_LABELS.taxable, done: false, meta: ff === undefined ? "Everything left over. Not reached within the plan" : `Everything left over · starts ${when(ff)}` };
  }
  if (step.startsWith("goal:")) {
    const g = s.goals.find((x) => "goal:" + x.id === step);
    if (!g) return null;
    const e = ev(step);
    const done = g.saved >= g.target - 0.5;
    return {
      key: step,
      label: `Goal: ${g.name} (${money(g.target)})`,
      done,
      progress: g.target > 0 ? Math.min(1, g.saved / g.target) : 1,
      meta: done ? "Done" : `${money(g.saved)} saved · ${e ? `reached ${when(e.m)}` : "not reached within the plan"}`,
    };
  }
  return null;
}

export type Milestone = { m: number; text: string; minor?: boolean; big?: boolean };

/** Everything worth celebrating, in date order. */
export function milestones(o: RunResult, s: PlanState): Milestone[] {
  // debt events: use the on-screen label (a debt may have no name, just a type)
  const debtText = (key: string) => {
    const d = key.startsWith("debt:") ? s.debts.find((x) => "debt:" + x.id === key) : undefined;
    return d ? `${debtLabel(d)} paid off` : undefined;
  };
  const items: Milestone[] = o.plan.events.filter((e) => e.m < Math.max(o.d.years * 12, 36)).map((e) => ({ m: e.m, text: debtText(e.key) ?? e.text }));
  for (const k of ["ira", "k401", "hsa", "taxable"] as const) {
    const m = o.plan.firstFund[k];
    if (m !== undefined) items.push({ m, text: `Start funding ${BUCKET_LABELS[k]}`, minor: true });
  }
  for (const f of [0.25, 0.5, 0.75]) {
    const k = o.whenCoastPct(f);
    if (k) items.push({ m: k, text: `${f * 100}% of the way to Coast FI` });
  }
  if (o.crossing !== null && o.crossing > 0) items.push({ m: Math.round(o.crossing * 12), text: "Coast FI: you could stop investing", big: true });
  const fk = o.whenBalance(o.fire);
  if (fk) items.push({ m: fk, text: "Full FIRE number reached", big: true });
  return items.sort((a, b) => a.m - b.m);
}
