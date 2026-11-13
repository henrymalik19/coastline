import { BASE_CHECKS, PERIODS } from "./constants";
import { resolveIncome } from "./match";
import type { Balances, Derived, PlanState, WhatIf } from "./types";
import { num, sum } from "./util";
import { isRentalDebt, isSpendingItem } from "./schedule";

/** Static summary of the inputs. `startDate` is injected; the engine never reads the clock. */
export function derive(s: PlanState, startDate: Date): Derived {
  const w: Partial<WhatIf> = s.whatif ?? {};
  const bal: Balances = { pretax: 0, roth: 0, taxable: 0, hsa: 0, cash: 0, property: 0 };
  for (const a of s.accounts ?? []) bal[a.type] = (bal[a.type] || 0) + num(a.balance);
  for (const p of s.properties ?? []) bal.property += num(p.value);
  // property (a home or rental) isn't invested money you can draw on, so Coast FI leaves it out
  const invested = bal.pretax + bal.roth + bal.taxable + bal.hsa;

  const incomes = (s.incomes ?? []).map(resolveIncome);
  const annualNet = sum(incomes.map((i) => num(i.net) * PERIODS[i.freq]));
  const leanMonthly = sum(incomes.map((i) => num(i.net) * BASE_CHECKS[i.freq]));
  const annualPre = sum(incomes.map((i) => num(i.pretax) * PERIODS[i.freq]));
  const annualMatch = sum(incomes.map((i) => num(i.match) * PERIODS[i.freq]));

  // money moved to an account (a "Roth IRA" category linked to it) is investing, not spending
  const budget = (s.budget ?? []).filter(isSpendingItem);
  const budgetTotal = sum(budget.map((b) => b.amount));
  // payroll-repaid debts (paycheck 401(k) loans) are already out of take-home, so they aren't budget costs
  // a paid-off mortgage's escrow (property tax + insurance) keeps going
  const escrowOf = (d: { escrow?: number; minPayment: number; payroll?: boolean }) => (d.payroll ? 0 : Math.min(Math.max(0, num(d.escrow)), num(d.minPayment)));
  const debtMins = sum((s.debts ?? []).filter((d) => !d.payroll).map((d) => (num(d.balance) > 0 ? d.minPayment : escrowOf(d))));
  // a rental's escrow is paid from its rent, so it isn't your spending in retirement
  const escrowMonthly = sum((s.debts ?? []).filter((d) => !isRentalDebt(s, d)).map(escrowOf));
  // recurring goals are set aside every month, like a bill
  const recurring = (s.goals ?? []).filter((g) => g.recurring && num(g.target) > 0 && num(g.recurring.every) > 0);
  const setAsideMonthly = sum(recurring.map((g) => num(g.target) / num(g.recurring!.every)));
  const setAsideRetired = sum(recurring.filter((g) => g.recurring!.inRetirement !== false).map((g) => num(g.target) / num(g.recurring!.every)));
  const monthlyExpenses = budgetTotal + debtMins + setAsideMonthly;
  // essentials: items not explicitly marked non-essential, plus debt minimums
  const essentialExpenses = sum(budget.filter((b) => b.essential !== false).map((b) => b.amount)) + debtMins + setAsideMonthly;

  // a home you own: property tax + insurance (when no mortgage escrow covers them) and upkeep
  const homeMonthly =
    sum((s.accounts ?? []).filter((a) => a.type === "property").map((a) => (Math.max(0, num(a.homeCosts)) + Math.max(0, num(a.balance)) * Math.max(0, num(a.upkeep))) / 12)) +
    sum((s.properties ?? []).filter((p) => p.kind !== "rental").map((p) => (Math.max(0, num(p.taxInsurance)) + Math.max(0, num(p.value)) * Math.max(0, num(p.upkeep))) / 12));
  // healthcare: your own insurance until Medicare at 65, then Medicare's cost; the difference until 65 is a bridge
  const healthRetired = s.medicare === undefined ? num(s.healthcare) : Math.max(0, num(s.medicare));
  const healthBridge = s.medicare === undefined ? 0 : Math.max(0, num(s.healthcare) - healthRetired) * 12 * Math.max(0, 65 - s.retireAge);
  const retireMonthly =
    (sum(budget.filter((b) => b.inRetirement).map((b) => b.amount)) + healthRetired + setAsideRetired + escrowMonthly + homeMonthly) * (1 + (w.spendDelta || 0));
  const years = Math.max(0, Math.round(s.retireAge - s.age));

  // income in retirement: the yearly total once everything has started, plus the savings
  // needed to cover whatever starts after you retire until it does (today's dollars)
  const retIncome = (s.retirementIncome ?? []).filter((x) => num(x.monthly) > 0);
  const retireIncomeAnnual = sum(retIncome.map((x) => num(x.monthly) * 12));
  const retireBridge = sum(retIncome.map((x) => num(x.monthly) * 12 * Math.max(0, num(x.startAge) - s.retireAge))) + healthBridge;

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
    setAsideMonthly,
    escrowMonthly,
    homeMonthly,
    healthRetired,
    healthBridge,
  };
}
