/**
 * The outbox: the ids of transactions changed on this device and not yet confirmed by the server.
 * Uploads send exactly these, and an id leaves only once its upload succeeded and the row wasn't
 * edited again meanwhile. Nothing depends on clocks, so another device's clock can't hide an edit
 * here (the old "uploaded up to this time" marker could).
 */
import type { Txn } from "@coastfi/engine";

/** Add ids (no duplicates, order kept). */
export function addIds(outbox: string[], ids: string[]): string[] {
  if (!ids.length) return outbox;
  const have = new Set(outbox);
  const more = ids.filter((id) => !have.has(id) && (have.add(id), true));
  return more.length ? [...outbox, ...more] : outbox;
}

/** The ids of transactions that are new or changed (a different object) from `before` to `after`. */
export function changedIds(before: Txn[], after: Txn[]): string[] {
  const old = new Map(before.map((t) => [t.id, t]));
  return after.filter((t) => old.get(t.id) !== t).map((t) => t.id);
}

/**
 * After a batch uploaded: drop the ids that went up, unless the row was edited again while it was
 * on its way (its edit time is no longer the one sent), or it isn't here anymore.
 */
export function afterUpload(outbox: string[], sent: Pick<Txn, "id" | "updatedAt">[], txns: Txn[]): string[] {
  const now = new Map(txns.map((t) => [t.id, t.updatedAt]));
  const done = new Set(sent.filter((s) => now.get(s.id) === s.updatedAt).map((s) => s.id));
  return done.size ? outbox.filter((id) => !done.has(id)) : outbox;
}

/**
 * The outbox for a saved copy from before it existed: everything edited after the old "uploaded up to"
 * time (all of it without one, which is what uploading did then too).
 */
export function seedOutbox(txns: Txn[], pushedAt?: number): string[] {
  return txns.filter((t) => pushedAt === undefined || t.updatedAt > pushedAt).map((t) => t.id);
}
