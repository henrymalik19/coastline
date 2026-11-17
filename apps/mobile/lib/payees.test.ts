import { describe, expect, it } from "vitest";
import { buildPayees, suggestPayees } from "./payees";

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
