/**
 * The monthly (envelope) budget: every dollar you have gets a job. Money that comes in is ready to
 * assign; you assign it to categories; what you don't spend stays in its category and carries into
 * next month. Overspending a category is covered from ready to assign or another category; if it
 * isn't, it comes out of next month's ready to assign.
 *
 * Categories come from what the plan already knows, so nothing is entered twice:
 * - spending: each budget item (target = its monthly amount)
 * - bills: repeating savings goals (target = this month's set-aside)
 * - savings: each account the plan adds to and each one-time goal (target = your monthly amount, or
 *   what the plan gives it that month)
 * - debts: each debt you pay yourself (target = minimum + the plan's extra)
 */
import { accountForecasts } from "./forecast";
import { paysExtra, setAsideFor } from "./plan";
import { ACCOUNT_KEY, accountPlanKey, scheduleAmount } from "./schedule";
import type { BudgetState, Derived, PlanResult, PlanState, Txn } from "./types";
import { txnActivity } from "./txn";
import { addMonths, monthsBetween, num } from "./util";

export type BudgetCategoryKind = "spending" | "bill" | "saving" | "debt";

export type BudgetCategory = {
  /** Budget item id, `acct:<id>`, `goal:<id>` or `debt:<id>` (the same keys the plan uses). */
  key: string;
  group: string;
  name: string;
  kind: BudgetCategoryKind;
  /** What "Fill from plan" assigns this month. */
  target: number;
  /**
   * Assigned money leaves your budget accounts by itself: a transfer to an investment account, or a
   * debt payment. Until transactions exist, what's assigned counts as spent (you can change it).
   */
  moves: boolean;
};

export type BudgetLine = {
  key: string;
  assigned: number;
  /** Money out this month (positive = spent). */
  spent: number;
  /** Carried in from last month + assigned − spent. Negative = overspent. */
  available: number;
  carried: number;
  target: number;
  /** Credit-card spending moved into this card's payment category this month. */
  funded?: number;
};

export type BudgetView = {
  month: string;
  /** Before the budget started: nothing to show. */
  started: boolean;
  /** Income received this month (what you entered). */
  income: number;
  /** Money with no job yet, as of this month (assigning in later months lowers it too). */
  readyToAssign: number;
  assigned: number;
  spent: number;
  /** Overspending in earlier months that came out of ready to assign. */
  overspentBefore: number;
  /** Assigned in months after this one. */
  assignedLater: number;
  lines: Record<string, BudgetLine>;
};

const ymOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The categories for a month, with targets from the plan. `plan` should be the plan as you'll really do it. */
export function budgetCategories(s: PlanState, d: Derived, plan: PlanResult, start: Date, month: string): BudgetCategory[] {
  const out: BudgetCategory[] = [];
  const i = Math.max(0, monthsBetween(ymOf(start), month));
  const fc = accountForecasts(s, d, plan, d.r);
  const planned = (key: string) => {
    const f = fc.find((a) => a.key === key);
    return f ? (f.months[Math.min(i, f.months.length - 1)]?.plan ?? 0) : 0;
  };
  // spending: the budget
  for (const b of s.budget ?? []) out.push({ key: b.id, group: b.group?.trim() || "Other", name: b.name || "Budget item", kind: "spending", target: Math.max(0, num(b.amount)), moves: false });
  // bills: repeating goals
  for (const g of s.goals ?? [])
    if (g.recurring) out.push({ key: "goal:" + g.id, group: g.budgetGroup?.trim() || "Bills", name: g.name || "Bill", kind: "bill", target: setAsideFor(g, month), moves: false });
  // debts you pay yourself: the whole payment (minimum + extra)
  for (const x of s.debts ?? []) {
    if (x.payroll || !(num(x.balance) > 0)) continue;
    const extra = paysExtra(x) ? (scheduleAmount(s.plan, "debt:" + x.id, month) ?? planned("debt:" + x.id)) : 0;
    out.push({ key: "debt:" + x.id, group: x.budgetGroup?.trim() || "Debt payments", name: x.name || "Debt", kind: "debt", target: Math.max(0, num(x.minPayment)) + Math.max(0, extra), moves: true });
  }
  // savings: each account the plan adds to (the kind's plan amount goes to its first account), then goals
  const firstOfKind = new Set<string>();
  for (const a of s.accounts ?? []) {
    const kind = accountPlanKey(s, a);
    if (!kind) continue;
    const own = scheduleAmount(s.plan, ACCOUNT_KEY + a.id, month);
    const kindSet = scheduleAmount(s.plan, kind, month);
    let target: number;
    if (own !== undefined) target = own;
    else if (firstOfKind.has(kind)) target = 0;
    else {
      // the plan's amount for the kind, less what your other accounts of that kind have set
      const others = (s.accounts ?? []).filter((y) => y.id !== a.id && accountPlanKey(s, y) === kind).reduce((t, y) => t + (scheduleAmount(s.plan, ACCOUNT_KEY + y.id, month) ?? 0), 0);
      target = Math.max(0, (kindSet ?? planned(kind)) - others);
    }
    firstOfKind.add(kind);
    out.push({ key: ACCOUNT_KEY + a.id, group: "Savings", name: a.name || "Account", kind: "saving", target, moves: kind !== "cash" });
  }
  for (const g of s.goals ?? [])
    if (!g.recurring) out.push({ key: "goal:" + g.id, group: "Savings goals", name: g.name || "Goal", kind: "saving", target: scheduleAmount(s.plan, "goal:" + g.id, month) ?? planned("goal:" + g.id), moves: false });
  return out;
}

