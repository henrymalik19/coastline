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

const STOP = new Set(["the", "a", "an"]);
/** What names that look alike share: the first real word, letters only ("CHICK-FIL-A #123" → "chick"). */
export function payeeKey(name: string): string {
  const words = name.toLowerCase().split(/[\s*#/&.,'-]+/).map((w) => w.replace(/[^a-z]/g, "")).filter((w) => w && !STOP.has(w));
  return words[0] && words[0].length >= 3 ? words[0] : "";
}

/** Payees that look like the same one written different ways (most used first), for combining. */
export function similarPayees(payees: Map<string, PayeeInfo>): PayeeInfo[][] {
  const by = new Map<string, PayeeInfo[]>();
  for (const p of payees.values()) {
    const k = payeeKey(p.name);
    if (k) by.set(k, [...(by.get(k) ?? []), p]);
  }
  return [...by.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => b.count - a.count || a.name.length - b.name.length || b.last - a.last)).sort((a, b) => b.length - a.length);
}

/** Every transaction paid to one of `from` (any casing) now says `to`. Returns the same list if nothing changed. */
export function renamePayeesIn<T extends { payee?: string; deleted?: boolean; updatedAt: number; id: string }>(txns: T[], from: string[], to: string, stamp: number): T[] {
  const names = new Set(from.map((x) => x.trim().toLowerCase()));
  const name = to.trim();
  if (!name) return txns;
  let changed = false;
  const out = txns.map((t) => {
    if (t.deleted || t.id.startsWith("start:") || !t.payee || !names.has(t.payee.trim().toLowerCase()) || t.payee === name) return t;
    changed = true;
    return { ...t, payee: name, updatedAt: stamp };
  });
  return changed ? out : txns;
}
