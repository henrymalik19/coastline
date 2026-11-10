import type { Account, PlanAccount, PlanSettings, PlanState, ScheduleEntry } from "./types";
import { num } from "./util";

/** This month's scheduled amount for an account ("YYYY-MM"), or undefined when it isn't on a schedule that month. */
export function scheduleAmount(p: Pick<PlanSettings, "schedule" | "scheduleMonths">, key: string, month: string): number | undefined {
  const one = p.scheduleMonths?.[key]?.[month];
  if (one !== undefined) return one;
  const list = p.schedule?.[key];
  if (!list || !list.length) return undefined;
  // before its first entry the account follows your steps
  let v: number | undefined;
  for (const e of [...list].sort((x, y) => (x.from < y.from ? -1 : 1))) if (e.from <= month) v = Math.max(0, num(e.amount));
  return v;
}

/**
 * Which plan account a balance belongs to: what you picked, else a guess from the name (401(k), 403(b),
 * 457, TSP → 401(k); IRA → IRA), else the type (pre-tax → 401(k), Roth → IRA). Property isn't one.
 */
export function accountGroup(a: Pick<Account, "name" | "type" | "counts">): PlanAccount | "cash" | null {
  if (a.type === "property") return null;
  if (a.type === "cash") return "cash";
  if (a.counts) return a.counts;
  if (a.type === "hsa") return "hsa";
  if (a.type === "taxable") return "taxable";
  const n = a.name.toLowerCase();
  if (/401|403|457|\btsp\b|thrift/.test(n)) return "k401";
  if (/\bira\b/.test(n)) return "ira";
  return a.type === "pretax" ? "k401" : "ira";
}

/**
 * Your spouse's IRA: an IRA account marked as theirs, when the plan has a spouse. It has its own yearly
 * limit, its own plan step ("iraSpouse") and its own line in the forecast.
 */
export function isSpouseIra(s: Pick<PlanState, "spouse">, a: Pick<Account, "name" | "type" | "counts" | "owner">): boolean {
  return !!s.spouse && a.owner === "spouse" && accountGroup(a) === "ira";
}

/** A job's 401(k) / HSA per paycheck, changed by month ("pay401:<job id>", "payhsa:<job id>"). */
export const PAY401 = "pay401:";
export const PAYHSA = "payhsa:";

/*
 * Other amounts that change over time. Each uses the same schedule as the rest of the plan: a change
 * from a month on ("$3,300/check from Jan 2027", until the next change) or a one-month change.
 */
/** A job's gross pay per paycheck ("paygross:<job id>"): a raise, a new job, an unpaid month. */
export const PAYGROSS = "paygross:";
/** Take-home per payment you typed ("paynet:<income id>"): other income, or a job's typed take-home. */
export const PAYNET = "paynet:";
/** A paycheck deduction ("payded:<job id>:<deduction id>"): insurance going up, union dues starting. */
export const PAYDED = "payded:";
/** What an employer puts in your HSA per year ("hsaemp:<job id>"). */
export const HSAEMP = "hsaemp:";
/** A budget item's monthly amount ("item:<item id>"): rent going up, daycare ending. */
export const BUDGET_ITEM = "item:";
/** Whether you can put money in an HSA (1 or 0), changed by month. */
export const HSA_ELIGIBLE = "hsaEligible";

/** Keys that change an input (pay, costs, eligibility), not how much goes into an account or debt. */
export const isValueKey = (k: string): boolean =>
  k === HSA_ELIGIBLE || [PAY401, PAYHSA, PAYGROSS, PAYNET, PAYDED, HSAEMP, BUDGET_ITEM].some((p) => k.startsWith(p));

/** An amount in a month ("YYYY-MM"): a one-month change, else the change in effect, else `base` (today's). */
export function valueIn(p: Pick<PlanSettings, "schedule" | "scheduleMonths"> | undefined, key: string, month: string, base: number): number {
  return scheduleAmount(p ?? {}, key, month) ?? base;
}

/** Whether you can put money in an HSA in a month: the setting, changed by month. */
export const hsaEligibleIn = (p: Partial<Pick<PlanSettings, "schedule" | "scheduleMonths" | "hsaEligible">> | undefined, month: string): boolean =>
  valueIn(p, HSA_ELIGIBLE, month, p?.hsaEligible ? 1 : 0) > 0;

/**
 * A job's 401(k) or HSA per paycheck in a month: a one-month change, else the change in effect (a dollar
 * amount, or a share of gross pay when the job has one), else what the job says today.
 */
export function payPerCheck(
  p: Pick<PlanSettings, "schedule" | "scheduleMonths">,
  inc: { id: string; pretax?: number; hsaPre?: number; gross?: number },
  kind: "k401" | "hsa",
  month: string,
): number {
  const key = (kind === "k401" ? PAY401 : PAYHSA) + inc.id;
  const one = p.scheduleMonths?.[key]?.[month];
  if (one !== undefined) return Math.max(0, num(one));
  let e: ScheduleEntry | undefined;
  for (const x of [...(p.schedule?.[key] ?? [])].sort((a, b) => (a.from < b.from ? -1 : 1))) if (x.from <= month) e = x;
  if (e) return e.pct !== undefined && num(inc.gross) > 0 ? num(inc.gross) * Math.max(0, num(e.pct)) : Math.max(0, num(e.amount));
  return kind === "k401" ? num(inc.pretax) : Math.max(0, num(inc.hsaPre));
}

/** Prefix of an account's own monthly amount in the schedule ("acct:<id>"). */
export const ACCOUNT_KEY = "acct:";

/**
 * The plan key an account's own monthly amount adds to (cash, IRA, HSA, brokerage), or null when the
 * account is set some other way: the 401(k) and a paycheck HSA per paycheck, property and "other" not at all.
 */
