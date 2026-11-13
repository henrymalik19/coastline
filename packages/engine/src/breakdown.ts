/**
 * Your number, step by step: what you'll spend in retirement, what that needs invested (the FIRE
 * number), what that needs invested today (the Coast number), and what your money supports. Plus
 * the same math at other spending levels (Lean, Fat) and Barista FI.
 */
import { coastNumberAt } from "./project";
import { isSpendingItem } from "./schedule";
import type { Derived, PlanState, RunResult } from "./types";
import { num, sum } from "./util";

export type SpendingLine = { key: "budget" | "healthcare" | "bills" | "escrow" | "home" | "whatif"; label: string; monthly: number };

export type FireBreakdown = {
  /** Retirement spending a month, piece by piece (adds up to `retireMonthly`). */
  spending: SpendingLine[];
  retireMonthly: number;
  retireAnnual: number;
  /** Social Security and pensions a year, once they've all started. */
  income: number;
  /** What your savings has to cover a year. */
  need: number;
  swr: number;
  /** need ÷ withdrawal rate. */
  base: number;
  /** Extra for income tax on pre-tax money (base ÷ (1 − tax rate × pre-tax share) − base). */
  taxExtra: number;
  /** Covering retirement income that starts later, until it does (tax included). */
  bridge: number;
  /** Mortgage payments left after you retire (tax included). */
  homeBridge: number;
  fire: number;
  years: number;
  /** Real return a year. */
  r: number;
  /** How much a dollar grows by retirement: (1 + r)^years. */
  growth: number;
  coastNow: number;
  invested: number;
  /** If you stopped saving today: what you'd have at retirement, and the spending it supports. */
  coastValue: number;
  coastSupports: number;
  /** On your plan: what you'd have at retirement, and the spending it supports. */
  planValue: number;
  planSupports: number;
};

/** The parts of retirement spending (before what-ifs), as derive adds them up. */
function spendingParts(s: PlanState, d: Pick<Derived, "escrowMonthly" | "homeMonthly">, essentialOnly = false) {
  const budget = (s.budget ?? []).filter((b) => isSpendingItem(b) && b.inRetirement && (!essentialOnly || b.essential !== false));
  const bills = (s.goals ?? [])
    .filter((g) => g.recurring && num(g.target) > 0 && num(g.recurring.every) > 0 && g.recurring.inRetirement !== false)
    .map((g) => num(g.target) / num(g.recurring!.every));
  return { budget: sum(budget.map((b) => b.amount)), healthcare: num(s.healthcare), bills: sum(bills), escrow: d.escrowMonthly, home: d.homeMonthly };
}

/** Yearly spending your savings supports at retirement, from a balance then (the FIRE number turned around). */
function supports(value: number, d: Derived, o: Pick<RunResult, "homeBridge" | "preShareFinal">): number {
  const gross = 1 - d.taxRate * o.preShareFinal;
  const free = Math.max(0, value - (d.retireBridge + o.homeBridge) / gross);
  return free * gross * d.swr + d.retireIncomeAnnual;
}

export function fireBreakdown(s: PlanState, o: RunResult): FireBreakdown {
  const d = o.d;
  const p = spendingParts(s, d);
  const before = p.budget + p.healthcare + p.bills + p.escrow + p.home;
  const delta = num(s.whatif?.spendDelta);
  const spending: SpendingLine[] = [
    { key: "budget", label: "Budget items still paid", monthly: p.budget },
    { key: "healthcare", label: "Healthcare", monthly: p.healthcare },
    { key: "bills", label: "Bills set aside (yearly and other)", monthly: p.bills },
    { key: "escrow", label: "Property tax + insurance (escrow)", monthly: p.escrow },
    { key: "home", label: "Home costs and upkeep", monthly: p.home },
    { key: "whatif", label: `What-if: spending ${delta >= 0 ? "+" : "−"}${Math.round(Math.abs(delta) * 100)}%`, monthly: before * delta },
  ];
  const gross = 1 - d.taxRate * o.preShareFinal;
  const need = Math.max(0, d.retireAnnual - d.retireIncomeAnnual);
  const base = need / d.swr;
  const growth = Math.pow(1 + d.r, Math.max(0, d.years));
  const coastValue = d.invested * growth;
  return {
    spending: spending.filter((x) => Math.abs(x.monthly) > 0.005 || x.key === "budget" || x.key === "healthcare"),
    retireMonthly: d.retireMonthly,
    retireAnnual: d.retireAnnual,
    income: d.retireIncomeAnnual,
    need,
    swr: d.swr,
    base,
    taxExtra: base / gross - base,
    bridge: d.retireBridge / gross,
    homeBridge: o.homeBridge / gross,
    fire: o.fire,
    years: d.years,
    r: d.r,
    growth,
    coastNow: o.coastNow,
    invested: d.invested,
    coastValue,
    coastSupports: supports(coastValue, d, o),
    planValue: o.projectedFinal,
    planSupports: supports(o.projectedFinal, d, o),
  };
}

export type FiLevel = {
  key: "lean" | "fi" | "fat";
  label: string;
  /** Retirement spending a month at this level. */
  monthly: number;
  fire: number;
  coastNow: number;
  /** Months until your plan reaches this level's Coast number (0 = already), or null if not before you retire. */
  coastIn: number | null;
};

/** Fat FI's spending: your retirement spending times this. */
export const FAT_FACTOR = 1.5;

/** The same math at other spending levels: Lean (essentials only), your plan's FI, and Fat. */
export function fiLevels(s: PlanState, o: RunResult): FiLevel[] {
  const d = o.d;
  const gross = 1 - d.taxRate * o.preShareFinal;
  const bridges = (d.retireBridge + o.homeBridge) / gross;
  const fireAt = (monthly: number) => Math.max(0, monthly * 12 - d.retireIncomeAnnual) / gross / d.swr + bridges;
  const delta = 1 + num(s.whatif?.spendDelta);
  const e = spendingParts(s, d, true);
  const lean = (e.budget + e.healthcare + e.bills + e.escrow + e.home) * delta;
  const level = (key: FiLevel["key"], label: string, monthly: number, fire: number): FiLevel => ({
    key, label, monthly, fire,
    coastNow: coastNumberAt(fire, d.r, d.years),
    coastIn: o.fire > 0 ? o.whenCoastPct(fire / o.fire) : 0,
  });
  return [
    level("lean", "Lean FI", lean, fireAt(lean)),
    level("fi", "FI", d.retireMonthly, o.fire),
    level("fat", "Fat FI", d.retireMonthly * FAT_FACTOR, fireAt(d.retireMonthly * FAT_FACTOR)),
  ];
}

/**
 * Barista FI: if you stopped investing from your paycheck today, what you'd need to earn a month
 * until you retire, to pay today's costs and still reach your FIRE number. When you've already
 * reached Coast FI, that's just your costs.
 */
export function baristaFi(o: RunResult): { monthly: number; costs: number; saving: number } {
  const d = o.d;
  const n = d.years * 12;
  const rm = Math.pow(1 + d.r, 1 / 12) - 1;
  const short = Math.max(0, o.fire - d.invested * Math.pow(1 + d.r, d.years));
  const saving = short <= 0 ? 0 : n <= 0 ? short : rm === 0 ? short / n : (short * rm) / (Math.pow(1 + rm, n) - 1);
  return { monthly: d.monthlyExpenses + saving, costs: d.monthlyExpenses, saving };
}
