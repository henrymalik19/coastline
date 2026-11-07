/**
 * Plan-state types (PLAN.md §4.1). Percentages are decimals (0.05 = 5%).
 * All money is in today's dollars; returns are real (after inflation).
 * The Zod schemas in @coastfi/schema are checked against these at compile time.
 */

export type PayFreq = "weekly" | "biweekly" | "semimonthly" | "monthly";
/** What kind of income this is. Display only; the math is the same (non-jobs have no 401(k)). */
export type IncomeKind = "job" | "business" | "rental" | "other";

export type Income = {
  id: string;
  name: string;
  /** Defaults to "job" when missing (older plans). */
  kind?: IncomeKind;
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
  /**
   * How take-home (`net`) is set for a job: "auto" = gross − 401(k) − taxes − deductions
   * (computed in the app), "manual" = typed from a pay stub. Missing = manual.
   */
  netMode?: "auto" | "manual";
  /** Taxes withheld per check, from a pay stub (auto mode). */
  taxes?: PayTaxes;
  /** Other paycheck deductions, per check (auto mode). */
  deductions?: PayDeduction[];
  /** Share of your own 401(k) contributions that go to Roth (0–1). Missing = 0 (all pre-tax). */
  rothShare?: number;
  /** What your employer puts in your HSA, per year. Counts toward the HSA limit. */
  hsaEmployer?: number;
  /** What you put in your HSA from each paycheck (pre-tax). Already out of take-home; counts toward the HSA limit. */
  hsaPre?: number;
};

export type PayTaxes = { federal: number; state: number; socialSecurity: number; medicare: number };

export type PayDeductionKind = "health" | "dentalVision" | "lifeDisability" | "union" | "k401_loan" | "other";
export type PayDeduction = {
  id: string;
  kind: PayDeductionKind;
  amount: number;
  /** For a 401(k) loan repayment: the debt it pays. The debt carries the payment; take-home ignores it. */
  debtId?: string;
};

export type BudgetItem = {
  id: string;
  name: string;
  amount: number;
  inRetirement: boolean;
  /** Category the item is shown under ("Housing", "Food"…). Display only. */
  group?: string;
  /** Kept when emergency mode cuts spending to essentials. Missing = essential (nothing is cut by surprise). */
  essential?: boolean;
  /** The user dismissed the app's suggestion for this item (better group / make it a goal). Display only. */
  noSuggest?: boolean;
};
/** "property": what a home or rental is worth. Counts in net worth, not as invested money for Coast FI. */
export type AccountType = "pretax" | "roth" | "taxable" | "hsa" | "cash" | "property";
/** Which plan account a balance belongs to (the plan adds to 401(k), IRA, HSA and brokerage). */
export type PlanAccount = "k401" | "ira" | "hsa" | "taxable" | "other";
export type Account = {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  plaidAccountId?: string;
  /** What this account counts as in the plan. Missing = guessed from the name and type. */
  counts?: PlanAccount;
};
/** What kind of debt this is. Display only; payoff math is the same for every kind. */
export type DebtKind = "credit_card" | "car" | "student" | "mortgage" | "personal" | "medical" | "k401_loan" | "other";
export type Debt = {
  id: string;
  /** Optional description ("Chase Sapphire"); the UI falls back to the kind's label. */
  name: string;
  kind?: DebtKind;
  balance: number;
  apr: number;
  minPayment: number;
  plaidAccountId?: string;
  /** Intro/promo rate (e.g. 0% balance transfer) charged through `promoUntil`; `apr` applies after. */
  promoApr?: number;
  /** Last month of the promo rate, "YYYY-MM". */
  promoUntil?: string;
  /** Pay only the minimum, never extra (e.g. federal student loans on income-driven repayment or PSLF). */
  minimumOnly?: boolean;
  /**
   * Repaid by a paycheck deduction (a 401(k) loan): the payment is already out of take-home,
   * so it lowers the balance without coming out of the budget.
   */
  payroll?: boolean;
  /** Budget group the payment is listed under (display only; missing = "Debt payments"). */
  budgetGroup?: string;
};

/** Money that starts coming in after you stop working (today's dollars, per month). */
export type RetirementIncomeKind = "socialSecurity" | "pension" | "other";
export type RetirementIncome = {
  id: string;
  name: string;
  kind: RetirementIncomeKind;
  /** Per month, in today's dollars. */
  monthly: number;
  /** Age it starts. */
  startAge: number;
};
/**
 * A savings goal. One-time goals are a step in the plan. Recurring goals (holidays, yearly
 * insurance) are set aside every month like a bill, spent when due, then start again.
 */
