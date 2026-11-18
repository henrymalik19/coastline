import { describe, expect, it } from "vitest";
import type { PlanState } from "@coastfi/engine";
import { debtItPays, linkDebtCategories, newLoanPayment, paidLastTwoMonths, setLoanPayment } from "./debtLink";

describe("categories that pay a loan", () => {
  const plan = (): Pick<PlanState, "debts" | "budget"> => ({
    debts: [
      { id: "m1", name: "840 Madison View Lane", kind: "mortgage", balance: 366819, apr: 0.06, minPayment: 3572.77 },
      { id: "m2", name: "710 Dillon Way", kind: "mortgage", balance: 175236, apr: 0.03, minPayment: 1147.19 },
      { id: "cc", name: "Sapphire", kind: "credit_card", balance: 900, apr: 0.24, minPayment: 35 },
      { id: "k", name: "401(k) loan", kind: "k401_loan" as never, balance: 25000, apr: 0.05, minPayment: 528, payroll: true },
    ],
    budget: [
      { id: "piti1", name: "PITI", group: "840 Madison View Lane", amount: 3573, inRetirement: true },
      { id: "hoa", name: "HOA", group: "840 Madison View Lane", amount: 18, inRetirement: true },
      { id: "piti2", name: "PITI", group: "710 Dillon Way", amount: 1147, inRetirement: true },
      { id: "food", name: "Groceries", group: "Food", amount: 3573, inRetirement: true },
      { id: "card", name: "Sapphire payment", group: "Bills", amount: 35, inRetirement: true },
    ],
  });
  it("finds the PITI category of each mortgage, not the HOA or a card", () => {
    const p = plan();
    expect(debtItPays(p, p.budget[0]!)?.id).toBe("m1");
    expect(debtItPays(p, p.budget[1]!)).toBeUndefined();
    expect(debtItPays(p, p.budget[2]!)?.id).toBe("m2");
    // groceries at the same amount: only asked about (a coincidence costs a tap), never linked by itself
    expect(debtItPays(p, p.budget[3]!, true)).toBeUndefined();
    expect(debtItPays(p, p.budget[4]!)).toBeUndefined();
  });
  it("links each loan to one category, and leaves ones you said no to", () => {
    const p = plan();
    p.budget[2]!.noSuggest = true;
    expect(linkDebtCategories(p)).toBe(1);
    expect(p.budget.map((b) => b.paysDebt)).toEqual(["m1", undefined, undefined, undefined, undefined]);
    // already linked: not suggested again
    expect(debtItPays(p, p.budget[0]!)).toBeUndefined();
  });
});

describe("a category with any name", () => {
  it("is asked about when its amount is within 1% of a loan's payment, but not linked by itself", () => {
    const p: Pick<PlanState, "debts" | "budget"> = {
      debts: [{ id: "m1", name: "840 Madison View Lane", kind: "mortgage", balance: 366819, apr: 0.06, minPayment: 3572.77 }],
      budget: [{ id: "house", name: "House stuff", group: "Home", amount: 3573, inRetirement: true }],
    };
    expect(debtItPays(p, p.budget[0]!)?.id).toBe("m1");
    expect(debtItPays(p, p.budget[0]!, true)).toBeUndefined();
    expect(linkDebtCategories(p)).toBe(0);
  });
});

describe("real payments that moved away from the loan's", () => {
  const tx = (id: string, date: string, amount: number) => ({ id, accountId: "chk", date, amount, categoryId: "piti", cleared: "cleared" as const, source: "manual" as const, updatedAt: 0 });
  it("two steady months at a new amount: suggest it; not when kept, unsteady or close", () => {
    const paid = paidLastTwoMonths([tx("a", "2026-09-01", -3650), tx("b", "2026-10-01", -3650), tx("c", "2026-11-01", -3650)], "piti", "2026-11");
    expect(paid).toEqual([3650, 3650]);
    expect(newLoanPayment({ minPayment: 3572.77 }, {}, paid)).toBe(3650);
    expect(newLoanPayment({ minPayment: 3572.77 }, { keptAt: 3650 }, paid)).toBeUndefined();
    expect(newLoanPayment({ minPayment: 3572.77 }, {}, [3500, 3650])).toBeUndefined();
    expect(newLoanPayment({ minPayment: 3572.77 }, {}, [3575, 3575])).toBeUndefined();
    expect(paidLastTwoMonths([tx("b", "2026-10-01", -3650)], "piti", "2026-11")).toBeUndefined();
  });
  it("updating a mortgage moves its escrow by the difference (taxes and insurance changed)", () => {
    const d = { id: "m", name: "House", kind: "mortgage" as const, balance: 300000, apr: 0.06, minPayment: 3572.77, escrow: 1234.99 };
    setLoanPayment(d, 3650);
    expect(d).toMatchObject({ minPayment: 3650, escrow: 1312.22 });
  });
});
