/**
 * The plan as database rows, and back (supabase/migrations/20261113120000_split_plan_tables.sql).
 *
 * The app works with one PlanState object; the database keeps it as a `plan` row (settings as
 * columns) and a table per list. planToRows / rowsToPlan turn one into the other, and diffRows says
 * which rows a save has to write or remove. Lists keep their order in `sort`. A value the plan
 * doesn't have is null in the database and missing (not undefined) in the plan.
 *
 * Contribution limits aren't part of a plan: everyone shares one table of them (the app fills
 * `limits` in from it).
 */
import type * as Engine from "@coastfi/engine";

type Row = Record<string, unknown>;
type Obj = Record<string, unknown>;

/** The tables a plan is made of, and the columns that identify a row in each (see plan_tables() in SQL). */
export const PLAN_TABLES = {
  account: ["id"],
  debt: ["id"],
  income: ["id"],
  income_deduction: ["income_id", "id"],
  category: ["id"],
  goal: ["id"],
  retirement_income: ["id"],
  adjustment: ["id"],
  property: ["id"],
  step_split: ["step"],
  schedule_entry: ["key", "sort"],
  month_amount: ["source", "key", "month"],
  budget_assignment: ["month", "key"],
  todo_done: ["month", "item"],
} as const;
export type PlanTable = keyof typeof PLAN_TABLES;
export type PlanRows = { plan: Row; tables: Record<PlanTable, Row[]> };

/** [field in the plan, column] */
type Field = readonly [string, string];
const snake = (s: string) => s.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
const auto = (...names: string[]): Field[] => names.map((n) => [n, snake(n)] as const);

const out = (o: Obj | undefined, fields: Field[]): Row => {
  const r: Row = {};
  for (const [f, c] of fields) r[c] = o?.[f] ?? null;
  return r;
};
const back = (r: Row, fields: Field[]): Obj => {
  const o: Obj = {};
  for (const [f, c] of fields) if (r[c] !== null && r[c] !== undefined) o[f] = r[c];
  return o;
};
const bySort = (a: Row, b: Row) => Number(a.sort) - Number(b.sort);
const entries = <T>(rec: Record<string, T> | undefined) => Object.entries(rec ?? {});

/* ---------- each table's columns ---------- */
const ACCOUNT = auto("id", "name", "type", "balance", "plaidAccountId", "counts", "owner");
const DEBT = auto("id", "name", "kind", "balance", "apr", "minPayment", "plaidAccountId", "promoApr", "promoUntil", "minimumOnly", "escrow", "term", "firstPayment", "original", "payroll", "budgetGroup");
const INCOME = auto(
  "id", "name", "kind", "freq", "net", "nextPayday", "matchMode", "gross", "contribPct", "matchRate1", "matchUpTo1", "matchRate2", "matchUpTo2",
  "pretax", "match", "fullMatch", "netMode", "rothShare", "hsaEmployer", "hsaEmployerMonth", "hsaPre",
);
const TAXES: Field[] = [["federal", "tax_federal"], ["state", "tax_state"], ["socialSecurity", "tax_social_security"], ["medicare", "tax_medicare"]];
const DEDUCTION = auto("id", "kind", "amount", "debtId");
const CATEGORY: Field[] = [...auto("id", "name", "amount", "inRetirement"), ["group", "group_name"], ...auto("essential", "noSuggest", "accountId")];
const GOAL = auto("id", "name", "target", "saved", "budgetGroup");
const RECURRING: Field[] = [["every", "every_months"], ["due", "due"], ["inRetirement", "in_retirement"], ["paidThrough", "paid_through"]];
const RETIREMENT_INCOME = auto("id", "name", "kind", "monthly", "startAge");
const ADJUSTMENT = auto("id", "month", "kind", "amount", "note");
const PROPERTY = auto("id", "name", "kind", "value", "mortgageId", "incomeId", "taxInsurance", "upkeep");

