import { describe, expect, it } from "vitest";
import { bars, before, buildItems, compareWith, inFocus, listFor, periodRange, shares, sumIn } from "./spending";

const d = {
  periods: [],
  byCat: { food: { "2023-05": 100, "2024-02": 50 }, costco: { "2024-03": 30 }, fun: { "2024-04": 20 } },
  byOriginal: { "Fun: Games": { "2022-01": 9 } },
  uncategorized: { "2024-04": 4 },
  total: {},
};
const cats = [
  { key: "food", label: "Groceries", group: "Everyday" },
  { key: "costco", label: "Costco", group: "Old", parent: "food", hidden: true },
  { key: "fun", label: "Fun", group: "Fun" },
];
const items = buildItems(d, cats);

describe("spending report", () => {
  it("a sub category sits under its parent, in the parent's group", () => {
    expect(items.find((i) => i.key === "costco")).toMatchObject({ parent: "food", group: "Everyday", archived: true });
    expect(items.find((i) => i.key === "orig:Fun: Games")?.group).toBe("Old YNAB categories");
  });

  it("periods stay within the data you have", () => {
    expect(periodRange({ kind: "thisYear" }, "2022-01", "2024-11")).toEqual({ from: "2024-01", to: "2024-11" });
    expect(periodRange({ kind: "lastYear" }, "2022-01", "2024-11")).toEqual({ from: "2023-01", to: "2023-12" });
    expect(periodRange({ kind: "last12" }, "2022-01", "2024-11")).toEqual({ from: "2023-12", to: "2024-11" });
    expect(periodRange({ kind: "all" }, "2022-01", "2024-11")).toEqual({ from: "2022-01", to: "2024-11" });
    expect(periodRange({ kind: "years", from: "2020", to: "2023" }, "2022-01", "2024-11")).toEqual({ from: "2022-01", to: "2023-12" });
  });

  it("a category counts its sub categories; a group counts its categories", () => {
    const all = { from: "2022-01", to: "2024-12" };
    expect(sumIn(inFocus(items, { kind: "cat", key: "food" }), all)).toBe(180);
    expect(sumIn(inFocus(items, { kind: "group", group: "Everyday" }), all)).toBe(180);
    expect(sumIn(items, all)).toBe(213);
  });

  it("a bar a month for a year or less, a bar a year beyond", () => {
    expect(bars(items, { from: "2024-01", to: "2024-04" }).map((b) => b.value)).toEqual([0, 50, 30, 24]);
    const y = bars(items, { from: "2022-01", to: "2024-04" });
    expect(y.map((b) => [b.label, b.value, b.sub])).toEqual([["2022", 9, undefined], ["2023", 100, undefined], ["2024", 104, "4 mo"]]);
  });

  it("compares with the same length of time before, when there's data", () => {
    expect(before({ from: "2024-01", to: "2024-12" }, "2022-01")).toEqual({ from: "2023-01", to: "2023-12" });
    expect(before({ from: "2022-01", to: "2022-12" }, "2022-01")).toBeNull();
    expect(compareWith({ kind: "thisYear" }, { from: "2024-01", to: "2024-11" }, "2022-01")).toEqual({ range: { from: "2023-01", to: "2023-11" }, label: "the same months of 2023" });
    expect(compareWith({ kind: "lastYear" }, { from: "2023-01", to: "2023-12" }, "2022-01")?.label).toBe("2022");
    expect(compareWith({ kind: "last12" }, { from: "2023-12", to: "2024-11" }, "2022-01")?.label).toBe("the 12 months before");
    expect(compareWith({ kind: "all" }, { from: "2022-01", to: "2024-11" }, "2022-01")).toBeNull();
  });

  it("the list: groups with their categories, sub categories under their parent", () => {
    const l = listFor(items, { kind: "all" }, { from: "2022-01", to: "2024-12" });
    expect(l.map((g) => g.title)).toEqual(["Everyday", "Fun", "Old YNAB categories", "No category"]);
    expect(l[0]!.rows[0]).toMatchObject({ name: "Groceries", total: 180, subs: [{ name: "Costco", total: 30 }] });
    const c = listFor(items, { kind: "cat", key: "food" }, { from: "2022-01", to: "2024-12" });
    expect(c[0]!.rows.map((r) => [r.name, r.total])).toEqual([["Groceries itself", 150], ["Costco", 30]]);
  });

  it("the split bar keeps the biggest few and puts the rest in Other", () => {
    const s = shares([1, 2, 3, 4, 5, 6, 7].map((n) => ({ name: `c${n}`, total: n })), 5);
    expect(s.map((x) => x.name)).toEqual(["c7", "c6", "c5", "c4", "c3", "Other"]);
    expect(s[5]!.total).toBe(3);
  });
});

describe("stacked bars", () => {
  it("all spending stacks by group; a group by its categories; one category doesn't stack", async () => {
    const { stackFor, stackValues } = await import("./spending");
    const all = { from: "2022-01", to: "2024-12" };
    const s = stackFor(items, { kind: "all" }, all)!;
    expect(s.series.map((x) => [x.name, x.total])).toEqual([["Everyday", 180], ["Fun", 20], ["Old YNAB categories", 9], ["No category", 4]]);
    expect(stackValues(items, s, { from: "2024-03", to: "2024-03" })).toEqual([30, 0, 0, 0]);
    expect(stackFor(items, { kind: "cat", key: "food" }, all)).toBeNull();
    const two = stackFor(items, { kind: "all" }, all, 2)!;
    expect(two.series.map((x) => x.name)).toEqual(["Everyday", "Fun", "Other"]);
    expect(two.series[2]!.total).toBe(13);
  });
});
