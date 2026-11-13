import { describe, expect, it } from "vitest";
import type { Txn } from "@coastfi/engine";
import { canUndoImport, changedSinceImport, undoImportTxns, UNDO_DAYS } from "./importUndo";

const tx = (id: string, extra: Partial<Txn> = {}): Txn => ({ id, accountId: "a", date: "2026-11-01", amount: -10, updatedAt: 1, ...extra }) as Txn;

describe("undoing an import", () => {
  const mine = tx("mine");
  const replaced = tx("old", { amount: -20 });
  const before = [mine, replaced];
  // after the import: yours replaced by YNAB's copy, the import's own, and one you added since
  const after = [mine, { ...replaced, deleted: true, updatedAt: 5 }, tx("ynab-1", { updatedAt: 5, source: "ynab" }), tx("later", { updatedAt: 9 })];

  it("deletes what came in or was added since, and brings back what the import replaced", () => {
    const out = undoImportTxns(after, before, 100);
    expect(out.find((x) => x.id === "mine")).toBe(mine); // untouched
    expect(out.find((x) => x.id === "old")).toMatchObject({ amount: -20, updatedAt: 100 });
    expect(out.find((x) => x.id === "old")?.deleted).toBeUndefined();
    expect(out.find((x) => x.id === "ynab-1")).toMatchObject({ deleted: true, updatedAt: 100 });
    expect(out.find((x) => x.id === "later")).toMatchObject({ deleted: true, updatedAt: 100 });
  });

  it("puts back an edit you made to one of yours since", () => {
    const out = undoImportTxns([{ ...mine, amount: -99, updatedAt: 9 }], before, 100);
    expect(out.find((x) => x.id === "mine")).toMatchObject({ amount: -10, updatedAt: 100 });
    expect(out.find((x) => x.id === "old")).toMatchObject({ amount: -20, updatedAt: 100 });
  });

  it("counts your changes since, and stops after a while", () => {
    const s = { at: 6, plan: {} as never, txns: before };
    expect(changedSinceImport(after, s)).toBe(1);
    expect(canUndoImport(s, 6 + 1000)).toBe(true);
    expect(canUndoImport(s, 6 + UNDO_DAYS * 86_400_000)).toBe(false);
    expect(canUndoImport(undefined, 0)).toBe(false);
  });
});
