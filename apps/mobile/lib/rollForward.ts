/**
 * When a change's month arrives, it becomes the amount in its field: the HSA switch turns on in
 * January 2027, gross pay becomes $3,300, a $150/check HSA shows as $150. The change leaves the list
 * (only what's still ahead stays there), and one-month changes from past months are cleared. What
 * follows from a job's fields follows too: take-home, and taxes while they're still the estimate.
 *
 * Only inputs move this way (pay, costs, eligibility); planned amounts for accounts and debts stay
 * on their schedules.
 */
import { BUDGET_ITEM, HSA_ELIGIBLE, HSAEMP, PAY401, PAYDED, PAYGROSS, PAYHSA, PAYNET, isValueKey, type Income, type PlanState, type ScheduleEntry } from "@coastfi/engine";
import { paycheck } from "./paycheck";
import { estimateJobTaxes, taxesFollowEstimate } from "./tax";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Apply every change that has started by `month` ("YYYY-MM") to its field. Returns true if anything moved. */
export function rollForward(p: PlanState, month: string): boolean {
  const sched = p.plan.schedule ?? {};
  const singles = p.plan.scheduleMonths ?? {};
  let moved = false;
  // each job before anything moved, to know whether its taxes were still the estimate
  const before = new Map(p.incomes.map((inc) => [inc.id, structuredClone(inc)]));
  const touched = new Set<string>();

  for (const k of Object.keys(sched)) {
    if (!isValueKey(k)) continue;
    const list = [...(sched[k] ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1));
    const started = list.filter((e) => e.from <= month);
    if (!started.length) continue;
    const e = started[started.length - 1]!;
    if (!apply(p, k, e, touched)) continue; // its income, deduction or item is gone: leave it
    const rest = list.filter((x) => x.from > month);
    if (rest.length) sched[k] = rest;
    else delete sched[k];
    moved = true;
  }
  // one-month changes from past months are over
  for (const k of Object.keys(singles)) {
    if (!isValueKey(k)) continue;
    const row = singles[k]!;
    for (const m of Object.keys(row)) if (m < month) { delete row[m]; moved = true; }
    if (!Object.keys(row).length) delete singles[k];
  }
  if (!moved) return false;
  p.plan.schedule = Object.keys(sched).length ? sched : undefined;
  p.plan.scheduleMonths = Object.keys(singles).length ? singles : undefined;

  // jobs that changed: taxes follow while they're the estimate, and take-home is worked out again
  for (const inc of p.incomes) {
    if (!touched.has(inc.id) || (inc.kind ?? "job") !== "job") continue;
    const old = before.get(inc.id)!;
    if (inc.netMode === "auto") {
      if ((inc.gross ?? 0) > 0 && taxesFollowEstimate(old, (i) => estimateJobTaxes(withIncomes(p, old), i))) inc.taxes = estimateJobTaxes(p, inc);
      inc.net = paycheck(inc).net;
    }
  }
  return true;
}

/** The plan as it was for one job (other jobs as they are now), for checking its old estimate. */
const withIncomes = (p: PlanState, inc: Income) => ({ ...p, incomes: p.incomes.map((x) => (x.id === inc.id ? inc : x)) });

/** Put one change into its field. False when what it belongs to no longer exists. */
function apply(p: PlanState, k: string, e: ScheduleEntry, touched: Set<string>): boolean {
  const amount = Math.max(0, e.amount);
  const job = (prefix: string) => p.incomes.find((x) => x.id === k.slice(prefix.length));
  if (k === HSA_ELIGIBLE) {
    p.plan.hsaEligible = amount > 0;
    return true;
  }
  if (k.startsWith(BUDGET_ITEM)) {
    const item = p.budget.find((x) => x.id === k.slice(BUDGET_ITEM.length));
    if (!item) return false;
    item.amount = amount;
    return true;
  }
  if (k.startsWith(PAYDED)) {
    const [incId, dedId] = k.slice(PAYDED.length).split(":");
    const inc = p.incomes.find((x) => x.id === incId);
    const ded = inc?.deductions?.find((x) => x.id === dedId);
    if (!inc || !ded) return false;
    ded.amount = amount;
    touched.add(inc.id);
    return true;
  }
  const inc =
    k.startsWith(PAYGROSS) ? job(PAYGROSS)
    : k.startsWith(PAYNET) ? job(PAYNET)
    : k.startsWith(HSAEMP) ? job(HSAEMP)
    : k.startsWith(PAY401) ? job(PAY401)
    : k.startsWith(PAYHSA) ? job(PAYHSA)
    : undefined;
  if (!inc) return false;
  touched.add(inc.id);
  if (k.startsWith(PAYGROSS)) inc.gross = amount;
  else if (k.startsWith(PAYNET)) inc.net = amount;
  else if (k.startsWith(HSAEMP)) inc.hsaEmployer = amount || undefined;
  else if (k.startsWith(PAYHSA)) inc.hsaPre = round2(e.pct !== undefined && (inc.gross ?? 0) > 0 ? (inc.gross ?? 0) * e.pct : amount) || undefined;
  else if (k.startsWith(PAY401)) {
    const gross = inc.gross ?? 0;
    if (inc.matchMode === "pct") inc.contribPct = e.pct ?? (gross > 0 ? Math.round((amount / gross) * 10000) / 10000 : inc.contribPct);
    else inc.pretax = round2(e.pct !== undefined && gross > 0 ? gross * e.pct : amount);
  }
  return true;
}

