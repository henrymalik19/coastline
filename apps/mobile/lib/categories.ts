/** The budget's categories with their on-screen names (shared by the Budget tab, registers and forms). */
import { budgetCategories, type BudgetCategory } from "@coastfi/engine";
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

/** "Groceries", "Ready to assign", "Transfer", or "Split (3)" for a transaction's category. */
export function categoryText(cats: NamedCategory[], t: { categoryId?: string; splits?: unknown[]; transferAccountId?: string; amount: number }, accountName: (id: string) => string): string {
  if (t.splits?.length) return `Split (${t.splits.length})`;
  // a withdrawal from an IRA or brokerage account: money in, ready to assign
  // to or from an IRA or brokerage with no category: out of / into ready to assign (older transfers carry the account's old line)
  if ((t.categoryId === "ready" || t.categoryId?.startsWith("acct:")) && t.transferAccountId)
    return t.amount < 0
      ? `Transfer · ${accountName(t.transferAccountId)} (from ready to assign)`
      : `Withdrawal · ${accountName(t.transferAccountId)} (ready to assign)`;
  if (t.categoryId === "ready") return "Ready to assign";
  const c = t.categoryId ? cats.find((x) => x.key === t.categoryId)?.label : undefined;
  if (t.transferAccountId) return `Transfer · ${accountName(t.transferAccountId)}${c ? ` (${c})` : ""}`;
  return c ?? "Needs a category";
}

/** Today as "YYYY-MM-DD" (local). */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
