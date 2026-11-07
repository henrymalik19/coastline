import type { BudgetItem } from "@coastfi/engine";
import { describe, expect, it } from "vitest";
import { groupOrder, mergeGroup, moveAmong, moveGroup, moveItem, moveToGroup } from "./budgetOrder";

const item = (id: string, group?: string): BudgetItem => ({ id, name: id, amount: 0, inRetirement: true, group });
const ids = (xs: BudgetItem[]) => xs.map((x) => x.id).join(",");

describe("budget order", () => {
  const items = [item("rent", "Housing"), item("power", "Housing"), item("food", "Food"), item("gas", "Car"), item("misc")];

  it("moves a whole group, keeping its items in order", () => {
    expect(ids(moveGroup(items, "Food", -1))).toBe("food,rent,power,gas,misc");
    expect(ids(moveGroup(items, "Housing", 1))).toBe("food,rent,power,gas,misc");
    expect(groupOrder(moveGroup(items, "Other", -1))).toEqual(["Housing", "Food", "Other", "Car"]);
  });

  it("doesn't move past the ends", () => {
    expect(moveGroup(items, "Housing", -1)).toBe(items);
    expect(moveGroup(items, "Other", 1)).toBe(items);
  });

  it("moves an item within its group only", () => {
    expect(ids(moveItem(items, 1, -1))).toBe("power,rent,food,gas,misc");
    expect(moveItem(items, 0, -1)).toBe(items); // already first in Housing
    expect(moveItem(items, 1, 1)).toBe(items); // already last in Housing
  });

  it("skips over other groups' items when they're interleaved", () => {
    const mixed = [item("a", "X"), item("b", "Y"), item("c", "X")];
    expect(ids(moveItem(mixed, 2, -1))).toBe("c,b,a");
  });
});

describe("moving among shown entries (debts, set-asides)", () => {
  const list = [{ id: "car" }, { id: "k401" }, { id: "card" }, { id: "home" }];
  const shown = (x: { id: string }) => x.id !== "k401"; // e.g. a payroll loan the budget doesn't list

  it("swaps with the next shown neighbour, skipping hidden ones", () => {
    expect(moveAmong(list, "card", -1, shown).map((x) => x.id).join(",")).toBe("card,k401,car,home");
    expect(moveAmong(list, "card", 1, shown).map((x) => x.id).join(",")).toBe("car,k401,home,card");
  });

  it("doesn't move past the ends", () => {
    expect(moveAmong(list, "car", -1, shown)).toBe(list);
    expect(moveAmong(list, "home", 1, shown)).toBe(list);
  });
});

describe("moving items between groups", () => {
  const items = [item("rent", "Housing"), item("power", "Housing"), item("food", "Food"), item("gym", "Health"), item("vet", "Pets")];

  it("moves an item to the end of another group", () => {
    const out = moveToGroup(items, 3, "Personal");
    expect(ids(out)).toBe("rent,power,food,vet,gym");
    expect(out.find((x) => x.id === "gym")!.group).toBe("Personal");
    expect(ids(moveToGroup(items, 2, "Housing"))).toBe("rent,power,food,gym,vet");
  });

  it("merges a small group into another to condense", () => {
    const out = mergeGroup(items, "Pets", "Housing");
    expect(ids(out)).toBe("rent,power,vet,food,gym");
    expect(groupOrder(out)).toEqual(["Housing", "Food", "Health"]);
    expect(mergeGroup(items, "Food", "Food")).toBe(items);
  });
});
