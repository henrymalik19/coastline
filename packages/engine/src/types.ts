/**
 * Plan-state types (PLAN.md §4.1). Percentages are decimals (0.05 = 5%).
 * All money is in today's dollars; returns are real (after inflation).
 * The Zod schemas in @coastfi/schema are checked against these at compile time.
 */

export type PayFreq = "weekly" | "biweekly" | "semimonthly" | "monthly";

export type Income = {
  id: string;
  name: string;
  freq: PayFreq;
  /** Take-home per check. */
  net: number;
  /** ISO date (YYYY-MM-DD); lets the engine find 3-/5-check months. */
  nextPayday?: string;
  matchMode: "pct" | "usd";
  // pct mode
  gross?: number;
  contribPct?: number;
  matchRate1?: number;
  matchUpTo1?: number;
  matchRate2?: number;
  matchUpTo2?: number;
  // usd mode
  pretax?: number;
  match?: number;
  fullMatch?: boolean;
};

export type BudgetItem = { id: string; name: string; amount: number; inRetirement: boolean };
export type AccountType = "pretax" | "roth" | "taxable" | "hsa" | "cash";
export type Account = { id: string; name: string; type: AccountType; balance: number; plaidAccountId?: string };
export type Debt = { id: string; name: string; balance: number; apr: number; minPayment: number; plaidAccountId?: string };
export type Goal = { id: string; name: string; target: number; saved: number };
export type LimitsRow = {
  year: number;
  k401: number;
  k401Catch: number;
  ira: number;
  iraCatch: number;
  hsaSelf: number;
  hsaFamily: number;
  hsaCatch: number;
};
export type Limits = Omit<LimitsRow, "year"> & { year?: number };

export type BaseStepKey = "starterEF" | "match" | "highDebt" | "fullEF" | "hsa" | "ira" | "k401" | "lowDebt" | "taxable";
export type StepKey = BaseStepKey | `goal:${string}`;
export type ProjectWith = "plan" | "current";

export type PlanSettings = {
  steps: StepKey[];
  starterEF: number;
  efMonths: number;
  highApr: number;
  marginalTax: number;
  hsaEligible: boolean;
  hsaFamily: boolean;
  projectWith: ProjectWith;
};

export type WhatIf = { extra: number; retDelta: number; spendDelta: number };

export type PlanState = {
  version: 2;
  age: number;
  retireAge: number;
  healthcare: number;
  currentInvestMonthly: number;
  incomes: Income[];
  budget: BudgetItem[];
  accounts: Account[];
  debts: Debt[];
  goals: Goal[];
  limits: LimitsRow[];
  plan: PlanSettings;
  ret: number;
  vol: number;
  fee: number;
  swr: number;
  taxRate: number;
  contribGrowth: number;
  whatif: WhatIf;
};

/* ---------- engine outputs ---------- */

export type ResolvedIncome = Income & {
  pretax: number;
  match: number;
  fullMatch: boolean;
  /** Extra pre-tax per check needed to reach the full match. */
  gapPre: number;
  /** Extra match per check you'd get at the full-match %. */
  gapMatch: number;
  /** Contribution % that captures the full match (pct mode only). */
  maxPct: number | null;
};

export type Balances = Record<AccountType, number>;

export type Derived = {
  start: Date;
  age: number;
  retireAge: number;
  years: number;
  r: number;
  vol: number;
  swr: number;
  taxRate: number;
  incomes: ResolvedIncome[];
  bal: Balances;
  invested: number;
  annualNet: number;
  avgMonthlyNet: number;
  leanMonthly: number;
  extraChecksPerYear: number;
  annualPre: number;
  annualMatch: number;
  budgetTotal: number;
  debtMins: number;
  monthlyExpenses: number;
  retireMonthly: number;
  retireAnnual: number;
  emergencyMonths: number;
  debtTotal: number;
  matchLeftPerYear: number;
};

export type Alloc = {
  /** Extra pre-tax 401(k) dollars from the waterfall (match + k401 steps). */
  k401: number;
  /** Take-home cost of `k401`. */
  k401TakeHome: number;
  /** Take-home spent by the k401 step only. */
  k401Step: number;
  matchGain: number;
  ira: number;
  taxable: number;
  ef: number;
  debt: number;
  hsa: number;
  goals: number;
  leftover: number;
};

export type MonthRow = {
  m: number;
  y: number;
  mo: number;
  income: number;
  checks: number[];
  extraCheck: boolean;
  expenses: number;
  minPay: number;
  payPre: number;
  payMatch: number;
  /** Scheduled payroll 401(k) not deferred because the annual limit was reached (pre-tax $). */
  payCut: number;
  shortfall: number;
  alloc: Alloc;
  cash: number;
  debtTotal: number;
  goals: { id: string; saved: number }[];
  /** Pre-tax dollars invested this month (payroll + match + waterfall 401(k)). */
  pre: number;
  /** Roth/taxable/HSA dollars invested this month. */
  post: number;
};

export type PlanEvent = { m: number; key: string; text: string };
export type FundKey = "hsa" | "ira" | "taxable" | "k401";

export type PlanResult = {
  months: MonthRow[];
  events: PlanEvent[];
  firstFund: Partial<Record<FundKey, number>>;
  maxedYears: { k401: number[]; ira: number[]; hsa: number[] };
  starterTarget: number;
  fullTarget: number;
  mode: ProjectWith;
};

export type SimulateOptions = { mode?: ProjectWith; extraMonthly?: number; months?: number };

export type Projection = { series: Float64Array; final: number; preShareFinal: number };

export type Band = { p10: number; p25: number; p50: number; p75: number; p90: number };
export type MonteCarloResult = { bands: Band[]; probFire: number; probCoastNow: number };
export type MonteCarloOptions = { sims?: number; seed?: number };

export type RunResult = {
  d: Derived;
  plan: PlanResult;
  fire: number;
  coastNow: number;
  /** Years from start until the projected balance reaches the coast number, or null. */
  crossing: number | null;
  rCons: number;
  fireC: number;
  crossingC: number | null;
  mc: MonteCarloResult;
  coastCurve: number[];
  preShareFinal: number;
  projectedFinal: number;
  projSeries: Float64Array;
  altFinal: number;
  altMode: ProjectWith;
  progress: number;
  progressFire: number;
  freedomDays: number;
  coastSoonerMonths: number | null;
  /** Month index when the deterministic path first reaches `target`, or null. */
  whenBalance: (target: number) => number | null;
  /** Month index when the path first reaches fraction `f` of the coast number, or null. */
  whenCoastPct: (f: number) => number | null;
};
