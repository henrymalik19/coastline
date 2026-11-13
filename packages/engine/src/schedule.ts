import type { Account, Debt, PlanAccount, PlanSettings, PlanState, Property, ScheduleEntry } from "./types";
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
/** A rental you keep after you retire: it has rent, and you haven't said you'll sell it first. */
export function keptRental(p: Pick<Property, "kind" | "incomeId" | "inRetirement">): boolean {
  return p.kind === "rental" && !!p.incomeId && p.inRetirement !== false;
}

/** Rent that keeps coming after you retire: a rental you keep, or a home you'll keep renting part of. */
export function rentInRetirement(p: Pick<Property, "kind" | "incomeId" | "inRetirement">): boolean {
  return !!p.incomeId && (p.kind === "rental" ? p.inRetirement !== false : p.inRetirement === true);
}

/** A kept rental's mortgage: what's still owed on it when you retire counts in your number, like a home's. */
export function isKeptRentalDebt(s: Pick<PlanState, "properties">, d: Pick<Debt, "id">): boolean {
  return (s.properties ?? []).some((p) => keptRental(p) && p.mortgageId === d.id);
}

/** A rental's mortgage: its property is a rental (or, from before properties, the debt said so). */
export function isRentalDebt(s: Pick<PlanState, "properties">, d: Pick<Debt, "id" | "rental">): boolean {
  return !!d.rental || (s.properties ?? []).some((p) => p.kind === "rental" && p.mortgageId === d.id);
}

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

/** A budget item that's spending (not money moved to one of your accounts). */
export const isSpendingItem = (b: { accountId?: string }): boolean => !b.accountId;

/**
 * The account a budget item moves money to, when it's one the plan adds to (an IRA, a brokerage, an
 * HSA you fund yourself). Cash, a 401(k) or an account that's gone: none.
 */
export function linkedAccount(s: Pick<PlanState, "plan" | "accounts"> & Partial<Pick<PlanState, "spouse">>, b: { accountId?: string }): Account | undefined {
  if (!b.accountId) return undefined;
  const a = (s.accounts ?? []).find((x) => x.id === b.accountId);
  const kind = a ? accountPlanKey(s, a) : null;
  return a && kind && kind !== "cash" ? a : undefined;
}

/**
 * Budget items linked to an account set that account's monthly amount ("acct:<id>"), unless the
 * account already has its own. Several items on one account add up.
 */
export function linkedItemSchedules(s: Pick<PlanState, "plan" | "accounts" | "budget"> & Partial<Pick<PlanState, "spouse">>): Record<string, ScheduleEntry[]> | undefined {
  const out: Record<string, ScheduleEntry[]> = {};
  const own = s.plan?.schedule ?? {};
  for (const b of s.budget ?? []) {
    const a = linkedAccount(s, b);
    if (!a) continue;
    const key = ACCOUNT_KEY + a.id;
    if (own[key]?.length) continue;
    const changes = own[BUDGET_ITEM + b.id] ?? [];
    if (!(num(b.amount) > 0) && !changes.length) continue;
    const list = (out[key] ??= []);
    if (!list.length) list.push({ from: "0000-01", amount: 0 });
    // today's amount from the start, then the item's changes (rent-style "from this month on")
    list[0]!.amount += Math.max(0, num(b.amount));
    for (const c of changes) list.push({ from: c.from, amount: Math.max(0, num(c.amount)) });
  }
  return Object.keys(out).length ? out : undefined;
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
export function budgetScheduleMonths(s: Pick<PlanState, "debts" | "goals" | "budgetPlan"> & Partial<Pick<PlanState, "accounts" | "budget" | "plan" | "spouse">>): Record<string, Record<string, number>> | undefined {
  const b = s.budgetPlan;
  if (!b?.months) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const [month, e] of Object.entries(b.months)) {
    for (const [rawKey, v] of Object.entries(e.assigned ?? {})) {
      // a budget item linked to an account: what you assign is that account's contribution
      const item = s.plan ? (s.budget ?? []).find((x) => x.id === rawKey) : undefined;
      const linked = item && s.plan ? linkedAccount({ plan: s.plan, accounts: s.accounts ?? [], spouse: s.spouse }, item) : undefined;
      if (item && !linked) continue;
      const key = linked ? ACCOUNT_KEY + linked.id : rawKey;
      let amount: number | undefined;
      if (key.startsWith(ACCOUNT_KEY)) {
        const a = (s.accounts ?? []).find((x) => ACCOUNT_KEY + x.id === key);
        // a cash account (the emergency fund): in the budget's first month, what's already in it isn't new
        // saving, only the part above it is. Later months' amounts are new money going in.
        if (a?.type === "cash") {
          const had = month === b.start ? Math.max(0, num(a.balance)) : 0;
          amount = Math.max(0, num(v) - had);
          if (amount <= 0.005) continue;
        } else amount = Math.max(0, num(v));
      }
      // the Emergency fund line (all your cash): same rule, against all your cash accounts
      else if (key === "cash") {
        // the cash you had when the budget started
        const had = month === b.start ? Math.max(0, num(b.startCash)) : 0;
        amount = Math.max(0, num(v) - had);
        if (amount <= 0.005) continue;
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
      const row = (out[key] ??= {});
      row[month] = (linked ? (row[month] ?? 0) : 0) + amount;
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
