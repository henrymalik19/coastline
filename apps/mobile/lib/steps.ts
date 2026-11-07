/**
 * Plan-step status for the Plan tab (port of the prototype's stepInfo/renderPlan).
 * Reads engine output only; no money math beyond display.
 */
import { BUCKET_LABELS, isHighInterest, k401Cost, limitsFor, paysExtra, PERIODS, STEP_LABELS, type MonthRow, type PlanState, type RunResult, type StepKey } from "@coastfi/engine";
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
  /** What this step gets each month, from the plan (tap to see). */
  schedule?: ScheduleRow[];
};

export type ScheduleRow = { m: number; label: string; amount: number; note?: string; /** shown instead of the amount */ text?: string };

export function stepInfo(step: StepKey, s: PlanState, o: RunResult, start: Date): StepInfo | null {
  const ctx: { schedule?: ScheduleRow[] } = {};
  const info = stepInfoInner(step, s, o, start, ctx);
  return info && ctx.schedule && ctx.schedule.length > 1 ? { ...info, schedule: ctx.schedule } : info;
}

function stepInfoInner(step: StepKey, s: PlanState, o: RunResult, start: Date, ctx: { schedule?: ScheduleRow[] }): StepInfo | null {
  const pl = o.plan;
  const d = o.d;
  const ev = (k: string) => pl.events.find((e) => e.key === k);
  const when = (m: number | null | undefined) => (m === null || m === undefined ? null : m === 0 ? "this month" : monthLabel(start, m));
  /** Typical monthly amount for a step while it's being funded (first year of nonzero months from `from`). */
  const typical = (pick: (m: MonthRow) => number, from = 0, to?: number) => {
    const xs = pl.months.slice(from, to ?? from + 12).map(pick).filter((v) => v > 0.5);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
  };
  /** The step's amount in each month from `from` through `to` (or 12 months), noting 3-paycheck months. */
  const schedule = (pick: (m: MonthRow) => number, from: number, to?: number): ScheduleRow[] =>
    pl.months.slice(from, Math.min((to ?? from + 11) + 1, from + 24)).map((m) => ({
      m: m.m,
      label: m.m === 0 ? `This month (${monthLabel(start, 0)})` : monthLabel(start, m.m),
      amount: pick(m),
      note:
        [m.extraCheck ? "3 paychecks" : "", m.shortfall > 0.5 ? "short month" : "", pick(m) <= 0.5 && !m.emergency
            ? m.alloc.ira + m.alloc.hsa + m.alloc.k401Step > 0.5
              ? "this month goes to retirement accounts first (new yearly limits)"
              : "earlier steps use it all this month"
            : "", m.emergency ? "emergency mode" : ""]
          .filter(Boolean)
          .join(" · ") || undefined,
    }));
  /**
   * This month's amount, and whether it changes month to month. Never an average: real months differ
   * (3-paycheck months, debts paid off), so the exact amounts are one tap away.
   */
  const pace = (pick: (m: MonthRow) => number, _avg: number, from = 0, what = "", to?: number) => {
    const rows = schedule(pick, from, to);
    ctx.schedule = rows;
    const amounts = rows.map((r) => r.amount).filter((v) => v > 0.5);
    const varies = amounts.length > 1 && Math.max(...amounts) - Math.min(...amounts) > 1;
    const first = rows.find((r) => r.amount > 0.5);
    if (!first) return "";
    const startsNow = from === 0 && rows[0]!.amount > 0.5;
    if (!varies) return startsNow ? `${money(first.amount)}/mo${what}` : `${money(first.amount)}/mo${what} from ${first.label}`;
    return startsNow ? `${money(rows[0]!.amount)}${what} this month, varies by month (see Each month)` : `starts ${first.label}, varies by month (see Each month)`;
  };
  // Coast FI month: after it, more investing is optional (it retires you earlier, it isn't needed)
  const coastM = o.crossing === null ? null : Math.round(o.crossing * 12);
  const untilCoast = (ff: number) =>
    coastM === null
      ? " · keep going: Coast FI isn't reached by your retirement age yet"
      : coastM === 0
        ? " · optional: you've already reached Coast FI"
        : ff < coastM
          ? ` · needed until Coast FI in ${when(coastM)}, then optional`
          : ` · starts after Coast FI (${when(coastM)}), so it's optional`;

  if (step === "starterEF" || step === "fullEF") {
    const tgt = step === "starterEF" ? pl.starterTarget : pl.fullTarget;
    const done = d.bal.cash >= tgt - 0.5;
    const e = ev(step);
    return {
      key: step,
      label: step === "starterEF" ? `Starter emergency fund: ${money(tgt)}` : `Full emergency fund: ${s.plan.efMonths} months (${money(tgt)})`,
      done,
      progress: tgt > 0 ? Math.min(1, d.bal.cash / tgt) : 1,
      meta: done
        ? `Done. ${money(d.bal.cash)} in cash`
        : (() => {
            const avg = typical((m) => m.alloc.ef, 0, e ? e.m + 1 : undefined);
            return `${money(d.bal.cash)} of ${money(tgt)}${avg > 0 ? ` · ${pace((m) => m.alloc.ef, avg, 0, "", e?.m)}` : ""} · ${e ? `done ${when(e.m)}` : "not reached in the plan"}`;
          })(),
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
    const list = s.debts.filter((x) => paysExtra(x) && isHighInterest(x, thr) === hi);
    const bal = list.reduce((a, x) => a + (+x.balance || 0), 0);
    const ends = list.map((x) => ev("debt:" + x.id)).filter(Boolean);
    const last = ends.length === list.length && ends.length ? Math.max(...ends.map((e) => e!.m)) : null;
    return {
      key: step,
      label: hi ? `Pay off high-interest debt (≥ ${percent(thr, 1)} APR)` : `Pay down low-interest debt (< ${percent(thr, 1)} APR)`,
      done: bal <= 0.5,
      meta:
        bal <= 0.5
          ? "None"
          : (() => {
              // low-interest debt starts once high-interest debt is gone; average from then
              const highEnds = s.debts.filter((x) => paysExtra(x) && isHighInterest(x, thr)).map((x) => ev("debt:" + x.id)?.m ?? 0);
              const after = hi ? 0 : Math.max(0, ...highEnds.map((m) => m + 1));
              const from = Math.max(after, pl.months.findIndex((m, i) => i >= after && m.alloc.debt > 0.5));
              const avg = typical((m) => m.alloc.debt, from, last !== null ? last + 1 : undefined);
              const paceText = avg > 0 ? ` · ${pace((m) => m.alloc.debt, avg, from, " extra", last ?? undefined)}` : " · minimum payments only (no extra reaches this step)";
              // payoff order (highest rate first, as the plan pays them) with dates
              const order = list
                .map((x) => ({ x, end: ev("debt:" + x.id)?.m }))
                .sort((a, b) => (a.end ?? 1e9) - (b.end ?? 1e9));
              const orderText = order.map(({ x, end }) => `${debtLabel(x)} ${end !== undefined ? when(end) : "after the plan"}`).join(", ");
              // each month: the debt that gets the extra (avalanche: highest rate still owed), and payoffs
              if (ctx.schedule) {
                const byRate = [...list].sort((a, b) => b.apr - a.apr);
                ctx.schedule = ctx.schedule.map((r) => {
                  const paid = order.filter(({ end }) => end === r.m).map(({ x }) => `${debtLabel(x)} paid off`);
                  const target = byRate.find((x) => (ev("debt:" + x.id)?.m ?? 1e9) >= r.m);
                  const notes = [
                    r.amount > 0.5 && target ? `→ ${debtLabel(target)} (${percent(target.apr, 2).replace(/\.?0+%$/, "%")})` : "",
                    ...paid,
                    r.note ?? "",
                  ].filter(Boolean);
                  return { ...r, note: notes.join(" · ") || undefined };
                });
              }
              return `${list.map((x) => `${debtLabel(x)} ${money(x.balance)}`).join(", ")}${paceText} · paid off in order: ${orderText}`;
            })(),
    };
  }
  if (step === "hsa" || step === "ira" || step === "k401") {
    if (step === "hsa" && !s.plan.hsaEligible) return { key: step, label: STEP_LABELS.hsa, done: false, skip: true, meta: "Skipped: no HSA-eligible health plan (change in Settings)" };
    const ff = pl.firstFund[step];
    const mx = pl.maxedYears[step];
    const L = limitsFor(s.limits, start.getFullYear() + 1);
    const cap = step === "k401" ? L.k401 : step === "ira" ? L.ira : s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf;
    const pick = (m: MonthRow) => (step === "k401" ? m.alloc.k401Step : m.alloc[step]);
    const avg = ff === undefined ? 0 : typical(pick, ff);
    let meta =
      ff === undefined
        ? step === "k401" && mx.length
          ? "Payroll contributions already max it"
          : "Not reached within the plan"
        : mx.length
          ? // capped accounts fill fast, then wait for the next year: say so instead of a misleading monthly average
            `Starts ${when(ff)} · fills the ${money(cap)} yearly limit ${mx[0] === start.getFullYear() ? "from this year" : "from " + mx[0]}`
          : avg > 0
            ? pace(pick, avg, ff).replace(/^./, (c) => c.toUpperCase())
            : `Starts ${when(ff)}`;
    if (step === "k401" && ff !== undefined) {
      // A 401(k) is set as a % of each paycheck: for each year, the steady rate that adds up to what the plan puts in
      const rates = payrollRates(s, o, start);
      if (rates.length) {
        const [first, ...rest] = rates;
        meta = `From ${first!.from}: set ${first!.job}'s 401(k) to ${first!.what}${first!.plus}${rest.length ? ` · ${rest[0]!.year}: ${rest[0]!.what}` : ""}`;
        ctx.schedule = rates.map((r, i) => ({ m: i, label: `${r.year} (from ${r.from})`, amount: 0, text: r.what }));
      }
    }
    // IRA / HSA: exact room left when you've told us what's in, and the April 15 deadline
    if ((step === "ira" || step === "hsa") && ff !== undefined) {
      const room = contributionRoom(s, start, step, ff);
      meta += room
        ? ` · ${room}`
        : ` · add what you've contributed this year (Money → Accounts) for exact room`;
      const priorKey = step === "ira" ? "priorIra" : "priorHsa";
      if (ctx.schedule) ctx.schedule = ctx.schedule.map((r) => (pl.months[r.m]?.[priorKey] ?? 0) > 0.5 ? { ...r, note: `for ${start.getFullYear() + Math.floor((start.getMonth() + r.m) / 12) - 1} (before Apr 15)` } : r);
      else {
        const rows = schedule((m) => m.alloc[step], ff, ff + 11).map((r) => (pl.months[r.m]?.[priorKey] ?? 0) > 0.5 ? { ...r, note: `for ${start.getFullYear() + Math.floor((start.getMonth() + r.m) / 12) - 1} (before Apr 15)` } : r);
        if (rows.some((r) => r.amount > 0.5)) ctx.schedule = rows;
      }
    }
    if (ff !== undefined) meta += untilCoast(ff);
    return { key: step, label: `${STEP_LABELS[step]} (${money(cap)}/yr)`, done: false, meta };
  }
  if (step === "taxable") {
    const ff = pl.firstFund.taxable;
    const avg = ff === undefined ? 0 : typical((m) => m.alloc.taxable, ff);
    return {
      key: step,
      label: STEP_LABELS.taxable,
      done: false,
      meta:
        ff === undefined
          ? "Everything left over. Not reached within the plan"
          : `Everything left over${avg > 0 ? `: ${pace((m) => m.alloc.taxable, avg, ff)}` : ` from ${when(ff)}`}${untilCoast(ff)}`,
    };
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
      meta: done
        ? "Done"
        : (() => {
            const avg = typical((m) => m.alloc.goals, 0, e ? e.m + 1 : undefined);
            return `${money(g.saved)} saved${avg > 0 ? ` · ${pace((m) => m.alloc.goals, avg, 0, "", e?.m)}` : ""} · ${e ? `reached ${when(e.m)}` : "not reached within the plan"}`;
          })(),
    };
  }
  return null;
}

