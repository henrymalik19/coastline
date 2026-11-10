/**
 * Plan-step status for the Plan tab (port of the prototype's stepInfo/renderPlan).
 * Reads engine output only; no money math beyond display.
 */
import { spouseIraLabel } from "./spouse";
import { BUCKET_LABELS, HSA_ELIGIBLE, isSpouseIra, payPerCheck, scheduleAmount, isHighInterest, k401Cost, limitsFor, paysExtra, PERIODS, STEP_LABELS, type MonthRow, type PlanState, type RunResult, type StepKey } from "@coastfi/engine";
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
    // a smaller last month that finishes the step doesn't count as varying
    const all = rows.map((r) => r.amount).filter((v) => v > 0.5);
    const amounts = to !== undefined && all.length > 2 && all[all.length - 1]! < all[all.length - 2]! ? all.slice(0, -1) : all;
    const varies = amounts.length > 1 && Math.max(...amounts) - Math.min(...amounts) > 1;
    const first = rows.find((r) => r.amount > 0.5);
    if (!first) return "";
    const startsNow = from === 0 && rows[0]!.amount > 0.5;
    if (!varies) return startsNow ? `${money(first.amount)}/mo${what}` : `${money(first.amount)}/mo${what} from ${first.label}`;
    return startsNow ? `${money(rows[0]!.amount)}${what} this month, varies by month (see Forecast)` : `starts ${first.label}, varies by month (see Forecast)`;
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
            const mine = scheduleText(s, "cash");
            return `${money(d.bal.cash)} of ${money(tgt)}${mine ? ` · ${mine}` : avg > 0 ? ` · ${pace((m) => m.alloc.ef, avg, 0, "", e?.m)}` : ""} · ${e ? `done ${when(e.m)}` : "not reached in the plan"}`;
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
              const mine = list.map((x) => (scheduleText(s, "debt:" + x.id) ? `${debtLabel(x)}: ${scheduleText(s, "debt:" + x.id).replace("your plan: ", "")} extra` : "")).filter(Boolean).join("; ");
              return `${list.map((x) => `${debtLabel(x)} ${money(x.balance)}`).join(", ")}${mine ? ` · your plan: ${mine}` : paceText} · paid off in order: ${orderText}`;
            })(),
    };
  }
  if (step === "iraSpouse") {
    // your spouse's IRA: only with a spouse and an IRA marked as theirs
    if (!s.spouse || !s.accounts.some((a) => isSpouseIra(s, a))) return null;
    const L = limitsFor(s.limits, start.getFullYear() + 1);
    const cap = L.ira + (s.spouse.age + 1 >= 50 ? L.iraCatch : 0);
    const ff = pl.months.findIndex((m) => (m.iraSpouse ?? 0) > 0.5);
    const mx = pl.maxedYears.iraSpouse ?? [];
    const c = s.contributed;
    const left = c && c.year === start.getFullYear() ? Math.max(0, L.ira - (c.iraSpouse ?? 0)) : null;
    let meta = ff < 0 ? "Not reached within the plan" : mx.length ? `Starts ${when(ff)} · fills the ${money(cap)} yearly limit from ${mx[0]}` : `Starts ${when(ff)}`;
    if (scheduleText(s, "iraSpouse")) meta = scheduleText(s, "iraSpouse").replace(/^./, (x) => x.toUpperCase()) + (ff >= 0 ? ` · starts ${when(ff)}` : "");
    if (left !== null) meta += left <= 0.5 ? ` · ${c!.year} is maxed` : ` · ${c!.year}: ${money(left)} left`;
    if (s.filingStatus !== "mfj") meta += " · needs filing jointly when they have little or no income";
    if (ff >= 0) meta += untilCoast(ff);
    return { key: step, label: `Max out ${spouseIraLabel(s)} (${money(cap)}/yr)`, done: false, meta };
  }
  if (step === "hsa" || step === "ira" || step === "k401") {
    if (step === "hsa" && !s.plan.hsaEligible && !(s.plan.schedule?.[HSA_ELIGIBLE] ?? []).some((e) => e.amount > 0)) return { key: step, label: STEP_LABELS.hsa, done: false, skip: true, meta: "Skipped: no HSA-eligible health plan (change in Settings)" };
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
    const viaPayroll = step === "k401" || (step === "hsa" && !!s.plan.hsaPayroll);
    if (viaPayroll && ff !== undefined) {
      // set once per paycheck: the steady amount for each year, on top of what you put in now
      const years = payrollYears(step as "k401" | "hsa", s, o, start);
      if (years.length) {
        const [first, ...rest] = years;
        const what = step === "k401" ? "401(k)" : "HSA";
        meta =
          `From ${first!.from}: set ${first!.job}'s ${what} to ${first!.what}` +
          (first!.base > 0.5 ? ` (${first!.changed ? "your change has it at" : "you put in"} ${money(first!.base, { whole: true })}${first!.changed ? " then" : " now"}, +${money(first!.perCheck, { whole: true })})` : "") +
          ` · ${first!.year}: ${first!.summary}` +
          (rest.length ? ` · ${rest[0]!.year}: ${rest[0]!.what}, ${rest[0]!.summary}` : "");
        ctx.schedule = years.map((r, i) => ({ m: i, label: `${r.year} (from ${r.from})`, amount: 0, text: `${r.what} · ${r.summary}` }));
      }
    }
    // IRA (and an HSA you pay into yourself): exact room left when you've told us what's in, and the April 15 deadline
    if ((step === "ira" || step === "hsa") && !viaPayroll && ff !== undefined) {
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
    if (!viaPayroll && scheduleText(s, step)) meta = scheduleText(s, step).replace(/^./, (c) => c.toUpperCase()) + (ff !== undefined ? ` · starts ${when(ff)}` : "");
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
          : scheduleText(s, "taxable")
            ? `${scheduleText(s, "taxable").replace(/^./, (c) => c.toUpperCase())}${untilCoast(ff)}`
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
            const mine = scheduleText(s, step);
            return `${money(g.saved)} saved${mine ? ` · ${mine}` : avg > 0 ? ` · ${pace((m) => m.alloc.goals, avg, 0, "", e?.m)}` : ""} · ${e ? `reached ${when(e.m)}` : "not reached within the plan"}`;
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

type PayYear = { year: number; from: string; job: string; what: string; base: number; perCheck: number; summary: string; /** your own paycheck change is in effect then */ changed: boolean };

/**
 * For each year a payroll step (401(k) or HSA) runs: the steady amount per check to set (and from when),
 * counting what you already put in from each paycheck, and how much of that year's limit it reaches.
 */
function payrollYears(kind: "k401" | "hsa", s: PlanState, o: RunResult, start: Date): PayYear[] {
  const d = o.d;
  const jobs = d.incomes.map((x, i) => ({ x, i })).filter(({ x }) => (x.kind ?? "job") === "job");
  // the job you actually put money in from first; then one with a match or employer money
  const j =
    (kind === "k401"
      ? jobs.find(({ x }) => x.pretax > 0) ?? jobs.find(({ x }) => x.match > 0) ?? jobs.find(({ x }) => x.matchMode === "pct" && (x.contribPct ?? 0) > 0)
      : jobs.find(({ x }) => (x.hsaPre ?? 0) > 0) ?? jobs.find(({ x }) => (x.hsaEmployer ?? 0) > 0)) ?? jobs[0];
  if (!j) return [];
  const cost = kind === "k401" ? k401Cost(s.plan.marginalTax, d.rothShare) : 1;
  const extraIn = (m: MonthRow) => (kind === "k401" ? m.alloc.k401Step / cost : m.alloc.hsa);
  // what you put in per check now (for the 401(k), after the full-match raise if the plan does it)
  const today = kind === "k401" ? j.x.pretax + (j.x.fullMatch ? 0 : j.x.gapPre) : Math.max(0, j.x.hsaPre ?? 0);
  // ...or what your own changes have it at that month (Money → Income → the job)
  const ymOf = (m: MonthRow) => `${m.y}-${String(m.mo + 1).padStart(2, "0")}`;
  const own = (m: MonthRow) => payPerCheck(s.plan, j.x, kind, ymOf(m));
  const todayRaw = kind === "k401" ? j.x.pretax : Math.max(0, j.x.hsaPre ?? 0);
  const changedAt = (m: MonthRow) => Math.abs(own(m) - todayRaw) > 0.005;
  const baseAt = (m: MonthRow) => (changedAt(m) ? own(m) : today);
  const gross = kind === "k401" && j.x.matchMode === "pct" ? j.x.gross ?? 0 : 0;
  const y0 = start.getFullYear();
  const known = s.contributed && s.contributed.year === y0 ? s.contributed : undefined;
  const out: PayYear[] = [];
  const years = [...new Set(o.plan.months.map((m) => m.y))];
  for (const year of years) {
    if (out.length >= 3) break;
    const rows = o.plan.months.filter((m) => m.y === year);
    const firstAt = rows.findIndex((m) => extraIn(m) > 0.5);
    if (firstAt < 0) continue;
    const active = rows.slice(firstAt);
    const extra = active.reduce((a, m) => a + extraIn(m), 0);
    const checks = active.reduce((a, m) => a + (m.checks[j.i] ?? 0), 0);
    if (!(checks > 0)) continue;
    const perCheck = extra / checks;
    const L = limitsFor(s.limits, year);
    const age = s.age + (year - y0);
    const cap =
      kind === "k401"
        ? L.k401 + (age >= 50 ? L.k401Catch : 0)
        : (s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0);
    // everything that counts toward the limit this year: your paychecks, the plan's extra, (HSA) your employer's
    let total = rows.reduce((a, m) => a + (kind === "k401" ? m.payPre + m.alloc.k401 : (m.payHsa ?? 0) + m.payHsaEmployer + m.alloc.hsa), 0);
    const before = year === y0 && start.getMonth() > 0; // months before today aren't in the plan
    const guessed = before && !known ? o.plan.ytdBefore : undefined;
    if (before && known) total += kind === "k401" ? known.k401 : known.hsa;
    else if (guessed) total += kind === "k401" ? guessed.k401 : guessed.hsa;
    const maxed = o.plan.maxedYears[kind].includes(year) || total >= cap - 1;
    const summary = maxed
      ? "maxes it"
      : before && !known && !guessed
        ? `about ${money(total, { whole: true })} from here to December (add what's in so far under Money → Accounts)`
        : `about ${money(total, { whole: true })} of the ${money(cap, { whole: true })} limit${firstAt > 0 ? " (starts part way through the year)" : ""}${guessed ? " (assumes this year's earlier paychecks put in what they do now; enter the real amount under Money → Accounts)" : ""}`;
    const base = baseAt(rows[firstAt]!);
    const what =
      gross > 0
        ? `about ${Math.round(((base + perCheck) / gross) * 100)}% of pay (${money(base + perCheck, { whole: true })}/check)`
        : `about ${money(base + perCheck, { whole: true })}/check`;
    out.push({ year, from: monthLabel(start, rows[firstAt]!.m), job: j.x.name || "your job", what, base: baseAt(rows[firstAt]!), perCheck, summary, changed: changedAt(rows[firstAt]!) });
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

/** What you plan to put in each month, by plan account (from steps with a set amount a month). */
export type PlannedSaving = { key: string; label: string; amount: number; steps: string[] };

const SAVING_LABELS: Record<string, string> = {
  starterEF: "Emergency fund",
  fullEF: "Emergency fund",
  highDebt: "Extra on debt",
  lowDebt: "Extra on debt",
  hsa: "HSA",
  ira: "IRA",
  k401: "401(k)",
  taxable: "Brokerage",
};

/** Steps that fill the same account share one monthly plan (both emergency fund steps, both debt steps). */
export function savingKeyOf(step: string): string {
  return step === "starterEF" || step === "fullEF" ? "cash" : step === "highDebt" || step === "lowDebt" ? "debt" : step;
}

const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const nameOf = (key: string) => `${MONS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** "Your plan: $1,500/mo from Nov 2026 → $3,500/mo from Apr 2027", or "" when the account has no schedule. */
export function scheduleText(s: PlanState, key: string): string {
  const list = [...(s.plan.schedule?.[key] ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1));
  if (!list.length) return "";
  return "your plan: " + list.map((e) => `${money(e.amount)}/mo from ${nameOf(e.from)}`).join(" → ");
}

export function plannedSavings(s: PlanState, month?: string): PlannedSaving[] {
  const amounts = s.plan.amounts ?? {};
  const out: PlannedSaving[] = [];
  // your schedules (this month's amount)
  if (month) {
    const keys = [...new Set([...Object.keys(s.plan.schedule ?? {}), ...Object.keys(s.plan.scheduleMonths ?? {})])];
    for (const key of keys) {
      const v = scheduleAmount(s.plan, key, month);
      if (v === undefined) continue;
      const debt = key.startsWith("debt:") ? s.debts.find((x) => "debt:" + x.id === key) : undefined;
      const goal = key.startsWith("goal:") ? s.goals.find((x) => "goal:" + x.id === key) : undefined;
      const acct = key.startsWith("acct:") ? s.accounts.find((x) => "acct:" + x.id === key) : undefined;
      if (key.startsWith("acct:") && !acct) continue;
      const label = debt ? `Extra on ${debtLabel(debt)}` : goal ? goal.name : acct ? acct.name.trim() || "Account" : key === "cash" ? "Emergency fund" : SAVING_LABELS[key] ?? key;
      out.push({ key, label, amount: v, steps: [] });
    }
  }
  for (const step of s.plan.steps) {
    const v = amounts[step];
    if (v === undefined) continue;
    const key = savingKeyOf(step);
    const have = out.find((x) => x.key === key);
    if (have) { have.steps.push(step); continue; }
    const g = step.startsWith("goal:") ? s.goals.find((x) => "goal:" + x.id === step) : undefined;
    out.push({ key, label: g ? g.name : SAVING_LABELS[step] ?? step, amount: v, steps: [step] });
  }
  return out;
}
