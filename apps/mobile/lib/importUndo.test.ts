import { describe, expect, it } from "vitest";
import type { Txn } from "@coastfi/engine";
import { addedSinceImport, canUndoImport, fromOldSnapshot, importSnapshot, undoImportTxns, UNDO_DAYS } from "./importUndo";

const tx = (id: string, extra: Partial<Txn> = {}): Txn => ({ id, accountId: "a", date: "2026-11-01", amount: -10, updatedAt: 1, ...extra }) as Txn;

describe("undoing an import", () => {
  const mine = tx("mine");
  const replaced = tx("old", { amount: -20 });
  const start = tx("start:a", { amount: 100 });
  const existing = [mine, replaced, start];
  // the import: yours replaced by YNAB's copy, a starting balance overwritten, and its own
  const imported = [mine, { ...replaced, deleted: true, updatedAt: 5 }, { ...start, amount: 250, updatedAt: 5 }, tx("ynab-1", { updatedAt: 5, source: "ynab" })];
  // the plan before: one account and one category of yours
  const before = { accounts: [{ id: "a", name: "Checking", type: "cash", balance: 0 }], debts: [], goals: [], budget: [{ id: "food", name: "Food", amount: 0, inRetirement: true }] } as never;
  const snap = importSnapshot(5, before, existing, imported);

  it("keeps only what it needs: the ids you had and the ones the import changed", () => {
    expect(snap.had).toEqual(["mine", "old", "start:a"]);
    expect(snap.before.map((x) => x.id)).toEqual(["old", "start:a"]);
  });

  it("deletes what came in or was added since, and brings back what the import changed", () => {
    const after = [...imported, tx("later", { updatedAt: 9 })];
    const out = undoImportTxns(after, snap, 100);
    expect(out.find((x) => x.id === "mine")).toBe(mine); // untouched
    expect(out.find((x) => x.id === "old")).toMatchObject({ amount: -20, updatedAt: 100 });
    expect(out.find((x) => x.id === "old")?.deleted).toBeUndefined();
    expect(out.find((x) => x.id === "start:a")).toMatchObject({ amount: 100, updatedAt: 100 });
    expect(out.find((x) => x.id === "ynab-1")).toMatchObject({ deleted: true, updatedAt: 100 });
    expect(out.find((x) => x.id === "later")).toMatchObject({ deleted: true, updatedAt: 100 });
    expect(addedSinceImport(after, snap)).toEqual({ keep: 1, remove: 0 });
  });

  it("keeps an edit you made since to one you already had", () => {
    const out = undoImportTxns([{ ...mine, amount: -99, updatedAt: 9 }, ...imported.slice(1)], snap, 100);
    expect(out.find((x) => x.id === "mine")).toMatchObject({ amount: -99, updatedAt: 9 });
  });

  it("turns an older full copy into the small one", () => {
    const old = fromOldSnapshot({ at: 5, plan: before, txns: existing }, imported);
    expect(old.had).toEqual(snap.had);
    expect(old.before.map((x) => x.id).sort()).toEqual(["old", "start:a"]);
  });

  it("can keep the ones you added since, where their account was there before", () => {
    const later = [
      tx("coffee", { updatedAt: 9, categoryId: "food" }), // your account, your category: stays as is
      tx("gift", { updatedAt: 9, categoryId: "n1" }), // a category the import made: stays, needs a category
      tx("visa", { accountId: "n2", updatedAt: 9 }), // an account the import made: can't stay
      tx("move", { updatedAt: 9, transferAccountId: "n2" }), // a transfer to one: can't stay
      tx("split", { updatedAt: 9, splits: [{ categoryId: "food", amount: -5 }, { categoryId: "n1", amount: -5 }] }),
    ];
    const after = [...imported, ...later];
    expect(addedSinceImport(after, snap)).toEqual({ keep: 3, remove: 2 });
    const out = undoImportTxns(after, snap, 100, true);
    const get = (id: string) => out.find((x) => x.id === id)!;
    expect(get("coffee")).toBe(later[0]);
    expect(get("gift")).toMatchObject({ updatedAt: 100 });
    expect(get("gift").categoryId).toBeUndefined();
    expect(get("gift").deleted).toBeUndefined();
    expect(get("visa")).toMatchObject({ deleted: true });
    expect(get("move")).toMatchObject({ deleted: true });
    expect(get("split").splits!.map((p) => p.categoryId)).toEqual(["food", ""]);
    expect(get("ynab-1")).toMatchObject({ deleted: true }); // the import's own always go
    // off: they all go
    expect(undoImportTxns(after, snap, 100, false).filter((x) => later.some((l) => l.id === x.id)).every((x) => x.deleted)).toBe(true);
  });

  it("stops after a while", () => {
    expect(canUndoImport(snap, 5 + 1000)).toBe(true);
    expect(canUndoImport(snap, 5 + UNDO_DAYS * 86_400_000)).toBe(false);
    expect(canUndoImport(undefined, 0)).toBe(false);
  });
});
