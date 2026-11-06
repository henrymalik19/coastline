/**
 * @coastfi/schema: Zod schemas for the plan state (PLAN.md §4.1), shared by app and server.
 * Percentages are decimals (0.05 = 5%). The inferred types are checked against
 * @coastfi/engine's hand-written types at compile time (see bottom of file).
 */
import type * as Engine from "@coastfi/engine";
import { DEFAULT_LIMITS } from "@coastfi/engine";
import { z } from "zod";

const money = z.number().finite();
const nonNeg = z.number().finite().min(0);
const rate = z.number().finite();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const id = z.string().min(1);
const MONTH_RE = /^[0-9]{4}-[0-9]{2}$/;

export const PayFreqSchema = z.enum(["weekly", "biweekly", "semimonthly", "monthly"]);

export const IncomeKindSchema = z.enum(["job", "business", "rental", "other"]);

export const IncomeSchema = z.object({
  id,
  name: z.string(),
  kind: IncomeKindSchema.optional(),
  freq: PayFreqSchema,
  net: nonNeg,
  nextPayday: isoDate.optional(),
  matchMode: z.enum(["pct", "usd"]),
  gross: nonNeg.optional(),
  contribPct: rate.min(0).max(1).optional(),
  matchRate1: rate.min(0).optional(),
  matchUpTo1: rate.min(0).max(1).optional(),
  matchRate2: rate.min(0).optional(),
  matchUpTo2: rate.min(0).max(1).optional(),
  pretax: nonNeg.optional(),
  match: nonNeg.optional(),
  fullMatch: z.boolean().optional(),
});

export const BudgetItemSchema = z.object({ id, name: z.string(), amount: money, inRetirement: z.boolean(), group: z.string().optional(), essential: z.boolean().optional() });
export const AccountTypeSchema = z.enum(["pretax", "roth", "taxable", "hsa", "cash"]);
export const AccountSchema = z.object({
  id,
  name: z.string(),
  type: AccountTypeSchema,
  balance: money,
  plaidAccountId: z.string().optional(),
});
export const DebtKindSchema = z.enum(["credit_card", "car", "student", "mortgage", "personal", "medical", "other"]);
export const DebtSchema = z.object({
  id,
  name: z.string(),
  kind: DebtKindSchema.optional(),
  balance: nonNeg,
  apr: rate.min(0),
  minPayment: nonNeg,
  plaidAccountId: z.string().optional(),
});
export const GoalSchema = z.object({ id, name: z.string(), target: nonNeg, saved: nonNeg });
export const LimitsRowSchema = z.object({
  year: z.number().int(),
  k401: nonNeg,
  k401Catch: nonNeg,
  ira: nonNeg,
  iraCatch: nonNeg,
  hsaSelf: nonNeg,
  hsaFamily: nonNeg,
  hsaCatch: nonNeg,
});

