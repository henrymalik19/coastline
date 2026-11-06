/**
 * Import JSON exported by the prototype (reference/index.html, localStorage keys
 * "coastfi.v1" / "coastfi.v2") into a validated PlanState plus check-ins.
 * Mirrors the prototype's own `migrate()`, then normalizes what the strict schema needs:
 * stable ids on budget/account rows, "" paydays dropped, check-ins split out.
 */
import { PERIODS, type PayFreq, type PlanState } from "@coastfi/engine";
import { z } from "zod";
import { defaultPlanState, PlanStateError, PlanStateSchema } from "./schemas";

export const CheckinSchema = z.object({
  /** "YYYY-MM" */
  month: z.string().regex(/^\d{4}-\d{2}$/),
  date: z.string().optional(),
  invested: z.number().finite(),
  cash: z.number().finite(),
  debt: z.number().finite(),
  netWorth: z.number().finite(),
  expectedNextInvested: z.number().finite(),
});
export type Checkin = z.infer<typeof CheckinSchema>;

export type ImportResult = { state: PlanState; checkins: Checkin[]; fromVersion: 1 | 2 };

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isObj) : []);

/** Defaults the prototype fills into every v2 income (matters for "% of pay" mode). */
const INCOME_DEFAULTS = { matchMode: "usd", gross: 0, contribPct: 0, matchRate1: 1, matchUpTo1: 0.03, matchRate2: 0, matchUpTo2: 0 };

function withIds(rows: Raw[], prefix: string): Raw[] {
  const used = new Set(rows.map((r) => r.id).filter((x): x is string => typeof x === "string" && x.length > 0));
  let n = 0;
  return rows.map((r) => {
    if (typeof r.id === "string" && r.id) return r;
    let id: string;
    do id = `${prefix}${++n}`; while (used.has(id));
    used.add(id);
    return { ...r, id };
  });
}

function fromV1(s: Raw): Raw {
  const m: Raw = { ...defaultPlanState() };
  for (const k of ["age", "retireAge", "healthcare", "ret", "vol", "fee", "swr", "taxRate", "contribGrowth", "budget", "accounts"]) {
    if (s[k] !== undefined) m[k] = s[k];
  }
  const freq = (typeof s.freq === "string" && s.freq in PERIODS ? s.freq : "biweekly") as PayFreq;
  const num = (v: unknown) => +(v as number) || 0;
  m.incomes = [
    {
      id: "inc1", name: "Main job", freq, net: num(s.netPerCheck), pretax: num(s.pretaxPerCheck), match: num(s.matchPerCheck),
      fullMatch: true, ...INCOME_DEFAULTS,
    },
  ];
  m.currentInvestMonthly = Math.round((num(s.afterTaxPerCheck) * PERIODS[freq]) / 12);
  m.debts = [];
  m.goals = [];
  return m;
}

function fromV2(s: Raw): Raw {
  const base = defaultPlanState();
  const m: Raw = { ...base, ...s };
  m.plan = { ...base.plan, ...(isObj(s.plan) ? s.plan : {}) };
  m.whatif = { ...base.whatif, ...(isObj(s.whatif) ? s.whatif : {}) };
  m.incomes = arr(m.incomes).map((i) => ({ ...INCOME_DEFAULTS, ...i }));
  return m;
}

export function importPrototypeJson(input: unknown): ImportResult {
  let raw: unknown = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new PlanStateError("That doesn't look like a valid export");
    }
  }
  if (!isObj(raw)) throw new PlanStateError("That doesn't look like a valid export");
  const fromVersion = raw.version === 2 ? 2 : 1;
  const m = fromVersion === 2 ? fromV2(raw) : fromV1(raw);

  const checkins = arr(m.checkins).map((c) => CheckinSchema.parse(c));
  delete m.checkins;
  delete m._updatedAt;

  m.version = 2;
  m.incomes = withIds(arr(m.incomes), "inc").map((i) => {
    const { nextPayday, ...rest } = i;
    return typeof nextPayday === "string" && nextPayday ? { ...rest, nextPayday } : rest;
  });
  m.budget = withIds(arr(m.budget), "b");
  m.accounts = withIds(arr(m.accounts), "a");
  m.debts = withIds(arr(m.debts), "d");
  m.goals = withIds(arr(m.goals), "g");
  // prototype's syncGoalSteps: drop steps for missing goals, add missing goals before "taxable"
  const plan = m.plan as Raw;
  const goalIds = (m.goals as Raw[]).map((g) => `goal:${String(g.id)}`);
  const steps = (Array.isArray(plan.steps) ? plan.steps : [])
    .filter((x): x is string => typeof x === "string")
    .filter((x) => !x.startsWith("goal:") || goalIds.includes(x));
  for (const id of goalIds) {
    if (steps.includes(id)) continue;
    const t = steps.indexOf("taxable");
    steps.splice(t < 0 ? steps.length : t, 0, id);
  }
  plan.steps = steps;

  const res = PlanStateSchema.safeParse(m);
  if (!res.success) throw new PlanStateError("Plan file failed validation", res.error.issues);
  return { state: res.data, checkins, fromVersion };
}