/* ---------- the plan row's columns ---------- */
const TOP = auto("version", "age", "retireAge", "healthcare", "medicare", "currentInvestMonthly", "ret", "vol", "fee", "swr", "taxRate", "contribGrowth", "filingStatus");
const SETTINGS: Field[] = [
  ["steps", "steps"], ["starterEF", "starter_ef"], ["starterEFMonths", "starter_ef_months"], ["efMonths", "ef_months"], ["highApr", "high_apr"],
  ["marginalTax", "marginal_tax"], ["marginalTaxManual", "marginal_tax_manual"], ["hsaEligible", "hsa_eligible"], ["hsaFamily", "hsa_family"],
  ["projectWith", "project_with"], ["payrollSteps", "payroll_steps"], ["hsaPayroll", "hsa_payroll"],
];
const WHATIF: Field[] = [["extra", "whatif_extra"], ["retDelta", "whatif_ret_delta"], ["spendDelta", "whatif_spend_delta"]];
const SPOUSE: Field[] = [["name", "spouse_name"], ["age", "spouse_age"]];
const EMERGENCY: Field[] = [["active", "emergency_active"], ["until", "emergency_until"], ["essentialsOnly", "emergency_essentials_only"], ["pause401k", "emergency_pause_401k"]];
const CONTRIBUTED: Field[] = [["year", "contributed_year"], ["k401", "contributed_k401"], ["ira", "contributed_ira"], ["hsa", "contributed_hsa"], ["iraSpouse", "contributed_ira_spouse"]];
const BUDGET: Field[] = [["start", "budget_start"], ["startCash", "budget_start_cash"]];
const EF_LINE: Field[] = [["name", "ef_name"], ["group", "ef_group"]];

/** Every column of the plan row the app owns (the rest are the server's: id, owner, timestamps). */
export const PLAN_COLUMNS = [...TOP, ...SETTINGS, ...WHATIF, ...SPOUSE, ...EMERGENCY, ...CONTRIBUTED, ...BUDGET, ...EF_LINE].map(([, c]) => c).concat(["ef_line", "onboarded"]);

/**
 * Homes and rentals as properties. Before properties existed, a home was an account of type
 * "property" (a rental income made one as "prop-<income id>", its mortgage as "mort-<income id>"),
 * and a rental's mortgage said "rental". Those become properties linked to their mortgage and rent.
 */
export function withProperties(s: Engine.PlanState): Engine.PlanState {
  const old = s.accounts.filter((a) => a.type === "property");
  if (!old.length && !s.debts.some((d) => d.rental)) return s;
  let props: Engine.Property[] = [...(s.properties ?? [])];
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  for (const a of old) {
    if (props.some((p) => p.id === a.id)) continue;
    const incomeId = s.incomes.find((i) => a.id === "prop-" + i.id)?.id;
    const mortgage = s.debts.find((d) => !!incomeId && d.id === "mort-" + incomeId) ?? s.debts.find((d) => d.kind === "mortgage" && same(d.name, a.name));
    props.push({
      id: a.id, name: a.name, kind: mortgage?.rental ? "rental" : "home", value: a.balance,
      ...(mortgage ? { mortgageId: mortgage.id } : {}), ...(incomeId ? { incomeId } : {}),
      ...(a.homeCosts ? { taxInsurance: a.homeCosts } : {}), ...(a.upkeep ? { upkeep: a.upkeep } : {}),
    });
  }
  for (const d of s.debts.filter((x) => x.rental)) {
    if (props.some((p) => p.mortgageId === d.id)) props = props.map((p) => (p.mortgageId === d.id ? { ...p, kind: "rental" } : p));
    else props.push({ id: "prop-" + d.id, name: d.name, kind: "rental", value: 0, mortgageId: d.id });
  }
  return {
    ...s,
    accounts: s.accounts.filter((a) => a.type !== "property"),
    debts: s.debts.map(({ rental: _r, ...d }) => d),
    properties: props,
  };
}

