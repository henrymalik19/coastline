/**
 * Update transactions from a newer YNAB export, after the import (for using both apps side by side for
 * a while). Only transactions change: categories, amounts, groups and accounts stay as you have them.
 *
 * YNAB's export has no transaction ids, so each one's id comes from its details (see stableId in
 * ynab.ts): one edited in YNAB shows up as a new transaction, and its old copy as gone from YNAB.
 */
import type { BudgetItem, PlanState, Txn } from "@coastfi/engine";
import { buildImport, categoryKey, recentMonths, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, type AccountChoice, type CategoryChoice, type YnabData } from "./ynab";

export type YnabUpdate = {
  /** New in YNAB since (or changed there). */
  add: Txn[];
  /** Gone from YNAB (deleted or changed there), and not changed here: removed when you say so. */
  gone: Txn[];
  /** Gone from YNAB, but you changed them here: yours stay (they become your own). */
  keptEdited: Txn[];
  /** Your own transactions that are the same as a new YNAB one (deleted, like at import). */
  replaced: string[];
  /** YNAB categories you don't have here: they come in hidden. */
  hiddenAdded: BudgetItem[];
  /** YNAB accounts not in your budget: their transactions are skipped. */
  skippedAccounts: string[];
  /** The months looked at: from the first month YNAB's transactions here start. */
  from: string;
};

const ym = (d: string) => d.slice(0, 7);

/**
 * What an update would do. `lastSync`: when you last imported or updated (anything of YNAB's changed
 * here after that is yours now).
 */
export function planYnabUpdate(plan: PlanState, d: YnabData, txns: Txn[], lastSync: number, thisMonth: string, newId?: () => string): YnabUpdate {
  const fromYnab = txns.filter((t) => !t.deleted && t.source === "ynab" && !t.id.startsWith("start:"));
  const from = fromYnab.reduce((m, t) => (ym(t.date) < m ? ym(t.date) : m), thisMonth);

  // accounts: the ones you have here (same name); others are skipped, never added
  const taken = new Set<string>();
  const accounts: Record<string, AccountChoice> = {};
  const skippedAccounts: string[] = [];
  for (const a of ynabAccounts(d)) {
    const sug = suggestChoice(plan, a, taken);
    if (sug.action === "match") { taken.add(sug.id); accounts[a.name] = sug; }
    else { accounts[a.name] = { action: "skip" }; skippedAccounts.push(a.name); }
  }
  // categories: yours (same name, hidden ones too); a new one comes in hidden
  const categoryMap: Record<string, CategoryChoice> = {};
  for (const c of ynabCategories(d, recentMonths(thisMonth))) {
    const sug = suggestCategory(plan, c);
    categoryMap[categoryKey(c.group, c.name)] = sug.action === "new" ? { action: "hidden" } : sug;
  }
  const r = buildImport(structuredClone(plan), d, { from, thisMonth, accounts, categories: {}, categoryMap, removeEmpty: false, existing: txns, replaceMatching: true, newId });

  const have = new Set(txns.map((t) => t.id)); // deleted ones too: one you deleted here stays deleted
  const incoming = r.txns.filter((t) => t.source === "ynab" && !t.id.startsWith("start:"));
  const add = incoming.filter((t) => !have.has(t.id));
  const addIds = new Set(add.map((t) => t.id));
  const now = new Set(incoming.map((t) => t.id));
  const matched = new Set(Object.values(accounts).flatMap((c) => (c.action === "match" ? [c.id] : [])));
  // only in accounts the export still covers, and months it covers
  const missing = fromYnab.filter((t) => ym(t.date) >= from && matched.has(t.accountId) && !now.has(t.id));
  // only the hidden categories something new uses
  const used = new Set(add.flatMap((t) => [t.categoryId, ...(t.splits ?? []).map((s) => s.categoryId)]));
  return {
    add,
    gone: missing.filter((t) => t.updatedAt <= lastSync),
    keptEdited: missing.filter((t) => t.updatedAt > lastSync),
    replaced: r.matches.filter((m) => addIds.has(m.ynab.id)).map((m) => m.mine.id),
    hiddenAdded: r.plan.budget.filter((b) => b.hidden && !plan.budget.some((x) => x.id === b.id) && used.has(b.id)),
    skippedAccounts,
    from,
  };
}

/**
 * Transactions after the update. Ones of YNAB's you changed here since `lastSync` become your own (so a
 * later update never removes them), new ones come in, and gone ones are removed if `removeGone`.
 */
export function applyYnabUpdate(txns: Txn[], u: YnabUpdate, lastSync: number, removeGone: boolean, stamp: number): Txn[] {
  const remove = new Set([...(removeGone ? u.gone.map((t) => t.id) : []), ...u.replaced]);
  const out = txns.map((t) => {
    if (t.deleted) return t;
    if (remove.has(t.id)) return { ...t, deleted: true, updatedAt: stamp };
    if (t.source === "ynab" && t.updatedAt > lastSync) return { ...t, source: "manual" as const, updatedAt: stamp };
    return t;
  });
  return [...out, ...u.add.map((t) => ({ ...t, updatedAt: stamp }))];
}
