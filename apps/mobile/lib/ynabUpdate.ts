/**
 * Update transactions from a newer YNAB export, after the import (for using both apps side by side for
 * a while). Only transactions change: categories, amounts, groups and accounts stay as you have them.
 *
 * YNAB's export has no transaction ids, so each one's id comes from its details (see stableId in
 * ynab.ts): one edited in YNAB (a category, a memo, a tip on the amount) gets a new id there. Matching
 * finds those: one gone from YNAB and one new there with the same account, date and payee (and amount,
 * or the only such pair) are the same transaction, changed. It's updated in place, keeping its id here,
 * and its `importId` becomes YNAB's new one so the next update knows it.
 */
import { isHistoryTxn, type BudgetItem, type PlanState, type Txn } from "@coastfi/engine";
import { buildImport, categoryKey, recentMonths, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, type AccountChoice, type CategoryChoice, type YnabData } from "./ynab";

export type YnabUpdate = {
  /** New in YNAB since. */
  add: Txn[];
  /** Changed in YNAB: the new version, under the id it has here (written over it). */
  changed: Txn[];
  /** Changed in YNAB and here since the last update: yours kept (blanks filled from YNAB). */
  changedBoth: Txn[];
  /** Gone from YNAB (deleted there), and not changed here: removed when you say so. */
  gone: Txn[];
  /** Gone from YNAB, but you changed them here: yours stay (they become your own). */
  keptEdited: Txn[];
  /** Your own transactions that are the same as a new YNAB one (deleted, like at import). */
  replaced: string[];
  /** YNAB categories you don't have here: they come in hidden. */
  hiddenAdded: BudgetItem[];
  /** YNAB accounts not in your budget: not added. A cash account's or card's transactions come in as history. */
  skippedAccounts: string[];
  /** How many of `add` are history from accounts not here (closed ones). */
  history: number;
  /** The months looked at: from the first month YNAB's transactions here start. */
  from: string;
};

const ym = (d: string) => d.slice(0, 7);
/** The id YNAB knows it by now (its importId, once an update changed it in place). */
const ynabId = (t: Txn) => t.importId ?? t.id;
const uncategorized = (t: Txn) => !t.categoryId && !t.splits?.length && !t.transferAccountId;

/**
 * Pairs each transaction gone from YNAB with the new one it became: first the same account, date,
 * payee, amount and transfer; then, for an amount changed (a tip), the same account, date, payee and
 * transfer when that's the only one gone and the only one new.
 */