export function planToRows(input: Engine.PlanState, todoDone: Record<string, string[]> = {}, onboarded = true): PlanRows {
  const s = withProperties(input);
  const b = s.budgetPlan;
  const p = s.plan;
  const plan: Row = {
    ...out(s as unknown as Obj, TOP),
    ...out(p as unknown as Obj, SETTINGS),
    ...out(s.whatif as unknown as Obj, WHATIF),
    ...out(s.spouse as unknown as Obj, SPOUSE),
    ...out(s.emergency as unknown as Obj, EMERGENCY),
    ...out(s.contributed as unknown as Obj, CONTRIBUTED),
    ...out(b as unknown as Obj, BUDGET),
    ...out(b?.efLine as Obj | undefined, EF_LINE),
    ef_line: b?.efLine ? true : null,
    onboarded,
  };
  const t: Record<PlanTable, Row[]> = {
    account: s.accounts.map((a, i) => ({ ...out(a as unknown as Obj, ACCOUNT), sort: i })),
    debt: s.debts.map((d, i) => ({ ...out(d as unknown as Obj, DEBT), sort: i })),
    income: s.incomes.map((x, i) => ({ ...out(x as unknown as Obj, INCOME), ...out(x.taxes as Obj | undefined, TAXES), has_deductions: x.deductions ? true : null, sort: i })),
    income_deduction: s.incomes.flatMap((x) => (x.deductions ?? []).map((d, i) => ({ ...out(d as unknown as Obj, DEDUCTION), income_id: x.id, sort: i }))),
    category: s.budget.map((x, i) => ({ ...out(x as unknown as Obj, CATEGORY), sort: i })),
    goal: s.goals.map((g, i) => ({ ...out(g as unknown as Obj, GOAL), ...out(g.recurring as Obj | undefined, RECURRING), sort: i })),
    retirement_income: (s.retirementIncome ?? []).map((x, i) => ({ ...out(x as unknown as Obj, RETIREMENT_INCOME), sort: i })),
    adjustment: (s.adjustments ?? []).map((x, i) => ({ ...out(x as unknown as Obj, ADJUSTMENT), sort: i })),
    property: (s.properties ?? []).map((x, i) => ({ ...out(x as unknown as Obj, PROPERTY), sort: i })),
    step_split: [...new Set([...Object.keys(p.shares ?? {}), ...Object.keys(p.amounts ?? {})])].map((step) => ({ step, share: p.shares?.[step] ?? null, amount: p.amounts?.[step] ?? null })),
    schedule_entry: entries(p.schedule).flatMap(([key, list]) => list.map((e, i) => ({ key, sort: i, from_month: e.from, amount: e.amount, pct: e.pct ?? null }))),
    month_amount: [
      ...entries(p.scheduleMonths).flatMap(([key, m]) => entries(m).map(([month, amount]) => ({ source: "schedule", key, month, amount }))),
      ...entries(p.amountsBy).flatMap(([key, m]) => entries(m).map(([month, amount]) => ({ source: "step", key, month, amount }))),
    ],
    budget_assignment: entries(b?.months).flatMap(([month, e]) => entries(e.assigned).map(([key, assigned]) => ({ month, key, assigned }))),
    todo_done: entries(todoDone).flatMap(([month, items]) => items.map((item, i) => ({ month, item, sort: i }))),
  };
  return { plan, tables: t };
}

/** The pieces of a plan (one object per key) from rows, or undefined when nothing's there. */
const nonEmpty = (o: Obj) => (Object.keys(o).length ? o : undefined);
const set = (o: Obj, k: string, v: unknown) => {
  if (v !== undefined) o[k] = v;
};

