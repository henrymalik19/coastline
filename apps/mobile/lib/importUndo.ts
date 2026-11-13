import type { PlanState, Txn } from "@coastfi/engine";

/** How long after an import you can still undo it. */
export const UNDO_DAYS = 30;

/** Your plan and transactions the moment before an import, so it can be undone. */
export type ImportSnapshot = { at: number; plan: PlanState; txns: Txn[] };

/** Whether the import can still be undone. */
export const canUndoImport = (s: ImportSnapshot | undefined, now: number) => !!s && now - s.at < UNDO_DAYS * 86_400_000;

/**
 * Transactions as they were before the import: ones that were there come back as they were
 * (including yours the import replaced), and ones added since (by the import, or by you after)
 * are marked deleted, so the change syncs to your other devices.
 */
export function undoImportTxns(current: Txn[], before: Txn[], stamp: number): Txn[] {
  const was = new Map(before.map((x) => [x.id, x]));
  const out = current.map((x) => {
    const b = was.get(x.id);
    if (!b) return x.deleted ? x : { ...x, deleted: true, updatedAt: stamp };
    return JSON.stringify(b) === JSON.stringify(x) ? x : { ...b, updatedAt: stamp };
  });
  const have = new Set(current.map((x) => x.id));
  for (const b of before) if (!have.has(b.id)) out.push({ ...b, updatedAt: stamp });
  return out;
}

/** Transactions you added or changed since the import (what an undo also throws away). */
export const changedSinceImport = (current: Txn[], s: ImportSnapshot) => current.filter((x) => x.updatedAt > s.at && !x.id.startsWith("start:")).length;