export const BASE_STEP_KEYS = ["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "k401", "lowDebt", "taxable"] as const;
export const StepKeySchema = z.union([z.enum(BASE_STEP_KEYS), z.templateLiteral(["goal:", z.string()])]);

export const PlanSettingsSchema = z.object({
  steps: z.array(StepKeySchema),
  starterEF: nonNeg,
  efMonths: nonNeg,
  highApr: rate.min(0),
  marginalTax: rate.min(0).max(1),
  hsaEligible: z.boolean(),
  hsaFamily: z.boolean(),
  projectWith: z.enum(["plan", "current"]),
});

export const AdjustmentSchema = z.object({
  id,
  month: z.string().regex(/^\d{4}-\d{2}$/, "Use YYYY-MM"),
  kind: z.enum(["expense", "incomeLoss", "incomeGain"]),
  amount: nonNeg,
  note: z.string(),
});

export const EmergencyModeSchema = z.object({
  active: z.boolean(),
  until: z.string().regex(MONTH_RE, "Use YYYY-MM"),
  essentialsOnly: z.boolean(),
  pause401k: z.boolean(),
});

export const WhatIfSchema = z.object({ extra: money, retDelta: rate, spendDelta: rate });

export const PlanStateSchema = z.object({
  version: z.literal(2),
  age: z.number().min(0).max(120),
  retireAge: z.number().min(0).max(120),
  healthcare: nonNeg,
  currentInvestMonthly: nonNeg,
  incomes: z.array(IncomeSchema),
  budget: z.array(BudgetItemSchema),
  accounts: z.array(AccountSchema),
  debts: z.array(DebtSchema),
  goals: z.array(GoalSchema),
  limits: z.array(LimitsRowSchema),
  plan: PlanSettingsSchema,
  ret: rate,
  vol: rate.min(0),
  fee: rate.min(0),
  swr: rate.gt(0),
  taxRate: rate.min(0).lt(1),
  contribGrowth: rate,
  whatif: WhatIfSchema,
  adjustments: z.array(AdjustmentSchema).optional(),
  emergency: EmergencyModeSchema.optional(),
});

/** A monthly check-in (its own table in Phase 3). */
export const CheckinSchema = z.object({
  /** "YYYY-MM" */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  date: z.string().optional(),
  invested: z.number().finite(),
  cash: z.number().finite(),
  debt: z.number().finite(),
  netWorth: z.number().finite(),
  expectedNextInvested: z.number().finite(),
  /** Roughly what was spent that month (optional), compared with the budget. */
  spent: z.number().finite().min(0).optional(),
  /** The monthly budget when the check-in was logged, for the comparison. */
  budget: z.number().finite().min(0).optional(),
});
export type Checkin = z.infer<typeof CheckinSchema>;

export type PlanStateInput = z.input<typeof PlanStateSchema>;

/** Conservative defaults (PLAN.md §1): 5% real, 15% vol, 3.5% SWR, 0% real raises. */
export const DEFAULT_PLAN: Engine.PlanSettings = {
  steps: ["starterEF", "match", "highDebt", "fullEF", "hsa", "ira", "k401", "lowDebt", "taxable"],
  starterEF: 2000,
  efMonths: 3,
  highApr: 0.07,
  marginalTax: 0.22,
  hsaEligible: false,
  hsaFamily: false,
  projectWith: "plan",
};

export function defaultPlanState(): Engine.PlanState {
  return {
    version: 2,
    age: 30,
    retireAge: 60,
    healthcare: 0,
    currentInvestMonthly: 0,
    incomes: [],
    budget: [],
    accounts: [],
    debts: [],
    goals: [],
    limits: structuredClone(DEFAULT_LIMITS),
    plan: { ...DEFAULT_PLAN, steps: [...DEFAULT_PLAN.steps] },
    ret: 0.05,
    vol: 0.15,
    fee: 0,
    swr: 0.035,
    taxRate: 0.1,
    contribGrowth: 0,
    whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  };
}

export class PlanStateError extends Error {
  constructor(message: string, readonly issues?: z.core.$ZodIssue[]) {
    super(message);
    this.name = "PlanStateError";
  }
}

/**
 * Strictly parse a PlanState document (the app's own saves). For JSON exported by the
 * prototype (v1 or v2, ids missing, check-ins inline), use `importPrototypeJson`.
 */
export function parsePlanState(input: unknown): Engine.PlanState {
  const raw = typeof input === "string" ? (JSON.parse(input) as unknown) : input;
  if (!raw || typeof raw !== "object") throw new PlanStateError("Plan file is not a JSON object");
  const version = (raw as { version?: unknown }).version;
  if (version !== 2) throw new PlanStateError(`Unsupported plan version: ${String(version ?? "none")}`);
  const res = PlanStateSchema.safeParse(raw);
  if (!res.success) throw new PlanStateError("Plan file failed validation", res.error.issues);
  return res.data;
}

/* ---------- compile-time: Zod types === engine types ---------- */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
export type _SchemaMatchesEngine = [
  Assert<Equals<z.infer<typeof IncomeSchema>, Engine.Income>>,
  Assert<Equals<z.infer<typeof DebtSchema>, Engine.Debt>>,
  Assert<Equals<z.infer<typeof StepKeySchema>, Engine.StepKey>>,
  Assert<Equals<z.infer<typeof PlanSettingsSchema>, Engine.PlanSettings>>,
  Assert<Equals<z.infer<typeof PlanStateSchema>, Engine.PlanState>>,
];