export function rowsToPlan(rows: PlanRows): { plan: Engine.PlanState; todoDone: Record<string, string[]>; onboarded: boolean } {
  const r = rows.plan;
  const t = rows.tables;
  const sorted = (name: PlanTable) => [...(t[name] ?? [])].sort(bySort);

  const settings = back(r, SETTINGS);
  const shares: Obj = {};
  const amounts: Obj = {};
  for (const x of t.step_split ?? []) {
    if (x.share !== null && x.share !== undefined) shares[x.step as string] = x.share;
    if (x.amount !== null && x.amount !== undefined) amounts[x.step as string] = x.amount;
  }
  set(settings, "shares", nonEmpty(shares));
  set(settings, "amounts", nonEmpty(amounts));
  const schedule: Record<string, Obj[]> = {};
  for (const x of sorted("schedule_entry")) (schedule[x.key as string] ??= []).push(back(x, [["from", "from_month"], ["amount", "amount"], ["pct", "pct"]]));
  set(settings, "schedule", nonEmpty(schedule));
  const months = (source: string) => {
    const m: Record<string, Obj> = {};
    for (const x of t.month_amount ?? []) if (x.source === source) (m[x.key as string] ??= {})[x.month as string] = x.amount;
    return nonEmpty(m);
  };
  set(settings, "scheduleMonths", months("schedule"));
  set(settings, "amountsBy", months("step"));

  const plan: Obj = {
    ...back(r, TOP),
    incomes: sorted("income").map((x) => {
      const inc = back(x, INCOME);
      set(inc, "taxes", nonEmpty(back(x, TAXES)));
      if (x.has_deductions) inc.deductions = [...(t.income_deduction ?? [])].filter((d) => d.income_id === x.id).sort(bySort).map((d) => back(d, DEDUCTION));
      return inc;
    }),
    budget: sorted("category").map((x) => back(x, CATEGORY)),
    accounts: sorted("account").map((x) => back(x, ACCOUNT)),
    debts: sorted("debt").map((x) => back(x, DEBT)),
    goals: sorted("goal").map((x) => {
      const g = back(x, GOAL);
      if (x.every_months !== null && x.every_months !== undefined) g.recurring = back(x, RECURRING);
      return g;
    }),
    // filled in by the app from the shared contribution limits
    limits: [],
    plan: settings,
    whatif: back(r, WHATIF),
  };
  set(plan, "adjustments", t.adjustment?.length ? sorted("adjustment").map((x) => back(x, ADJUSTMENT)) : undefined);
  set(plan, "properties", t.property?.length ? sorted("property").map((x) => back(x, PROPERTY)) : undefined);
  set(plan, "retirementIncome", t.retirement_income?.length ? sorted("retirement_income").map((x) => back(x, RETIREMENT_INCOME)) : undefined);
  if (r.spouse_name !== null && r.spouse_name !== undefined) plan.spouse = back(r, SPOUSE);
  if (r.emergency_active !== null && r.emergency_active !== undefined) plan.emergency = back(r, EMERGENCY);
  if (r.contributed_year !== null && r.contributed_year !== undefined) plan.contributed = back(r, CONTRIBUTED);
  if (r.budget_start !== null && r.budget_start !== undefined) {
    const bp = back(r, BUDGET);
    const m: Record<string, { assigned: Obj }> = {};
    for (const x of t.budget_assignment ?? []) (m[x.month as string] ??= { assigned: {} }).assigned[x.key as string] = x.assigned;
    bp.months = m;
    if (r.ef_line) bp.efLine = back(r, EF_LINE);
    plan.budgetPlan = bp;
  }

  const todoDone: Record<string, string[]> = {};
  for (const x of sorted("todo_done")) (todoDone[x.month as string] ??= []).push(x.item as string);
  return { plan: plan as unknown as Engine.PlanState, todoDone, onboarded: !!r.onboarded };
}

/** A row's identity in its table. */
const keyOf = (table: PlanTable, row: Row) => PLAN_TABLES[table].map((k) => String(row[k])).join("\u0000");
const same = (a: Row, b: Row) => Object.keys({ ...a, ...b }).every((k) => JSON.stringify(a[k] ?? null) === JSON.stringify(b[k] ?? null));

export type PlanChanges = Partial<Record<PlanTable, { upsert: Row[]; delete: Row[] }>>;

/** What a save has to write: rows that are new or changed, and the keys of rows that are gone. */
export function diffRows(base: PlanRows | undefined, cur: PlanRows): PlanChanges {
  const changes: PlanChanges = {};
  for (const table of Object.keys(PLAN_TABLES) as PlanTable[]) {
    const before = new Map((base?.tables[table] ?? []).map((r) => [keyOf(table, r), r]));
    const now = new Map(cur.tables[table].map((r) => [keyOf(table, r), r]));
    const upsert = [...now].filter(([k, r]) => !before.has(k) || !same(before.get(k)!, r)).map(([, r]) => r);
    const gone = [...before].filter(([k]) => !now.has(k)).map(([, r]) => Object.fromEntries(PLAN_TABLES[table].map((k) => [k, r[k]])));
    if (upsert.length || gone.length) changes[table] = { upsert, delete: gone };
  }
  return changes;
}
