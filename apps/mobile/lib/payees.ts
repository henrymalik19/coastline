import type { Txn } from "@coastfi/engine";

/** A payee you've used: how you wrote it last, the category it had last, how often and when. */
export type PayeeInfo = { name: string; categoryId?: string; count: number; last: number };

/** Every payee in your transactions, by its lowercase name. */
export function buildPayees(txns: (Pick<Txn, "payee" | "categoryId" | "deleted" | "updatedAt"> & { id?: string })[]): Map<string, PayeeInfo> {
  const m = new Map<string, PayeeInfo>();
  // an account's automatic "Starting balance" isn't a payee you'd pick
  const real = txns.filter((y) => !y.deleted && y.payee?.trim() && !y.id?.startsWith("start:"));
  for (const x of real.sort((a, b) => a.updatedAt - b.updatedAt)) {
    const name = x.payee!.trim();
    const key = name.toLowerCase();
    const was = m.get(key);
    // the latest spelling and category win; the count keeps adding up
    m.set(key, { name, categoryId: x.categoryId, count: (was?.count ?? 0) + 1, last: x.updatedAt });
  }
  return m;
}

/**
 * Payees that match what you've typed (2+ letters), anywhere in the name. Names that start with it come
 * first, then ones with a word that does, then the rest; within each, the most used, then the latest.
 */
export function suggestPayees(payees: Map<string, PayeeInfo>, typed: string, limit = 5): PayeeInfo[] {
  const q = typed.trim().toLowerCase();
  if (q.length < 2) return [];
  const rank = (key: string) => (key.startsWith(q) ? 0 : key.split(/[\s\-/&.]+/).some((w) => w.startsWith(q)) ? 1 : 2);
  return [...payees.entries()]
    .filter(([key]) => key !== q && key.includes(q))
    .sort(([a, x], [b, y]) => rank(a) - rank(b) || y.count - x.count || y.last - x.last)
    .slice(0, limit)
    .map(([, info]) => info);
}
