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

/** A job's 401(k) / HSA per paycheck, changed by month ("pay401:<job id>", "payhsa:<job id>"). */
export const PAY401 = "pay401:";
export const PAYHSA = "payhsa:";

/** Prefix of an account's own monthly amount in the schedule ("acct:<id>"). */
export const ACCOUNT_KEY = "acct:";

/**
 * The plan key an account's own monthly amount adds to (cash, IRA, HSA, brokerage), or null when the
 * account is set some other way: the 401(k) and a paycheck HSA per paycheck, property and "other" not at all.
 */
export function accountPlanKey(s: Pick<PlanState, "plan">, a: Pick<Account, "name" | "type" | "counts">): "cash" | "ira" | "hsa" | "taxable" | null {
  const g = accountGroup(a);
  if (!g || g === "other" || g === "k401") return null;
  if (g === "hsa" && s.plan?.hsaPayroll !== false) return null;
  return g;
}

/**
 * Each account can have its own monthly amount ("acct:<id>"); the plan adds them up by kind. Two IRAs at
 * $300 and $200 a month make the IRA's $500. A kind's own amount (set before accounts had theirs) adds in
 * too. Amounts for accounts that no longer exist, or that the plan doesn't add to, are dropped.
 */
export function mergeAccountSchedules(s: Pick<PlanState, "plan" | "accounts">): Pick<PlanSettings, "schedule" | "scheduleMonths"> {
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