export type Goal = {
  id: string;
  name: string;
  target: number;
  saved: number;
  recurring?: RecurringGoal;
  /** Budget group a recurring goal's set-aside is listed under (display only; missing = "Set aside"). */
  budgetGroup?: string;
};
export type RecurringGoal = {
  /** Months between due dates (12 = yearly, 6, 3). */
  every: number;
  /** Next due month, "YYYY-MM". */
  due: string;
  /** Keeps happening after you retire (adds to retirement spending). Missing = yes. */
  inRetirement?: boolean;
  /** Last month already set aside ("YYYY-MM"): the plan sets nothing aside through it. */
  paidThrough?: string;
};
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
  /** True = `marginalTax` was typed by the user. Missing/false = the app estimates it from income. */
  marginalTaxManual?: boolean;
  hsaEligible: boolean;
  hsaFamily: boolean;
  projectWith: ProjectWith;
  /**
   * 401(k) (and payroll HSA) steps work like a paycheck: a steady amount per check, never more than
   * the yearly limit ÷ paychecks per year, so a step starting late in the year doesn't get a lump sum.
   * Missing = lump sums allowed (original behavior).
   */
  payrollSteps?: boolean;
  /** The HSA step is paid from paychecks (pre-tax, steady per check, no prior-year deposits). Needs payrollSteps. */
  hsaPayroll?: boolean;
  /**
   * Share of what's left each month that a step gets while it's running (0–1, by step key); the rest
   * goes on to the steps after it at the same time. Missing = 1 (one step at a time).
   */
  shares?: Record<string, number>;
  /**
   * Your monthly plan for a step (dollars, by step key): each month it gets this much first, before the
   * other steps (if there is that much left after the budget), and no more. Missing = no set amount.
   */
  amounts?: Record<string, number>;
  /**
   * Months changed by hand: by step key, then "YYYY-MM" → dollars. That month the step gets this amount
   * first (if there is that much left after the budget), before the other steps.
   */
  amountsBy?: Record<string, Record<string, number>>;
};

export type WhatIf = { extra: number; retDelta: number; spendDelta: number };

/** One-off change to a single month: an unexpected bill, lost pay, or a bonus. */
export type AdjustmentKind = "expense" | "incomeLoss" | "incomeGain";
export type Adjustment = {
  id: string;
  /** "YYYY-MM" */
  month: string;
  kind: AdjustmentKind;
  /** Positive dollars; the kind says which way it goes. */
  amount: number;
  note: string;
};

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
  /** One-off month changes (optional; missing = none). */
  adjustments?: Adjustment[];
  /** Emergency mode (optional; missing or inactive = normal plan). */
  emergency?: EmergencyMode;
  /** Tax filing status, used for paycheck tax estimates. Missing = single. */
  filingStatus?: FilingStatus;
  /** Social Security, pensions and other income in retirement (optional; missing = none). */
  retirementIncome?: RetirementIncome[];
  /**
   * What you've already put in this tax year (from statements / pay stub). When set, the plan uses
   * the exact room left (no guessing by months left) and lets IRA/HSA room for last year be filled
   * January through April (the April 15 deadline).
   */
  contributed?: Contributed;
};

export type Contributed = {
  /** Tax year these amounts are for. */
  year: number;
  /** Your own 401(k) contributions so far (pay stub year-to-date). */
  k401: number;
  /** IRA contributions so far (traditional + Roth share one limit). */
  ira: number;
  /** HSA contributions so far, yours and your employer's. */
  hsa: number;
};

export type FilingStatus = "single" | "mfj" | "hoh";

/**
 * Emergency mode: from the start of the plan through `until` (inclusive), the waterfall is
 * paused and everything left over stays in cash. Debt minimums are still paid.
 */
export type EmergencyMode = {
  active: boolean;
  /** Last month in emergency mode, "YYYY-MM". */
  until: string;
  /** Spend only budget items marked essential during emergency months. */
  essentialsOnly: boolean;
  /** Stop payroll 401(k) contributions (they come back as take-home after tax; the match stops too). */
  pause401k: boolean;
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
  /** Monthly cost of essential budget items + debt minimums. */
  essentialExpenses: number;
  /** Months your cash would cover essentials with no income at all. */
  runwayEssential: number;
  debtTotal: number;
  matchLeftPerYear: number;
  /** Retirement income per year once it has all started (Social Security, pensions…). */
  retireIncomeAnnual: number;
  /** Savings needed to cover retirement income that starts after you retire, until it does. */
  retireBridge: number;
  /** Share of payroll 401(k) going to Roth, weighted across jobs (0–1). */
  rothShare: number;
  /** Employer HSA contributions per year, all jobs. */
  hsaEmployerAnnual: number;
  /** Recurring goals' average monthly set-aside (target ÷ months between due dates). */
  setAsideMonthly: number;
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
  /** Part of `payPre` that went to Roth 401(k) (after-tax). */
  payRoth: number;
  /** Employer HSA contribution this month. */
  payHsaEmployer: number;
  /** Your own payroll HSA contribution this month (from hsaPre, stopped at the limit). */
  payHsa: number;
  /** Set aside this month for recurring goals (included in `expenses`). */
  setAside: number;
  /** `setAside` per recurring goal, by goal id. */
  setAsideBy: Record<string, number>;
  /** Part of `alloc.ira` / `alloc.hsa` that counts toward last year (Jan–Apr, before the April 15 deadline). */
  priorIra: number;
  priorHsa: number;
  /** Scheduled payroll 401(k) not deferred because the annual limit was reached (pre-tax $). */
  payCut: number;
  /** One-off income change this month (+ bonus / − lost pay), already included in `income`. */
  adjIncome: number;
  /** One-off expenses this month, already included in `expenses`. */
  adjExpense: number;
  /** Money short this month (expenses beyond income). Covered from cash first, then `borrowed`. */
  shortfall: number;
  /** Part of the shortfall that cash couldn't cover, added to a credit card balance. */
  borrowed: number;
  /** This month is in emergency mode (waterfall paused, leftover kept as cash). */
  emergency: boolean;
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
  /** Estimated payroll 401(k)/HSA put in this year before the plan starts (when not entered). */
  ytdBefore?: { k401: number; hsa: number };
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