export function accountPlanKey(
  s: Pick<PlanState, "plan"> & Partial<Pick<PlanState, "spouse">>,
  a: Pick<Account, "name" | "type" | "counts" | "owner">,
): "cash" | "ira" | "iraSpouse" | "hsa" | "taxable" | null {
  const g = accountGroup(a);
  if (!g || g === "other" || g === "k401") return null;
  if (isSpouseIra(s, a)) return "iraSpouse";
  if (g === "hsa" && s.plan?.hsaPayroll !== false) return null;
  return g;
}

/**
 * Each account can have its own monthly amount ("acct:<id>"); the plan adds them up by kind. Two IRAs at
 * $300 and $200 a month make the IRA's $500. A kind's own amount (set before accounts had theirs) adds in
 * too. Amounts for accounts that no longer exist, or that the plan doesn't add to, are dropped.
 */
export function mergeAccountSchedules(s: Pick<PlanState, "plan" | "accounts"> & Partial<Pick<PlanState, "spouse">>): Pick<PlanSettings, "schedule" | "scheduleMonths"> {
  const sched = s.plan?.schedule ?? {};
  const months = s.plan?.scheduleMonths ?? {};
  const keys = [...new Set([...Object.keys(sched), ...Object.keys(months)])];
  if (!keys.some((k) => k.startsWith(ACCOUNT_KEY))) return { schedule: s.plan?.schedule, scheduleMonths: s.plan?.scheduleMonths };
  // where each key's amount goes
  const sources: Record<string, string[]> = {};
  for (const k of keys) {
    if (!k.startsWith(ACCOUNT_KEY)) {
      (sources[k] ??= []).push(k);
      continue;
    }
    const a = (s.accounts ?? []).find((x) => x.id === k.slice(ACCOUNT_KEY.length));
    const g = a ? accountPlanKey(s, a) : null;
    if (g) (sources[g] ??= []).push(k);
  }
  const p = { schedule: sched, scheduleMonths: months };
  const outS: Record<string, ScheduleEntry[]> = {};
  const outM: Record<string, Record<string, number>> = {};
  for (const [g, src] of Object.entries(sources)) {
    if (src.length === 1 && src[0] === g) {
      if (sched[g]) outS[g] = sched[g]!;
      if (months[g]) outM[g] = months[g]!;
      continue;
    }
    // a change for the kind wherever any of its accounts changes: the sum of what each has then
    const froms = [...new Set(src.flatMap((k) => (sched[k] ?? []).map((e) => e.from)))].sort();
    const list: ScheduleEntry[] = [];
    for (const from of froms) {
      let total = 0;
      for (const k of src) total += scheduleAmount({ schedule: sched }, k, from) ?? 0;
      list.push({ from, amount: total });
    }
    if (list.length) outS[g] = list;
    // one-month changes: that account's month, plus what the others have that month
    const singles = [...new Set(src.flatMap((k) => Object.keys(months[k] ?? {})))];
    if (singles.length) {
      const row: Record<string, number> = {};
      for (const m of singles) {
        let total = 0;
        for (const k of src) total += scheduleAmount(p, k, m) ?? 0;
        row[m] = total;
      }
      outM[g] = row;
    }
  }
  return {
    schedule: Object.keys(outS).length ? outS : undefined,
    scheduleMonths: Object.keys(outM).length ? outM : undefined,
  };
}

/**
 * What you assigned to savings and debts feeds the plan for those months: an account gets exactly
 * what you assigned, a debt gets what you assigned beyond its minimum as extra.
 */
export function budgetScheduleMonths(s: Pick<PlanState, "debts" | "goals" | "budgetPlan"> & Partial<Pick<PlanState, "accounts">>): Record<string, Record<string, number>> | undefined {
  const b = s.budgetPlan;
  if (!b?.months) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [month, e] of Object.entries(b.months)) {
    for (const [key, v] of Object.entries(e.assigned ?? {})) {
      let amount: number | undefined;
      if (key.startsWith(ACCOUNT_KEY)) {
        const a = (s.accounts ?? []).find((x) => ACCOUNT_KEY + x.id === key);
        // a cash account (the emergency fund): in the budget's first month, what's already in it isn't new
        // saving, only the part above it is. Later months' amounts are new money going in.
        if (a?.type === "cash") {
          const had = month === b.start ? Math.max(0, num(b.registers?.[a.id]?.opening ?? a.balance)) : 0;
          amount = Math.max(0, num(v) - had);
          if (amount <= 0.005) continue;
        } else amount = Math.max(0, num(v));
      }
      // a kind with no account yet ("ira", "taxable", "hsa")
      else if (key === "ira" || key === "hsa" || key === "taxable") amount = Math.max(0, num(v));
      else if (key.startsWith("goal:")) {
        // repeating goals set aside on their own; one-time goals get what you assigned
        const g = (s.goals ?? []).find((y) => "goal:" + y.id === key);
        if (!g || g.recurring) continue;
        amount = Math.max(0, num(v));
      }
      else if (key.startsWith("debt:")) {
        const x = (s.debts ?? []).find((y) => "debt:" + y.id === key);
        if (!x || x.payroll) continue;
        amount = Math.max(0, num(v) - Math.max(0, num(x.minPayment)));
      }
      if (amount === undefined) continue;
      (out[key] ??= {})[month] = amount;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** One-month amounts from `b` laid over `a` (b wins for the same key and month). */
export function mergeMonths(
  a: Record<string, Record<string, number>> | undefined,
  b: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = { ...(a ?? {}) };
  for (const [k, row] of Object.entries(b)) out[k] = { ...(out[k] ?? {}), ...row };
  return out;
}
