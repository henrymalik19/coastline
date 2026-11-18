/**
 * Archived categories that belong under one you use: their transactions went to the same places (Kroger
 * and Aldi → Groceries). Put under it as an archived sub category, its history is filed in the right
 * category, still under its own name.
 */
import type { BudgetItem, Txn } from "@coastfi/engine";
import { categoryKey, payeeMatches, type PayeeMatch, type YnabData } from "./ynab";

export type FoldSuggestion = { id: string; under: string; why: PayeeMatch };

export function foldSuggestions(budget: BudgetItem[], txns: Txn[]): FoldSuggestion[] {
  // archived ones not under a category yet, and the shown top-level ones they could go under
  const from = budget.filter((b) => b.hidden && !b.parentId).map((b) => b.id);
  const into = budget.filter((b) => !b.hidden && !b.parentId && !b.accountId).map((b) => b.id);
  if (!from.length || !into.length) return [];
  const k = (id: string) => categoryKey("", id);
  // the app's transactions, shaped like YNAB's (a category key per line) for the same matcher
  const d: YnabData = {
    assigned: [],
    txns: txns
      .filter((t) => !t.deleted && !t.transferAccountId && t.payee)
      .map((t) => ({
        account: t.accountId, date: t.date, payee: t.payee!, group: "", category: t.categoryId ?? "", memo: "", amount: t.amount, cleared: t.cleared,
        ...(t.splits?.length ? { splits: t.splits.map((s) => ({ group: "", category: s.categoryId ?? "", amount: s.amount, memo: "" })) } : {}),
      })),
  };
  const byKey = new Map([...from, ...into].map((id) => [k(id), id]));
  return Object.entries(payeeMatches(d, from.map(k), into.map(k)))
    .map(([key, m]) => ({ id: byKey.get(key)!, under: byKey.get(m.into)!, why: m }))
    .filter((s) => s.id && s.under);
}
