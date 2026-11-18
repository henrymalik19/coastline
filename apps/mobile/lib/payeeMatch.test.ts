import { describe, expect, it } from "vitest";
import { categoryKey, payeeKey, payeeMatches, suggestCategories, type YnabData, type YnabTxn } from "./ynab";
import { freshPlan } from "./presets";

const tx = (payee: string, group: string, category: string, date = "2026-10-05"): YnabTxn => ({ account: "Checking", date, payee, group, category, memo: "", amount: -10, cleared: "cleared" });
const K = (g: string, c: string) => categoryKey(g, c);

describe("matching categories by where the money went", () => {
  it("treats store numbers and case as the same payee", () => {
    expect(payeeKey("KROGER #1234")).toBe(payeeKey("Kroger"));
    expect(payeeKey("Starbucks 00123")).toBe("starbucks");
  });

  it("an old category whose payees are another's is matched to it, with why", () => {
    const d: YnabData = {
      assigned: [],
      txns: [
        ...["Kroger", "Aldi", "Kroger"].map((p) => tx(p, "Everyday", "Groceries")),
        ...["Shell", "BP"].map((p) => tx(p, "Everyday", "Gas")),
        ...["KROGER #9", "Aldi", "Aldi", "Shell"].map((p) => tx(p, "Old", "Food", "2024-01-05")),
      ],
    };
    const m = payeeMatches(d, [K("Old", "Food")], [K("Everyday", "Groceries"), K("Everyday", "Gas")]);
    expect(m[K("Old", "Food")]).toEqual({ into: K("Everyday", "Groceries"), payees: ["Aldi", "Kroger"], matched: 3, of: 4 });
  });

  it("no clear winner, too few, or payees everywhere: no match", () => {
    const d: YnabData = {
      assigned: [],
      txns: [
        tx("Target", "A", "Home"), tx("Target", "A", "Gifts"), tx("Amazon", "A", "Home"), tx("Amazon", "A", "Gifts"),
        tx("Target", "Old", "Stuff"), tx("Amazon", "Old", "Stuff"), tx("Target", "Old", "Stuff"),
        tx("Kroger", "A", "Food"), tx("Kroger", "Old", "Few"),
      ],
    };
    const m = payeeMatches(d, [K("Old", "Stuff"), K("Old", "Few")], [K("A", "Home"), K("A", "Gifts"), K("A", "Food")]);
    expect(m).toEqual({});
  });

  it("suggests combining an unused category into the one with the same payees", () => {
    const d: YnabData = {
      assigned: [],
      txns: [
        ...["Kroger", "Aldi", "Kroger"].map((p) => tx(p, "Everyday", "Groceries", "2026-10-05")),
        ...["Kroger", "Aldi", "Aldi"].map((p) => tx(p, "Everyday", "Food (old)", "2024-03-05")),
      ],
    };
    const cats = [{ group: "Everyday", name: "Groceries", average: 400 }, { group: "Everyday", name: "Food (old)", average: 0 }];
    const s = suggestCategories(freshPlan(), d, cats, "2026-11-18");
    expect(s[K("Everyday", "Food (old)")]).toEqual({ action: "combine", into: K("Everyday", "Groceries") });
  });
});
