import { averageSpent, derive, k401Cost, run, simulatePlan, type Derived, type LimitsRow, type MonthRow, type PlanResult, type PlanState, type RunResult, type SpentAverage, type Txn } from "@coastfi/engine";
import { withProperties } from "@coastfi/schema";
import { useLimits } from "./limits";
import { money } from "./format";
import { useStore } from "./store";
import { syncPaycheckLoans } from "./loans";
import { cardMap, foldSavingsLines, hasOldSavingsLines, hasRegister } from "./register";
import { usePlaid } from "./plaidState";
import { withBankBalances, type BankAccount } from "./plaidMatch";
import { estimateBracket } from "./tax";
import type { Theme } from "./theme";

/**
 * The plan as the engine should see it:
 * - projections always follow the plan (the "what you invest today" path is only a comparison
 *   on the Plan page; the old setting to switch them was confusing and is gone);
 * - unless the user typed their own tax bracket, use the estimate from their income and
 *   filing status (so it follows raises and new jobs).
 */
/** Medicare premiums, a supplement and a drug plan: about this much a month per person. */
export const MEDICARE_PER_PERSON = 400;
/** What we assume healthcare costs from 65 when you haven't said: Medicare for you (and a spouse), never more than before 65. */
export function defaultMedicare(s: Pick<PlanState, "healthcare" | "spouse">): number {
  return Math.min(Math.max(0, s.healthcare), MEDICARE_PER_PERSON * (s.spouse ? 2 : 1));
}

export function effectivePlan(saved: PlanState, limits?: LimitsRow[]): PlanState {
  // contribution limits are shared by everyone (lib/limits.ts), not kept in each plan
  if (limits?.length && saved.limits !== limits) saved = { ...saved, limits };
  // homes and rentals from before properties (a device that hasn't synced since)
  saved = withProperties(saved);
  // plans saved before paycheck 401(k) loans came out of take-home: bring them up to date
  const stale = saved.incomes.some((i) => i.deductions?.some((d) => d.kind === "k401_loan" && !saved.debts.find((x) => x.id === d.debtId)?.payroll));
  if (stale) {
    const fixed = structuredClone(saved);
    syncPaycheckLoans(fixed);
    saved = fixed;
  }
  // budgets from before the single Emergency fund line: read them as if folded (saved on the next change)
  if (hasOldSavingsLines(saved)) {
    const fixed = structuredClone(saved);
    foldSavingsLines(fixed);
    saved = fixed;
  }
  // healthcare after 65: Medicare (about $400 a month a person), unless you've set it
  if (saved.medicare === undefined) saved = { ...saved, medicare: defaultMedicare(saved) };
  let plan = saved.plan;
  if (plan.projectWith !== "plan") plan = { ...plan, projectWith: "plan" };
  // 401(k)/HSA steps come out of paychecks: steady per check. The HSA is from paychecks unless you say otherwise.
  const hsaPayroll = plan.hsaPayroll ?? true;
  if (!plan.payrollSteps || plan.hsaPayroll !== hsaPayroll) plan = { ...plan, payrollSteps: true, hsaPayroll };
  if (!plan.marginalTaxManual) {
    const est = estimateBracket(saved.incomes, saved.filingStatus ?? "single");
    if (est && Math.abs(est.total - plan.marginalTax) >= 1e-9) plan = { ...plan, marginalTax: est.total };
  }
  return plan === saved.plan ? saved : { ...saved, plan };
}

/**
 * Runs the engine on the saved plan. Re-runs only when the plan changes.
 * `result` includes any what-ifs (the sliders and one-off changes: projections, dates, odds). `actual` is
 * the month-by-month plan without them: what to really do this month (to-dos) never includes hypothetical money.
 * (Real one-off spending is a transaction in Budget; a one-off change is a "what if".)
 * `forecast` is the Forecast tab's view: only the amounts you set (paychecks, match, minimums, your
 * schedules and budget), with nothing added from what's left over.
 */
type PlanRun = {
  state: PlanState;
  result: RunResult;
  start: Date;
  actual: PlanResult;
  /** The Forecast tab's months, what-ifs included. */
  forecast: PlanResult;
  /** The same without what-ifs (to mark what the what-ifs changed), and its derived numbers. */
  forecastReal: PlanResult;
  realD: Derived;
  whatIfOn: boolean;
};