/**
 * The budget for one month: every category's assigned, spent and available (with carry-over), and
 * what's ready to assign. `cats` says which keys exist and which move money out by themselves.
 */
export function budgetView(
  b: BudgetState | undefined,
  cats: Pick<BudgetCategory, "key" | "moves" | "target">[],
  month: string,
  /** Transactions, and which accounts are credit cards (account id → its payment category). */
  tx?: { txns: Txn[]; cards: Record<string, string> },
): BudgetView {
  const empty: BudgetView = { month, started: false, income: 0, readyToAssign: 0, assigned: 0, spent: 0, overspentBefore: 0, assignedLater: 0, lines: {} };
  if (!b || month < b.start) {
    for (const c of cats) empty.lines[c.key] = { key: c.key, assigned: 0, spent: 0, available: 0, carried: 0, target: c.target };
    return empty;
  }
  const carry: Record<string, number> = {};
  let income = 0;
  let assigned = 0;
  let overspent = 0;
  let view: BudgetView | null = null;
  for (let m = b.start; m <= month; m = addMonths(m, 1)) {
    const e = b.months?.[m] ?? {};
    const act = tx ? txnActivity(tx.txns, m, tx.cards) : undefined;
    const lines: Record<string, BudgetLine> = {};
    let monthAssigned = 0;
    let monthSpent = 0;
    let monthOver = 0;
    for (const c of cats) {
      const a = Math.max(0, num(e.assigned?.[c.key]));
      // what went out: typed in by hand, else from transactions, else (money that moves by itself) what was assigned
      const fromTx = act?.spent[c.key];
      const cardIsTracked = !!tx && Object.values(tx.cards).includes(c.key);
      const sp =
        e.spent?.[c.key] !== undefined ? num(e.spent[c.key])
        : fromTx !== undefined ? fromTx
        : c.moves && !cardIsTracked ? a
        : 0;
      const funded = act?.cardFunded[c.key] ?? 0;
      const carried = carry[c.key] ?? 0;
      const available = carried + a + funded - sp;
      lines[c.key] = { key: c.key, assigned: a, spent: sp, available, carried, target: c.target, funded };
      monthAssigned += a;
      monthSpent += sp;
      if (available < 0) monthOver += -available;
      carry[c.key] = Math.max(0, available);
    }
    income += Math.max(0, num(e.income)) + (act?.income ?? 0);
    assigned += monthAssigned;
    if (m === month) {
      let later = 0;
      for (const [k, v] of Object.entries(b.months ?? {})) if (k > month) for (const x of Object.values(v.assigned ?? {})) later += Math.max(0, num(x));
      view = {
        month,
        started: true,
        income: Math.max(0, num(e.income)) + (act?.income ?? 0),
        readyToAssign: num(b.startCash) + income - assigned - overspent - later,
        assigned: monthAssigned,
        spent: monthSpent,
        overspentBefore: overspent,
        assignedLater: later,
        lines,
      };
    }
    // overspending not covered by the end of a month comes out of the next month's ready to assign
    overspent += monthOver;
  }
  return view ?? empty;
}
