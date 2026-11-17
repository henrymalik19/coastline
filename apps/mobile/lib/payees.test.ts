import { describe, expect, it } from "vitest";
import { buildPayees, payeeKey, renamePayeesIn, similarPayees, suggestPayees } from "./payees";

const t = (payee: string, updatedAt: number, categoryId?: string, deleted?: boolean) => ({ payee, updatedAt, categoryId, deleted });

describe("payee suggestions", () => {
  const payees = buildPayees([
    t("Costco Wholesale", 1, "groceries"),
    t("Costco Wholesale", 5, "household"),
    t("eBay", 2, "shopping"),
    t("Whole Foods", 3, "groceries"),
    t("Whole Foods", 4, "groceries"),
    t("Whole Foods", 6, "groceries"),
    t("Old Place", 7, "x", true),
  ]);

  it("keeps how you wrote it, the latest category and how often it's used", () => {
    expect(payees.get("ebay")).toMatchObject({ name: "eBay", count: 1 });
    expect(payees.get("costco wholesale")).toMatchObject({ categoryId: "household", count: 2 });
    expect(payees.has("old place")).toBe(false);
  });

  it("matches anywhere in the name, names that start with it first", () => {
    expect(suggestPayees(payees, "whole").map((p) => p.name)).toEqual(["Whole Foods", "Costco Wholesale"]);
    expect(suggestPayees(payees, "eb").map((p) => p.name)).toEqual(["eBay"]);
    expect(suggestPayees(payees, "co").map((p) => p.name)).toEqual(["Costco Wholesale"]);
  });

  it("needs 2 letters, and doesn't suggest what you've already typed in full", () => {
    expect(suggestPayees(payees, "w")).toEqual([]);
    expect(suggestPayees(payees, "whole foods")).toEqual([]);
  });

  it("leaves out an account's automatic starting balance", () => {
    const withStart = buildPayees([{ id: "start:chk", payee: "Starting balance", updatedAt: 1 }, t("Starbucks", 2)]);
    expect([...withStart.values()].map((p) => p.name)).toEqual(["Starbucks"]);
  });

  it("puts the most used first among equal matches", () => {
    const more = buildPayees([t("Shell", 1), t("Shell", 2), t("Shake Shack", 3)]);
    expect(suggestPayees(more, "sh").map((p) => p.name)).toEqual(["Shell", "Shake Shack"]);
  });
});

describe("tidying payees", () => {
  const t = (payee: string, updatedAt: number) => ({ id: "t" + updatedAt, payee, updatedAt });

  it("groups names that look like the same place", () => {
    const p = buildPayees([t("CHICK-FIL-A #01234", 1), t("Chick-fil-A", 2), t("Chick-fil-A", 3), t("Cash App*John", 4), t("Cash App", 5), t("The Home Depot", 6), t("Home Depot", 7), t("Kroger", 8)]);
    const groups = similarPayees(p).map((g) => g.map((x) => x.name));
    expect(groups).toContainEqual(["Chick-fil-A", "CHICK-FIL-A #01234"]);
    expect(groups).toContainEqual(["Cash App", "Cash App*John"]); // a tie: the shorter, cleaner name first
    expect(groups).toContainEqual(["Home Depot", "The Home Depot"]);
    expect(groups.flat()).not.toContain("Kroger");
    expect(payeeKey("ATM")).toBe("atm");
    expect(payeeKey("7-11")).toBe("");
  });

  it("renames or combines payees everywhere, any casing", () => {
    const txns = [{ ...t("CHICK-FIL-A #01234", 1) }, { ...t("chick-fil-a", 2) }, { ...t("Kroger", 3) }, { id: "start:a", payee: "Chick-fil-A", updatedAt: 4 }];
    const out = renamePayeesIn(txns, ["CHICK-FIL-A #01234", "Chick-fil-A"], "Chick-fil-A", 9);
    expect(out.map((x) => [x.payee, x.updatedAt])).toEqual([["Chick-fil-A", 9], ["Chick-fil-A", 9], ["Kroger", 3], ["Chick-fil-A", 4]]);
    expect(renamePayeesIn(txns, ["Nobody"], "X", 9)).toBe(txns);
  });
});
