import { describe, expect, it } from "vitest";
import { spendingByYear, type Txn } from "../src";

let n = 0;
const tx = (p: Partial<Txn> & { date: string; amount: number }): Txn => ({ id: `t${n++}`, accountId: "chk", cleared: "cleared", source: "manual", updatedAt: 1, ...p }) as Txn;

describe("spending by year", () => {
  it("adds up spending per category per year, history included, refunds lowering it", () => {
    const r = spendingByYear([
      tx({ date: "2021-03-01", amount: -100, categoryId: "food" }),
      tx({ date: "2021-04-01", amount: 20, categoryId: "food" }),
      tx({ date: "2021-05-01", amount: -50, categoryId: "food", accountId: "outside:Old Card" }),
      tx({ date: "2022-01-01", amount: -30, categoryId: "food" }),
    ]);
    expect(r.years).toEqual(["2021", "2022"]);
    expect(r.byCat.food).toEqual({ "2021": 130, "2022": 30 });
    expect(r.total).toEqual({ "2021": 130, "2022": 30 });
  });

  it("leaves out transfers, money to assign, starting balances, deleted ones, and skipped categories", () => {
    const r = spendingByYear(
      [
        tx({ date: "2021-01-01", amount: -500, transferAccountId: "sav" }),
        tx({ date: "2021-01-01", amount: 3000, categoryId: "ready" }),
        tx({ id: "start:chk", date: "2021-01-01", amount: 900 }),
        tx({ date: "2021-01-01", amount: -40, categoryId: "food", deleted: true }),
        tx({ date: "2021-01-01", amount: -200, categoryId: "debt:visa" }),
        tx({ date: "2021-01-01", amount: 25 }),
      ],
      (c) => c.startsWith("debt:"),
    );
    expect(r.years).toEqual([]);
    expect(r.total).toEqual({});
  });

  it("splits count per part; old YNAB categories and no category are kept apart", () => {
    const r = spendingByYear([
      tx({ date: "2020-06-01", amount: -90, splits: [{ categoryId: "food", amount: -60 }, { categoryId: "", amount: -30, originalCategory: "Fun: Games" }] }),
      tx({ date: "2020-07-01", amount: -15, accountId: "outside:Old", originalCategory: "Fun: Games" }),
      tx({ date: "2020-07-01", amount: 1000, accountId: "outside:Old", originalCategory: "Inflow: Ready to Assign" }),
      tx({ date: "2020-08-01", amount: -12 }),
    ]);
    expect(r.byCat.food).toEqual({ "2020": 60 });
    expect(r.byOriginal["Fun: Games"]).toEqual({ "2020": 45 });
    expect(r.uncategorized).toEqual({ "2020": 12 });
    expect(r.total).toEqual({ "2020": 117 });
  });

  it("nothing after today counts", () => {
    const r = spendingByYear([tx({ date: "2027-01-02", amount: -10, categoryId: "food" })], undefined, "2026-11-19");
    expect(r.years).toEqual([]);
  });
});

describe("spending by month", () => {
  it("the same rules, by month", async () => {
    const { spendingByMonth } = await import("../src");
    const r = spendingByMonth([
      tx({ date: "2024-01-05", amount: -10, categoryId: "food" }),
      tx({ date: "2024-01-20", amount: -5, categoryId: "food" }),
      tx({ date: "2024-03-01", amount: -7, originalCategory: "Fun: Games", accountId: "outside:Old" }),
    ]);
    expect(r.periods).toEqual(["2024-01", "2024-03"]);
    expect(r.byCat.food).toEqual({ "2024-01": 15 });
    expect(r.byOriginal["Fun: Games"]).toEqual({ "2024-03": 7 });
  });
});
