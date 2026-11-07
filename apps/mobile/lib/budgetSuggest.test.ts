import type { BudgetItem } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { goalFromItem, suggestFor } from "./budgetSuggest";

const item = (name: string, group?: string, amount = 100): BudgetItem => ({ id: name, name, amount, inRetirement: true, group });

describe("budget suggestions", () => {
  it("suggests a better group, but not when it's already somewhere sensible", () => {
    expect(suggestFor(item("Netflix", "Food"))).toMatchObject({ kind: "group", group: "Bills" });
    expect(suggestFor(item("Netflix", "Subscriptions"))).toBeNull();
    expect(suggestFor(item("Gym membership", "Other"))).toMatchObject({ kind: "group", group: "Health" });
    expect(suggestFor(item("Groceries", "Food"))).toBeNull();
    // the starting budget's items are already where they belong
    expect(suggestFor(item("Gas & transit", "Transportation"))).toBeNull();
    expect(suggestFor(item("Phone & internet", "Bills"))).toBeNull();
  });

  it("spots things you save up for", () => {
    expect(suggestFor(item("Christmas gifts", "Personal"))).toMatchObject({ kind: "goal", recurring: true, december: true });
    expect(suggestFor(item("Vacation", "Personal"))).toMatchObject({ kind: "goal", recurring: true, december: false });
    expect(suggestFor(item("Wedding", "Family"))).toMatchObject({ kind: "goal", recurring: false });
    expect(suggestFor(item("Emergency fund", "Other"))).toBeNull();
  });

  it("matches whole words and respects a dismissed hint", () => {
    expect(suggestFor(item("Carpet cleaning", "Other"))).toBeNull(); // 'pet' inside a word isn't a pet
    expect(suggestFor({ ...item("Netflix", "Food"), noSuggest: true })).toBeNull();
  });

  it("turns an item into a goal sized for a year", () => {
    const g = goalFromItem(item("Christmas gifts", "Personal", 100), true, true, new Date(2026, 10, 7));
    expect(g).toMatchObject({ name: "Christmas gifts", target: 1200, saved: 0, recurring: { every: 12, due: "2026-12" } });
    const v = goalFromItem(item("Vacation", "Personal", 250), true, false, new Date(2026, 10, 7));
    expect(v.recurring!.due).toBe("2027-11");
    const w = goalFromItem(item("Wedding", "Family", 500), false, false);
    expect(w.recurring).toBeUndefined();
  });
});
