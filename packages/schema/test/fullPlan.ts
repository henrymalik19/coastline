import type { PlanState } from "@coastfi/engine";
import { defaultPlanState } from "../src";

/** A plan with every optional part filled in, so a field the rows forget shows up. */
export function fullPlan(): PlanState {
  const s = defaultPlanState();
  return {
    ...s,
    age: 34.5,
    retireAge: 60,
    healthcare: 3500,
    medicare: 800,
    currentInvestMonthly: 250,
    filingStatus: "mfj",
    spouse: { name: "Sam", age: 33 },
    incomes: [
      {
        id: "j1", name: "Hub", kind: "job", freq: "biweekly", net: 3100.55, nextPayday: "2026-11-14", matchMode: "pct", gross: 5000, contribPct: 0.06,
        matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0.5, matchUpTo2: 0.02, pretax: 300, match: 200, fullMatch: true, netMode: "auto",
        taxes: { federal: 500, state: 200, socialSecurity: 310, medicare: 72.5 },
        deductions: [{ id: "d1", kind: "health", amount: 120 }, { id: "d2", kind: "k401_loan", amount: 243.69, debtId: "loan" }],
        rothShare: 0.25, hsaEmployer: 500, hsaEmployerMonth: 1, hsaPre: 100,
      },
      { id: "j2", name: "Side", kind: "business", freq: "monthly", net: 800, matchMode: "usd", deductions: [] },
    ],
    budget: [
      { id: "food", name: "Groceries", amount: 900, inRetirement: true, group: "Food", essential: true },
      { id: "roth", name: "Roth IRA", amount: 500, inRetirement: false, group: "Savings", essential: false, noSuggest: true, accountId: "ira" },
    ],
    accounts: [
      { id: "ira", name: "Roth IRA", type: "roth", balance: 12000.12, counts: "ira", owner: "spouse", plaidAccountId: "p1" },
      { id: "chk", name: "Checking", type: "cash", balance: 13962.11 },
    ],
    debts: [
      { id: "m", name: "840 Madison", kind: "mortgage", balance: 366819.87, apr: 0.061, minPayment: 3572.77, minimumOnly: true, escrow: 1235, term: 360, firstPayment: "2023-04", original: 400000, budgetGroup: "Housing" },
      { id: "r", name: "710 Dillon", kind: "mortgage", balance: 175236.52, apr: 0.033, minPayment: 1147.19, plaidAccountId: "p2" },
      { id: "cc", name: "Visa", kind: "credit_card", balance: 3000, apr: 0.24, minPayment: 90, promoApr: 0, promoUntil: "2027-06" },
      { id: "loan", name: "401(k) loan", kind: "k401_loan", balance: 25305.25, apr: 0.078, minPayment: 528, payroll: true },
    ],
    goals: [
      { id: "car", name: "Car", target: 20000, saved: 2500 },
      { id: "ins", name: "Car insurance", target: 1200, saved: 300, recurring: { every: 6, due: "2027-03", inRetirement: false, paidThrough: "2026-09" }, budgetGroup: "Bills" },
    ],
    plan: {
      ...s.plan,
      starterEFMonths: 2,
      marginalTaxManual: true,
      payrollSteps: true,
      hsaPayroll: false,
      steps: ["starterEF", "match", "goal:car", "fullEF", "taxable"],
      shares: { fullEF: 0.5 },
      amounts: { ira: 583, "goal:car": 300 },
      amountsBy: { ira: { "2026-12": 700 } },
      schedule: { cash: [{ from: "2026-11", amount: 500 }, { from: "2027-06", amount: 0, pct: 0.1 }], "debt:cc": [{ from: "2026-11", amount: 200 }] },
      scheduleMonths: { cash: { "2027-01": 1000, "2027-02": 0 } },
    },
    whatif: { extra: 100, retDelta: -0.01, spendDelta: 0.1 },
    properties: [
      { id: "h", name: "840 Madison", kind: "home", value: 520000, mortgageId: "m", upkeep: 0.01 },
      { id: "rp", name: "710 Dillon", kind: "rental", value: 310000.5, mortgageId: "r", incomeId: "j2", taxInsurance: 4200 },
    ],
    adjustments: [{ id: "a1", month: "2027-05", kind: "expense", amount: 4000, note: "Roof" }],
    emergency: { active: true, until: "2027-02", essentialsOnly: true, pause401k: false },
    retirementIncome: [{ id: "ss", name: "Social Security", kind: "socialSecurity", monthly: 2400, startAge: 67 }],
    contributed: { year: 2026, k401: 18000, ira: 3000, hsa: 1000, iraSpouse: 500 },
    budgetPlan: {
      start: "2026-09",
      startCash: 13000.5,
      months: {
        "2026-09": { assigned: { food: 900, cash: 500 } },
        "2026-10": { assigned: { food: 900.5 } },
      },
      efLine: { name: "Rainy day", group: "Savings" },
    },
  };
}

/** The same plan with empty lists and objects left out (the database can't tell [] from none). */
export const canon = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const c = canon(x);
      if (c === undefined || (Array.isArray(c) && !c.length) || (c && typeof c === "object" && !Array.isArray(c) && !Object.keys(c).length)) continue;
      o[k] = c;
    }
    return o;
  }
  return v;
};