export function pairChanged(gone: Txn[], fresh: Txn[]): [Txn, Txn][] {
  const pairs: [Txn, Txn][] = [];
  const usedG = new Set<Txn>();
  const usedF = new Set<Txn>();
  const base = (t: Txn) => [t.accountId, t.date, (t.payee ?? "").trim().toLowerCase(), t.transferAccountId ?? ""].join("|");
  const keys = [(t: Txn) => `${base(t)}|${t.amount.toFixed(2)}`, base];
  keys.forEach((key, pass) => {
    const by = new Map<string, { g: Txn[]; f: Txn[] }>();
    const slot = (k: string) => by.get(k) ?? (by.set(k, { g: [], f: [] }), by.get(k)!);
    for (const t of gone) if (!usedG.has(t)) slot(key(t)).g.push(t);
    for (const t of fresh) if (!usedF.has(t)) slot(key(t)).f.push(t);
    for (const { g, f } of by.values()) {
      if (pass === 1 && (g.length !== 1 || f.length !== 1)) continue;
      for (let i = 0; i < Math.min(g.length, f.length); i++) {
        pairs.push([g[i]!, f[i]!]);
        usedG.add(g[i]!);
        usedF.add(f[i]!);
      }
    }
  });
  return pairs;
}

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
  const r = buildImport(structuredClone(plan), d, { from, thisMonth, accounts, categories: {}, categoryMap, removeEmpty: false, existing: txns, replaceMatching: true, newId, history: true });

  const have = new Set(txns.flatMap((t) => [t.id, ynabId(t)])); // deleted ones too: one you deleted here stays deleted
  const incoming = r.txns.filter((t) => t.source === "ynab" && !t.id.startsWith("start:"));
  const fresh = incoming.filter((t) => !have.has(t.id));
  const now = new Set(incoming.map((t) => t.id));
  const matched = new Set(Object.values(accounts).flatMap((c) => (c.action === "match" ? [c.id] : [])));
  // gone from YNAB: only in accounts the export still covers, and months it covers
  const covered = (t: Txn) => ym(t.date) >= from && matched.has(t.accountId) && !now.has(ynabId(t));
  const missing = fromYnab.filter(covered);
  // one you deleted here that YNAB then changed: matched too, so it stays deleted instead of coming back
  const deletedHere = txns.filter((t) => t.deleted && t.source === "ynab" && !t.id.startsWith("start:") && covered(t));

  const pairs = pairChanged([...missing, ...deletedHere], fresh);
  const paired = new Set(pairs.flatMap(([a, b]) => [a, b]));
  const idHere = new Map(pairs.map(([old, next]) => [next.id, old.id]));
  // a transfer's other side keeps pointing at the right one
  const relink = (t: Txn): Txn => (t.transferId && idHere.has(t.transferId) ? { ...t, transferId: idHere.get(t.transferId)! } : t);

  const changed: Txn[] = [];
  const changedBoth: Txn[] = [];
  for (const [old, next] of pairs) {
    if (old.deleted) {
      changed.push({ ...old, importId: next.id });
    } else if (old.updatedAt > lastSync) {
      // changed in both: yours stays; YNAB fills only what you left blank (a category, a memo)
      const fill: Partial<Txn> = {};
      if (uncategorized(old) && !uncategorized(next)) Object.assign(fill, { categoryId: next.categoryId, splits: next.splits, originalCategory: next.originalCategory });
      if (!old.memo && next.memo) fill.memo = next.memo;
      changedBoth.push({ ...old, ...fill, importId: next.id });
    } else {
      changed.push(relink({ ...next, id: old.id, importId: next.id, transferId: old.transferId ?? next.transferId }));
    }
  }

  const add = fresh.filter((t) => !paired.has(t)).map(relink);
  const addIds = new Set(add.map((t) => t.id));
  const left = missing.filter((t) => !paired.has(t));
  // only the hidden categories something new or changed uses
  const used = new Set([...add, ...changed, ...changedBoth].flatMap((t) => [t.categoryId, ...(t.splits ?? []).map((s) => s.categoryId)]));
  return {
    add,
    changed,
    changedBoth,
    gone: left.filter((t) => t.updatedAt <= lastSync),
    keptEdited: left.filter((t) => t.updatedAt > lastSync),
    replaced: r.matches.filter((m) => addIds.has(m.ynab.id)).map((m) => m.mine.id),
    hiddenAdded: r.plan.budget.filter((b) => b.hidden && !plan.budget.some((x) => x.id === b.id) && used.has(b.id)),
    skippedAccounts,
    history: add.filter((t) => isHistoryTxn(t)).length,
    from,
  };
}

/**
 * Transactions after the update. Changed ones are written over (keeping their id here), new ones come
 * in, gone ones are removed if `removeGone`, and ones of YNAB's you changed here since `lastSync` that
 * YNAB no longer has become your own (so a later update never removes them).
 */
export function applyYnabUpdate(txns: Txn[], u: YnabUpdate, lastSync: number, removeGone: boolean, stamp: number): Txn[] {
  const remove = new Set([...(removeGone ? u.gone.map((t) => t.id) : []), ...u.replaced]);
  const over = new Map([...u.changed, ...u.changedBoth].map((t) => [t.id, t]));
  const kept = new Set(u.keptEdited.map((t) => t.id));
  const out = txns.map((t) => {
    const next = over.get(t.id);
    if (next) return { ...next, updatedAt: stamp };
    if (t.deleted) return t;
    if (remove.has(t.id)) return { ...t, deleted: true, updatedAt: stamp };
    if (kept.has(t.id)) return { ...t, source: "manual" as const, updatedAt: stamp };
    return t;
  });
  return [...out, ...u.add.map((t) => ({ ...t, updatedAt: stamp }))];
}
