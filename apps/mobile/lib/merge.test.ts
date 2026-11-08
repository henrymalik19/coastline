import { describe, expect, it } from "vitest";
import { merge3 } from "./merge";

describe("merge3", () => {
  it("keeps both people's edits to different fields", () => {
    const base = { a: 1, b: 1, c: { x: 1, y: 1 } };
    expect(merge3(base, { ...base, a: 2, c: { x: 2, y: 1 } }, { ...base, b: 3, c: { x: 1, y: 3 } })).toEqual({ a: 2, b: 3, c: { x: 2, y: 3 } });
  });

  it("this device wins when both change the same value", () => {
    expect(merge3({ a: 1 }, { a: 2 }, { a: 3 })).toEqual({ a: 2 });
  });

  it("merges budget assignments made by each person in the same month", () => {
    const base = { months: { "2026-11": { assigned: { food: 100, rent: 1000 } } } };
    const mine = { months: { "2026-11": { assigned: { food: 200, rent: 1000 } } } };
    const hers = { months: { "2026-11": { assigned: { food: 100, rent: 1000, gas: 50 } } } };
    expect(merge3(base, mine, hers)).toEqual({ months: { "2026-11": { assigned: { food: 200, rent: 1000, gas: 50 } } } });
  });

  it("merges lists item by item: edits, additions and removals from both sides", () => {
    const base = [{ id: "a", v: 1 }, { id: "b", v: 1 }, { id: "c", v: 1 }];
    const mine = [{ id: "a", v: 2 }, { id: "b", v: 1 }, { id: "c", v: 1 }, { id: "d", v: 1 }];
    const hers = [{ id: "a", v: 1 }, { id: "c", v: 5 }, { id: "e", v: 1 }];
    expect(merge3(base, mine, hers)).toEqual([{ id: "a", v: 2 }, { id: "c", v: 5 }, { id: "d", v: 1 }, { id: "e", v: 1 }]);
  });

  it("keeps an item one side removed when the other side changed it", () => {
    const base = [{ id: "a", v: 1 }];
    expect(merge3(base, [], [{ id: "a", v: 2 }])).toEqual([{ id: "a", v: 2 }]);
  });

  it("keeps this device's new order when only it reordered", () => {
    const base = [{ id: "a" }, { id: "b" }];
    expect(merge3(base, [{ id: "b" }, { id: "a" }], [{ id: "a" }, { id: "b" }, { id: "c" }])).toEqual([{ id: "b" }, { id: "a" }, { id: "c" }]);
  });

  it("removes a field one side deleted", () => {
    expect(merge3({ a: 1, b: 1 }, { a: 1 }, { a: 1, b: 1, c: 2 })).toEqual({ a: 1, c: 2 });
  });

  it("merges contribution limit rows by year", () => {
    const base = [{ year: 2026, ira: 7000 }];
    expect(merge3(base, [{ year: 2026, ira: 7500 }], [{ year: 2026, ira: 7000 }, { year: 2027, ira: 7500 }])).toEqual([{ year: 2026, ira: 7500 }, { year: 2027, ira: 7500 }]);
  });

  it("treats plain lists (like the priority order) as one value", () => {
    expect(merge3(["a", "b"], ["b", "a"], ["a", "b", "c"])).toEqual(["b", "a"]);
  });
});