/**
 * One engine run per saved plan, shared by every screen piece that calls usePlan. (A useMemo in
 * each caller ran the whole engine once per component on every edit, which made typing lag.)
 */
let shared: { saved: PlanState; start: Date; limits: LimitsRow[]; value: PlanRun } | null = null;

function computePlan(saved: PlanState, start: Date, limits: LimitsRow[]): PlanRun {
  if (shared && shared.saved === saved && shared.start === start && shared.limits === limits) return shared.value;
  const state = effectivePlan(saved, limits);
  const result = run(state, start);
  const oneOffs = hasOneOffs(state, start);
  const whatIfOn = !!(state.whatif && (state.whatif.extra || state.whatif.retDelta || state.whatif.spendDelta)) || oneOffs;
  const real = state.whatif?.extra || state.adjustments?.length ? { ...state, whatif: { extra: 0, retDelta: 0, spendDelta: 0 }, adjustments: [] } : state;
  const actual = real !== state ? simulatePlan(real, derive(real, start)) : result.plan;
  // the Forecast tab shows what-ifs; the same plan without any marks what they changed
  const noWhatIf = whatIfOn ? { ...state, whatif: { extra: 0, retDelta: 0, spendDelta: 0 }, adjustments: [] } : state;
  const realD = noWhatIf === state ? result.d : derive(noWhatIf, start);
  const forecastReal = simulatePlan(noWhatIf, realD, { autoFill: false });
  const forecast = whatIfOn ? simulatePlan(state, result.d, { autoFill: false }) : forecastReal;
  const value = { state, result, start, actual, forecast, forecastReal, realD, whatIfOn };
  shared = { saved, start, limits, value };
  return value;
}

/** One-off changes this month or later (they're what-ifs: the real plan leaves them out). */
export function hasOneOffs(s: PlanState, start: Date): boolean {
  const now = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  return (s.adjustments ?? []).some((a) => a.month >= now);
}

/** Today as one shared Date that changes at most once a day (the engine never reads the clock), so every caller hits the same cached run. */
let today: { key: string; date: Date } | null = null;
function sharedToday(key: string): Date {
  if (!today || today.key !== key) today = { key, date: new Date() };
  return today.date;
}

/**
 * The saved plan with your connected banks' balances laid over it (lib/plaidMatch.ts). The same object
 * while nothing it depends on changes, so the engine run above stays cached.
 */
let overlay: { saved: PlanState; bank: BankAccount[]; txns: Txn[]; value: PlanState } | null = null;
const NO_TXNS: Txn[] = [];
function withBanks(saved: PlanState, bank: BankAccount[], txns: Txn[]): PlanState {
  if (!bank.length) return saved;
  if (overlay && overlay.saved === saved && overlay.bank === bank && overlay.txns === txns) return overlay.value;
  const value = withBankBalances(saved, bank, (id) => hasRegister(txns, id));
  overlay = { saved, bank, txns, value };
  return value;
}

/**
 * What you've spent on each category a month lately (the engine's averageSpent, over 12 months), for a
 * category whose retirement amount follows it. The same object while the numbers don't change, so a new
 * transaction this month (which isn't in the average) doesn't rerun the plan.
 */
let avgCache: { txns: Txn[]; month: string; cards: string; value: SpentAverage } | null = null;
const sameAvg = (a: SpentAverage, b: SpentAverage) =>
  a.months === b.months && Object.keys(a.by).length === Object.keys(b.by).length && Object.entries(a.by).every(([k, v]) => b.by[k] === v);
export function spentAverages(txns: Txn[], plan: PlanState, month: string): SpentAverage {
  const cards = cardMap(plan);
  const key = JSON.stringify(cards);
  if (avgCache && avgCache.txns === txns && avgCache.month === month && avgCache.cards === key) return avgCache.value;
  const next = averageSpent(txns, month, cards);
  const value = avgCache && sameAvg(avgCache.value, next) ? avgCache.value : next;
  avgCache = { txns, month, cards: key, value };
  return value;
}

/** The plan with those averages laid over it (never saved), the same object while nothing changes. */
let avgOverlay: { base: PlanState; avg: SpentAverage; value: PlanState } | null = null;
function withSpent(base: PlanState, avg: SpentAverage): PlanState {
  if (!avg.months) return base;
  if (avgOverlay && avgOverlay.base === base && avgOverlay.avg === avg) return avgOverlay.value;
  const value = { ...base, spentAvg: avg };
  avgOverlay = { base, avg, value };
  return value;
}

