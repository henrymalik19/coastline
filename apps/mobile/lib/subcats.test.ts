import { describe, expect, it } from "vitest";
import type { BudgetItem } from "@coastfi/engine";
import { archive, archiveSet, canBeSub, keepFamilyGroups, makeOwn, moveUnder, parentChoices, restore, subsOf } from "./subcats";

const item = (id: string, extra: Partial<BudgetItem> = {}): BudgetItem => ({ id, name: id, amount: 10, inRetirement: true, group: "Home", ...extra });

describe("sub categories", () => {
  const list = () => [item("care", { amount: 120 }), item("subs"), item("gym", { amount: 80, group: "Fun" }), item("sitter", { amount: 300 })];

  it("moves a category under another: same group, listed after that one's family", () => {
    let b = moveUnder(list(), "sitter", "care");
    b = moveUnder(b, "gym", "care");
    expect(b.map((x) => x.id)).toEqual(["care", "sitter", "gym", "subs"]);
    expect(b.find((x) => x.id === "gym")).toMatchObject({ parentId: "care", group: "Home", amount: 80 });
    expect(subsOf(b, "care").map((x) => x.id)).toEqual(["sitter", "gym"]);
  });

  it("one level only: a sub can't take subs, and one with subs can't go under another", () => {
    const b = moveUnder(list(), "sitter", "care");
    expect(moveUnder(b, "gym", "sitter")).toBe(b);
    expect(canBeSub(b, "care")).toBe(false);
    expect(parentChoices(b, "gym").map((x) => x.id)).toEqual(["care", "subs"]);
  });

  it("makes a sub its own category again, after its old family", () => {
    const b = makeOwn(moveUnder(moveUnder(list(), "sitter", "care"), "gym", "care"), "sitter");
    expect(b.map((x) => x.id)).toEqual(["care", "gym", "sitter", "subs"]);
    expect(b.find((x) => x.id === "sitter")!.parentId).toBeUndefined();
  });

  it("subs follow their category's group", () => {
    const b = moveUnder(list(), "sitter", "care").map((x) => (x.id === "care" ? { ...x, group: "Kids" } : x));
    expect(keepFamilyGroups(b).find((x) => x.id === "sitter")!.group).toBe("Kids");
  });

  it("archives with its subs, remembering amounts; restores under its category with its old amount", () => {
    const b = moveUnder(list(), "gym", "care");
    const a = archive(b, archiveSet(b, "gym"));
    expect(a.find((x) => x.id === "gym")).toMatchObject({ hidden: true, amount: 0, archivedAmount: 80, parentId: "care" });
    const r = restore(a, "gym");
    expect(r.find((x) => x.id === "gym")).toMatchObject({ amount: 80, parentId: "care" });
    expect(r.find((x) => x.id === "gym")!.hidden).toBeUndefined();
    expect(r.map((x) => x.id)).toEqual(["care", "gym", "subs", "sitter"]);
    // its category archived too: archiving a category takes its subs; restoring one on its own goes to a group
    const both = archive(b, archiveSet(b, "care"));
    expect(both.filter((x) => x.hidden).map((x) => x.id)).toEqual(["care", "gym"]);
    const alone = restore(both, "gym", "Fun");
    expect(alone.find((x) => x.id === "gym")).toMatchObject({ group: "Fun", amount: 80 });
    expect(alone.find((x) => x.id === "gym")!.parentId).toBeUndefined();
  });

  it("restoring a category brings back the sub categories archived with it, under it", () => {
    const b = moveUnder(list(), "gym", "care");
    const both = archive(b, archiveSet(b, "care"));
    const r = restore(both, "care", "Home");
    expect(r.filter((x) => x.hidden)).toEqual([]);
    expect(r.find((x) => x.id === "gym")).toMatchObject({ parentId: "care", amount: 80 });
    expect(r.find((x) => x.id === "care")).toMatchObject({ amount: 120 });
  });
});
