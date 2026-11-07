import { BASE_CHECKS, PERIODS } from "./constants";
import { resolveIncome } from "./match";
import type { Balances, Derived, PlanState, WhatIf } from "./types";
import { num, sum } from "./util";

/** Static summary of the inputs. `startDate` is injected; the engine never reads the clock. */
export function derive(s: PlanState, startDate: Date): Derived {
  const w: Partial<WhatIf> = s.whatif ?? {};
  const bal: Balances = { pretax: 0, roth: 0, taxable: 0, hsa: 0, cash: 0 };
  for (const a of s.accounts ?? []) bal[a.type] = (bal[a.type] || 0) + num(a.balance);
  const invested = bal.pretax + bal.roth + bal.taxable + bal.hsa;

  const incomes = (s.incomes ?? []).map(resolveIncome);
  const annualNet = sum(incomes.map((i) => num(i.net) * PERIODS[i.freq]));
  const leanMonthly = sum(incomes.map((i) => num(i.net) * BASE_CHECKS[i.freq]));
  const annualPre = sum(incomes.map((i) => num(i.pretax) * PERIODS[i.freq]));
  const annualMatch = sum(incomes.map((i) => num(i.match) * PERIODS[i.freq]));

  const budget = s.budget ?? [];
  const budgetTotal = sum(budget.map((b) => b.amount));
  const debtMins = sum((s.debts ?? []).filter((d) => num(d.balance) > 0).map((d) => d.minPayment));
  const monthlyExpenses = budgetTotal + debtMins;
  // essentials: items not explicitly marked non-essential, plus debt minimums
  const essentialExpenses = sum(budget.filter((b) => b.essential !== false).map((b) => b.amount)) + debtMins;

  const retireMonthly =
    (sum(budget.filter((b) => b.inRetirement).map((b) => b.amount)) + num(s.healthcare)) * (1 + (w.spendDelta || 0));
  const years = Math.max(0, Math.round(s.retireAge - s.age));

  // income in retirement: the yearly total once everything has started, plus the savings
  // needed to cover whatever starts after you retire until it does (today's dollars)
  const retIncome = (s.retirementIncome ?? []).filter((x) => num(x.monthly) > 0);
  const retireIncomeAnnual = sum(retIncome.map((x) => num(x.monthly) * 12));
  const retireBridge = sum(retIncome.map((x) => num(x.monthly) * 12 * Math.max(0, num(x.startAge) - s.retireAge)));

  // Roth share of payroll 401(k), weighted by each job's contribution
  const prePerYear = incomes.map((i) => num(i.pretax) * PERIODS[i.freq]);
  const preTotal = sum(prePerYear);
  const rothShare = preTotal > 0 ? sum(incomes.map((i, k) => prePerYear[k]! * Math.min(1, Math.max(0, num(i.rothShare))))) / preTotal : 0;

  return {
    start: startDate,
    age: s.age,
    retireAge: s.retireAge,
    years,
    r: s.ret - s.fee + (w.retDelta || 0),
    vol: s.vol,
    swr: s.swr,
    taxRate: s.taxRate,
    incomes,
    bal,
    invested,
    annualNet,
    avgMonthlyNet: annualNet / 12,
    leanMonthly,
    extraChecksPerYear: annualNet - leanMonthly * 12,
    annualPre,
    annualMatch,
    budgetTotal,
    debtMins,
    monthlyExpenses,
    retireMonthly,
    retireAnnual: retireMonthly * 12,
    emergencyMonths: monthlyExpenses > 0 ? bal.cash / monthlyExpenses : Infinity,
    essentialExpenses,
    runwayEssential: essentialExpenses > 0 ? bal.cash / essentialExpenses : Infinity,
    debtTotal: sum((s.debts ?? []).map((d) => d.balance)),
    matchLeftPerYear: sum(incomes.map((i) => i.gapMatch * PERIODS[i.freq])),
    retireIncomeAnnual,
    retireBridge,
    rothShare,
    hsaEmployerAnnual: sum(incomes.map((i) => Math.max(0, num(i.hsaEmployer)))),
  };
}