/** "2026: $2,500 of $7,500 left · until Apr 15, 2027", from what you said you've contributed (else null). */
function contributionRoom(s: PlanState, start: Date, step: "ira" | "hsa", firstMonth: number): string | null {
  const c = s.contributed;
  const y = start.getFullYear();
  if (!c || (c.year !== y && !(c.year === y - 1 && start.getMonth() <= 3))) return null;
  const L = limitsFor(s.limits, c.year);
  const age = s.age + (c.year - y);
  const cap =
    step === "ira"
      ? L.ira + (age >= 50 ? L.iraCatch : 0)
      : (s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0);
  const left = Math.max(0, cap - (step === "ira" ? c.ira : c.hsa));
  if (left <= 0.5) return `${c.year} is maxed`;
  // month index of the April 15 deadline for that year
  const deadline = (c.year + 1 - y) * 12 + 3 - start.getMonth();
  const missed = firstMonth > deadline ? " (the plan doesn't reach this step by then, so it goes unused unless you add more)" : "";
  return `${c.year}: ${money(left)} of ${money(cap)} left · until Apr 15, ${c.year + 1}${missed}`;
}

/** For each year the 401(k) step runs: the payroll % to set (and from when) so a steady rate matches the plan. */
function payrollRates(s: PlanState, o: RunResult, start: Date): { year: number; from: string; job: string; what: string; plus: string }[] {
  const d = o.d;
  const i = d.incomes.findIndex((x) => x.pretax > 0 || x.match > 0 || x.matchMode === "pct");
  const inc = i >= 0 ? d.incomes[i]! : d.incomes[0];
  if (!inc) return [];
  const idx = Math.max(0, i);
  const cost = k401Cost(s.plan.marginalTax, d.rothShare);
  const gross = inc.matchMode === "pct" ? inc.gross ?? 0 : 0;
  const out: { year: number; from: string; job: string; what: string; plus: string }[] = [];
  const byYear = new Map<number, MonthRow[]>();
  for (const m of o.plan.months) {
    if (m.alloc.k401Step <= 0.5 && !byYear.has(m.y)) continue;
    byYear.set(m.y, [...(byYear.get(m.y) ?? []), m]);
  }
  for (const [year, rows] of byYear) {
    if (out.length >= 3) break;
    const extra = rows.reduce((a, m) => a + m.alloc.k401Step / cost, 0);
    const checks = rows.reduce((a, m) => a + (m.checks[idx] ?? 0), 0);
    if (!(extra > 0.5) || !(checks > 0)) continue;
    const perCheck = extra / checks;
    const base = inc.pretax + (inc.fullMatch ? 0 : inc.gapPre); // after the match step, if the plan does it
    const from = monthLabel(start, rows[0]!.m);
    const what =
      gross > 0
        ? `about ${Math.round(((base + perCheck) / gross) * 100)}% of pay${rows[0]!.mo === 0 ? " all year" : ""}`
        : `about ${money(base + perCheck, { whole: true })}/check`;
    out.push({ year, from, job: inc.name || "your job", what, plus: gross > 0 ? ` (+${money(perCheck, { whole: true })}/check)` : "" });
  }
  return out;
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
