import { describe, expect, it } from "vitest";
import { buildImport, categoryKey, payeeKey, payeeMatches, suggestCategories, type YnabData, type YnabTxn } from "./ynab";
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

describe("a category that pays a loan (each home's PITI its own mortgage)", () => {
  const plan = () => {
    const p = freshPlan();
    p.debts = [
      { id: "m1", name: "710 Dillon Way", kind: "mortgage", balance: 100000, apr: 0.04, minPayment: 1147 },
      { id: "m2", name: "840 Madison View Lane", kind: "mortgage", balance: 300000, apr: 0.05, minPayment: 3572 },
    ];
    return p;
  };
  const cats = [
    { group: "710 Dillon Way", name: "PITI", average: 1147 },
    { group: "840 Madison View Lane", name: "PITI", average: 3572 },
    { group: "Everyday", name: "Gas", average: 50 },
  ];
  const d: YnabData = { assigned: [], txns: [] };

  it("suggests each home's PITI pays that home's mortgage", () => {
    const s = suggestCategories(plan(), d, cats, "2026-11-18");
    expect(s[K("710 Dillon Way", "PITI")]).toEqual({ action: "loan", debt: "plan:m1" });
    expect(s[K("840 Madison View Lane", "PITI")]).toEqual({ action: "loan", debt: "plan:m2" });
    expect(s[K("Everyday", "Gas")]!.action).toBe("new");
  });

  it("imports them as two categories, each linked to its own mortgage", () => {
    const p = plan();
    const withRows: YnabData = { txns: [], assigned: cats.map((c) => ({ month: "2026-11", group: c.group, category: c.name, assigned: c.average, activity: 0, available: 0 })) };
    const r = buildImport(p, withRows, {
      from: "2026-11", thisMonth: "2026-11", accounts: {}, categories: {}, removeEmpty: false,
      categoryMap: { [K("710 Dillon Way", "PITI")]: { action: "loan", debt: "plan:m1" }, [K("840 Madison View Lane", "PITI")]: { action: "loan", debt: "plan:m2" } },
    });
    const piti = r.plan.budget.filter((b) => b.name === "PITI");
    expect(piti.map((b) => b.paysDebt).sort()).toEqual(["m1", "m2"]);
  });
});
