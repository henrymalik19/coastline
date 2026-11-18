import { describe, expect, it } from "vitest";
import type { BudgetItem, Txn } from "@coastfi/engine";
import { foldSuggestions } from "./foldSuggest";

const item = (id: string, extra: Partial<BudgetItem> = {}): BudgetItem => ({ id, name: id, amount: 0, inRetirement: true, ...extra });
const tx = (id: string, payee: string, categoryId: string): Txn => ({ id, accountId: "chk", date: "2026-10-01", amount: -10, payee, categoryId, cleared: "cleared", source: "manual", updatedAt: 1 });

describe("archived categories that belong under one you use", () => {
  it("suggests the category whose places match, and not one already under a category", () => {
    const budget = [item("groc"), item("gas"), item("food", { hidden: true }), item("old", { hidden: true, parentId: "groc" })];
    const txns = [
      tx("1", "Kroger", "groc"), tx("2", "Aldi", "groc"), tx("3", "Shell", "gas"),
      tx("4", "KROGER #12", "food"), tx("5", "Aldi", "food"), tx("6", "Aldi", "food"),
      tx("7", "Kroger", "old"), tx("8", "Kroger", "old"), tx("9", "Kroger", "old"),
    ];
    const s = foldSuggestions(budget, txns);
    expect(s.map((x) => [x.id, x.under])).toEqual([["food", "groc"]]);
    expect(s[0]!.why).toMatchObject({ matched: 3, of: 3 });
  });
});
