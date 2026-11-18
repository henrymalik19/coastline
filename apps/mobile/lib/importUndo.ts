import type { PlanState, Txn } from "@coastfi/engine";
import { PlanStateSchema, TxnSchema, withProperties } from "@coastfi/schema";
import { z } from "zod";

/** How long after an import you can still undo it. */
export const UNDO_DAYS = 30;
const DAY = 86_400_000;

/**
 * What it takes to undo an import, kept small enough to save with your account (so Undo works on any
 * device): the plan just before it, which transactions you already had, and how the ones the import
 * changed (replaced by YNAB's copy, or overwritten) looked before.
 */
export type ImportSnapshot = { at: number; plan: PlanState; had: string[]; before: Txn[] };

/** An undo copy from before it was shared: every transaction as it was. */
type OldSnapshot = { at: number; plan: PlanState; txns: Txn[] };

/** A saved undo copy's lists, checked (the plan is checked by the caller). Undefined if anything's off. */
export function parseUndo(raw: { at?: unknown; had?: unknown; before?: unknown }, plan: PlanState): ImportSnapshot | undefined {
  const had = z.array(z.string()).safeParse(raw.had);
  const before = z.array(TxnSchema).safeParse(raw.before);
  return typeof raw.at === "number" && had.success && before.success ? { at: raw.at, plan, had: had.data, before: before.data } : undefined;
}

/** Whether the import can still be undone. */
export const canUndoImport = (s: Pick<ImportSnapshot, "at"> | undefined, now: number) => !!s && now - s.at < UNDO_DAYS * DAY;

/** The undo copy for an import that turns `existing` into `after`. */
export function importSnapshot(at: number, plan: PlanState, existing: Txn[], after: Txn[]): ImportSnapshot {
  const now = new Map(after.map((x) => [x.id, x]));
  return { at, plan, had: existing.map((x) => x.id), before: existing.filter((x) => now.get(x.id) !== x) };
}

/** An undo copy saved before Undo worked on every device, in today's form (`current`: the transactions now). */
export function fromOldSnapshot(s: OldSnapshot, current: Txn[]): ImportSnapshot {
  const was = new Map(s.txns.map((x) => [x.id, x]));
  // the ones the import changed: different now, and not edited by you since
  const before = current.flatMap((x) => {
    const b = was.get(x.id);
    return b && x.updatedAt <= s.at + 60_000 && JSON.stringify(b) !== JSON.stringify(x) ? [b] : [];
  });
  return { at: s.at, plan: s.plan, had: s.txns.map((x) => x.id), before };
}

/** The accounts and categories the plan had before the import (what a transaction can still point at after an undo). */
function beforeImport(plan: PlanState) {
  const accounts = new Set([...plan.accounts.map((a) => a.id), ...plan.debts.map((d) => d.id)]);
  const categories = new Set<string>(["ready", "cash", ...plan.budget.map((b) => b.id), ...plan.goals.map((g) => "goal:" + g.id), ...plan.debts.map((d) => "debt:" + d.id), ...plan.accounts.map((a) => "acct:" + a.id)]);
  return { accounts, categories };
}

/**
 * One you added since the import, as it can stay after an undo: its account (and a transfer's other
 * account) was there before. A category the import made is dropped (it needs a category again).
 * Undefined: it can't stay.
 */
function keepable(x: Txn, fit: ReturnType<typeof beforeImport>): Txn | undefined {
  if (!fit.accounts.has(x.accountId) || (x.transferAccountId && !x.transferAccountId.startsWith("outside:") && !fit.accounts.has(x.transferAccountId))) return undefined;
  const cat = (c?: string) => (c && fit.categories.has(c) ? c : undefined);
  if (x.splits?.length) return { ...x, splits: x.splits.map((p) => ({ ...p, categoryId: cat(p.categoryId) ?? "" })) };
  if (x.categoryId && !cat(x.categoryId)) {
    const { categoryId: _, ...rest } = x;
    return rest;
  }
  return x;
}

/** Added since the import by you (not YNAB's), and not deleted. */
const yoursSince = (current: Txn[], s: Pick<ImportSnapshot, "had">) => {
  const had = new Set(s.had);
  return current.filter((x) => !x.deleted && !had.has(x.id) && x.source !== "ynab" && !x.id.startsWith("start:"));
};

/**
 * Transactions as they were before the import: the ones it changed come back as they were, and ones
 * that weren't there before (the import's, and ones you added since) are marked deleted, so the change
 * syncs. With `keepAdded`, ones you added since stay where their account was there before the import.
 * Your own edits since to transactions you already had are kept.
 */
export function undoImportTxns(current: Txn[], s: Pick<ImportSnapshot, "had" | "before" | "plan">, stamp: number, keepAdded = false): Txn[] {
  const had = new Set(s.had);
  const was = new Map(s.before.map((x) => [x.id, x]));
  const mine = keepAdded ? new Set(yoursSince(current, s).map((x) => x.id)) : new Set<string>();
  const fit = keepAdded ? beforeImport(s.plan) : null;
  const out = current.map((x) => {
    const b = was.get(x.id);
    if (b) return { ...b, updatedAt: stamp };
    if (had.has(x.id) || x.deleted) return x;
    const kept = fit && mine.has(x.id) ? keepable(x, fit) : undefined;
    if (kept) return kept === x ? x : { ...kept, updatedAt: stamp };
    return { ...x, deleted: true, updatedAt: stamp };
  });
  const have = new Set(current.map((x) => x.id));
  for (const b of s.before) if (!have.has(b.id)) out.push({ ...b, updatedAt: stamp });
  return out;
}

/** Transactions you added since the import: how many could stay after an undo, and how many couldn't. */
export function addedSinceImport(current: Txn[], s: Pick<ImportSnapshot, "had" | "plan">): { keep: number; remove: number } {
  const fit = beforeImport(s.plan);
  const mine = yoursSince(current, s);
  const keep = mine.filter((x) => keepable(x, fit)).length;
  return { keep, remove: mine.length - keep };
}

/** The YNAB import as a backup file carries it: when it happened, the last update, and its undo copy. */
export type ImportBackup = { importedAt: number; syncedAt?: number; undo?: ImportSnapshot };

/**
 * A backup's YNAB import, checked. Null when the backup has none (or it's unreadable): restoring it then
 * leaves no import behind, so an undo copy from before can't be applied to the restored plan. The undo
 * copy comes back only while it can still be used.
 */
export function readImportBackup(raw: unknown, now: number): ImportBackup | null {
  const r = raw as { importedAt?: unknown; syncedAt?: unknown; undo?: { at?: unknown; plan?: unknown; had?: unknown; before?: unknown } } | null | undefined;
  if (!r || typeof r !== "object" || typeof r.importedAt !== "number") return null;
  const syncedAt = typeof r.syncedAt === "number" ? r.syncedAt : undefined;
  let undo: ImportSnapshot | undefined;
  if (r.undo && typeof r.undo.at === "number" && canUndoImport({ at: r.undo.at }, now)) {
    const plan = PlanStateSchema.safeParse(r.undo.plan);
    if (plan.success) undo = parseUndo(r.undo, withProperties(plan.data));
  }
  return { importedAt: r.importedAt, ...(syncedAt ? { syncedAt } : {}), ...(undo ? { undo } : {}) };
}
