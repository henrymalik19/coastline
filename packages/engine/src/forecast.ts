import { limitsFor } from "./limits";
import type { Account, Derived, PlanAccount, PlanResult, PlanState } from "./types";

export type AccountKey = "k401" | "hsa" | "ira" | "taxable" | "other" | "cash" | "debt" | `goal:${string}`;

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

/** What went into an account in one month, by where it came from. */
export type AccountMonth = {
  m: number;
  y: number;
  mo: number;
  /** From your paychecks as they are today (payroll 401(k), payroll HSA). */
  paycheck: number;
  /** What the plan adds (a raise per check, or from what's left after the budget). */
  plan: number;
  /** Your employer's money (match, employer HSA). */
  employer: number;
  total: number;
  /** Balance at the end of the month (for debts: what's still owed). */
  balance: number;
};

export type AccountYear = { year: number; total: number; employee: number; limit?: number };

export type AccountForecast = {
  key: AccountKey;
  /** Today's balance (for debts: what you owe). */
  start: number;
  months: AccountMonth[];
  years: AccountYear[];
  /** Grows with the market (investments); cash, goals and debts don't. */
  invested: boolean;
  /** Your accounts that make up today's balance. */
  accounts: { id: string; name: string; balance: number }[];
};

/**
 * Month-by-month money in and balance for each account the plan adds to, from the plan's months.
 * Investment balances grow at `r` (real, yearly) the same way the overall projection does; starting
 * balances come from account types (pre-tax → 401(k), Roth → IRA, HSA, brokerage, cash).
 */
export function accountForecasts(s: PlanState, d: Derived, plan: PlanResult, r: number): AccountForecast[] {
  const rm = Math.pow(1 + r, 1 / 12) - 1;
  const rows = plan.months;
  const mk = (key: AccountKey, start: number, invested: boolean, pick: (i: number) => [number, number, number], balanceAt?: (i: number) => number) => {
    let bal = start;
    const months: AccountMonth[] = rows.map((m, i) => {
      const [paycheck, planIn, employer] = pick(i);
      const total = paycheck + planIn + employer;
      bal = balanceAt ? balanceAt(i) : bal * (invested ? 1 + rm : 1) + total;
      return { m: m.m, y: m.y, mo: m.mo, paycheck, plan: planIn, employer, total, balance: bal };
    });
    const accounts = (s.accounts ?? []).filter((x) => accountGroup(x) === key).map((x) => ({ id: x.id, name: x.name, balance: +x.balance || 0 }));
    return { key, start, months, years: [] as AccountYear[], invested, accounts };
  };
  const startOf = (g: PlanAccount | "cash") => (s.accounts ?? []).filter((x) => accountGroup(x) === g).reduce((a, x) => a + (+x.balance || 0), 0);
  const out: AccountForecast[] = [
    mk("k401", startOf("k401"), true, (i) => {
      const m = rows[i]!;
      return [m.payPre, m.alloc.k401, m.payMatch + m.alloc.matchGain];
    }),
    mk("hsa", startOf("hsa"), true, (i) => {
      const m = rows[i]!;
      return [m.payHsa ?? 0, m.alloc.hsa, m.payHsaEmployer];
    }),
    mk("ira", startOf("ira"), true, (i) => [0, rows[i]!.alloc.ira, 0]),
    mk("taxable", startOf("taxable"), true, (i) => [0, rows[i]!.alloc.taxable, 0]),
    // accounts you marked as other investments: they grow, the plan doesn't add to them
    mk("other", startOf("other"), true, () => [0, 0, 0]),
    mk("cash", d.bal.cash, false, (i) => [0, rows[i]!.alloc.ef + rows[i]!.alloc.leftover, 0], (i) => rows[i]!.cash),
  ];
  // one-off goals: what's saved toward each
  for (const g of s.goals ?? []) {
    if (g.recurring) continue;
    let prev = Math.max(0, +g.saved || 0);
    out.push(
      mk(`goal:${g.id}`, prev, false, (i) => {
        const now = rows[i]!.goals.find((x) => x.id === g.id)?.saved ?? prev;
        const put = Math.max(0, now - prev);
        prev = now;
        return [0, put, 0];
      }, (i) => rows[i]!.goals.find((x) => x.id === g.id)?.saved ?? 0),
    );
  }
  if (d.debtTotal > 0) out.push(mk("debt", d.debtTotal, false, (i) => [0, rows[i]!.alloc.debt, 0], (i) => rows[i]!.debtTotal));

  // totals per calendar year, with the employee limit where there is one
  for (const a of out) {
    const byYear = new Map<number, AccountYear>();
    for (const m of a.months) {
      const yr = byYear.get(m.y) ?? { year: m.y, total: 0, employee: 0 };
      yr.total += m.total;
      yr.employee += m.paycheck + m.plan;
      byYear.set(m.y, yr);
    }
    for (const yr of byYear.values()) {
      const L = limitsFor(s.limits, yr.year);
      const age = d.age + (yr.year - d.start.getFullYear());
      if (a.key === "k401") yr.limit = L.k401 + (age >= 50 ? L.k401Catch : 0);
      else if (a.key === "ira") yr.limit = L.ira + (age >= 50 ? L.iraCatch : 0);
      else if (a.key === "hsa" && s.plan.hsaEligible) yr.limit = (s.plan.hsaFamily ? L.hsaFamily : L.hsaSelf) + (age >= 55 ? L.hsaCatch : 0);
      // the HSA limit counts your employer's money too
      if (a.key === "hsa") yr.employee = yr.total;
    }
    a.years = [...byYear.values()];
  }
  return out;
}
