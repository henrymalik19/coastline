/** The budget's categories with their on-screen names (shared by the Budget tab, registers and forms). */
import { budgetCategories, isHistoryTxn, isStartTxn, type BudgetCategory, type Txn } from "@coastfi/engine";
import { useMemo } from "react";
import { debtLabel } from "./debts";
import { usePlan } from "./plan";
import { isCard } from "./register";
import { monthKey } from "./store";

export type NamedCategory = BudgetCategory & { label: string };

export function useCategories(month?: string): NamedCategory[] {
  const { state, result, actual, start } = usePlan();
  const m = month ?? monthKey(start);
  return useMemo(
    () =>
      budgetCategories(state, result.d, actual, start, m).map((c) => {
        const debt = c.key.startsWith("debt:") ? state.debts.find((y) => "debt:" + y.id === c.key) : undefined;
        return { ...c, label: debt ? (isCard(debt) ? `${debtLabel(debt)} payment` : debtLabel(debt)) : c.name };
      }),
    [state, result, actual, start, m],
  );
}

/** "Groceries", "Unassigned", "Transfer", or "Split (3)" for a transaction's category. */
export function categoryText(
  cats: NamedCategory[],
  t: { id?: string; categoryId?: string; splits?: unknown[]; transferAccountId?: string; amount: number; date?: string },
  accountName: (id: string) => string,
  /** Older than this, a missing category is just history ("No category"), not a to-do. */
  since?: string,
): string {
  if (t.splits?.length) return `Split (${t.splits.length})`;
  if (t.id && isStartTxn({ id: t.id })) return t.amount < 0 && !t.categoryId ? "Starting balance (owed)" : "Starting balance";
  // a withdrawal from an IRA or brokerage account: money in, Unassigned
  // to or from an IRA or brokerage with no category: out of / into Unassigned (older transfers carry the account's old line)
  if ((t.categoryId === "ready" || t.categoryId?.startsWith("acct:")) && t.transferAccountId)
    return t.amount < 0
      ? `Transfer · ${accountName(t.transferAccountId)} (from Unassigned)`
      : `Withdrawal · ${accountName(t.transferAccountId)} (Unassigned)`;
  if (t.categoryId === "ready") return "Unassigned";
  const c = t.categoryId ? cats.find((x) => x.key === t.categoryId)?.label : undefined;
  if (t.transferAccountId) return `Transfer · ${accountName(t.transferAccountId)}${c ? ` (${c})` : ""}`;
  return c ?? (since && t.date && t.date < since ? "No category" : "Needs a category");
}

/**
 * Only recent transactions are asked for a category: this month and last. Older months are closed, so an
 * old one without a category (from a long import, say) is history, not a to-do.
 */
export function needsCategorySince(start: Date): string {
  const d = new Date(start.getFullYear(), start.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

/**
 * A transaction that still needs a category: money in or out with none (a transfer between your own
 * accounts and an account's starting balance don't need one), or a split with a line that has none.
 * With `since`, only transactions on or after that day count.
 */
export function needsCategory(t: Pick<Txn, "id" | "categoryId" | "transferAccountId" | "splits" | "deleted" | "date">, since?: string): boolean {
  // one held for review isn't asked for a category until it's accepted
  if (t.deleted || isStartTxn(t) || (t as { review?: boolean }).review || isHistoryTxn(t as { accountId?: string })) return false;
  if (since && t.date < since) return false;
  if (t.splits?.length) return t.splits.some((s) => !s.categoryId);
  return !t.categoryId && !t.transferAccountId;
}

/** Today as "YYYY-MM-DD" (local). */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