export function usePlan(): PlanRun {
  const saved = useStore((s) => s.plan);
  const bank = usePlaid((s) => s.accounts);
  // transactions matter only with a bank (an account with a register keeps its own balance)
  const txns = useStore((s) => (bank.length ? s.txns : NO_TXNS));
  const start = sharedToday(new Date().toDateString());
  const month = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;
  // (a stable object: a transaction edit that doesn't move any average doesn't re-render)
  const avg = useStore((s) => spentAverages(s.txns, s.plan, month));
  const limits = useLimits((s) => s.rows);
  return computePlan(withSpent(withBanks(saved, bank, txns), avg), start, limits);
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

export type Todo = { key: string; title: string; detail?: string; /** The longer explanation, in an ⓘ tip. */ info?: string; amount?: number; color: string };

/** A month's actions, in plan order. Formatting only; amounts come from the engine. */
/** Take-home an HSA contribution costs: pre-tax from a paycheck, or dollar for dollar. */
export const hsaTakeHome = (m: MonthRow, marginalTax: number, payroll?: boolean) => (payroll ? m.alloc.hsa * (1 - Math.min(0.6, Math.max(0, marginalTax))) : m.alloc.hsa);

export function monthTodos(m: MonthRow, t: Theme, marginalTax: number, rothShare = 0, hsaPayroll = false, spouseIra = "your spouse's IRA"): Todo[] {
  const a = m.alloc;
  const out: Todo[] = [];
  // paycheck changes are made once (it can take a paycheck or two to start), then stay the same every check
  const checks = (m.checks ?? []).reduce((s, n) => s + n, 0);
  const perCheck = (v: number) => (checks > 0 ? v / checks : v);
  const onceNote =
    "Change it once with your employer. Then enter it on your job in Money → Income and this to-do goes away. If it won't start until a later paycheck, use “changing later” there to pick the month.";
  if (m.emergency) {
    // emergency mode: the only job is to hold on to cash
    if (a.leftover > 0.5) out.push({ key: "em", title: "Keep it in cash (emergency mode)", detail: "Investing and extra payments are paused", amount: a.leftover, color: t.series.ef });
    return out;
  }
  if (a.matchGain > 0.5)
    out.push({ key: "match", title: "Raise your 401(k) to the full-match %", detail: `Your employer adds ${money(a.matchGain)} more this month`, amount: a.k401TakeHome - a.k401Step, color: t.series.k401 });
  if (a.debt > 0.5) out.push({ key: "debt", title: "Pay extra toward debt", detail: "Highest interest rate first", amount: a.debt, color: t.series.debt });
  if (a.ef > 0.5) out.push({ key: "ef", title: "Add to your emergency fund", detail: "Keep it in high-yield savings", amount: a.ef, color: t.series.ef });
  if (a.hsa > 0.5)
    out.push(
      hsaPayroll
        ? { key: "hsa", title: `Add about ${money(perCheck(a.hsa), { whole: true })} per paycheck to your HSA`, detail: "A one-time change with your employer", info: onceNote, amount: hsaTakeHome(m, marginalTax, true), color: t.series.hsa }
        : { key: "hsa", title: "Contribute to your HSA", amount: a.hsa, color: t.series.hsa },
    );
  const sp = m.iraSpouse ?? 0;
  if (a.ira - sp > 0.5) out.push({ key: "ira", title: "Contribute to your IRA", amount: a.ira - sp, color: t.series.ira });
  if (sp > 0.5) out.push({ key: "iraSpouse", title: `Contribute to ${spouseIra}`, amount: sp, color: t.series.ira });
  if (a.goals > 0.5) out.push({ key: "goals", title: "Save toward your goals", amount: a.goals, color: t.series.goals });
  if (a.k401Step > 0.5)
    out.push({ key: "k401", title: `Add about ${money(perCheck(a.k401Step / k401Cost(marginalTax, rothShare)), { whole: true })} per paycheck to your 401(k)`, detail: "A one-time change with your employer", info: onceNote, amount: a.k401Step, color: t.series.k401 });
  if (a.taxable > 0.5) out.push({ key: "taxable", title: "Invest in your brokerage", amount: a.taxable, color: t.series.taxable });
  return out;
}
