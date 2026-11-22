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
import { buildImport, categoryKey, recentMonths, suggestCategory, suggestChoice, ynabAccounts, ynabCategories, ynabIdsByAccount, type AccountChoice, type CategoryChoice, type YnabData } from "./ynab";

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
  /** Accounts the update would change a lot: check before updating (it may have the wrong YNAB account). */
  warnings: UpdateWarning[];
};

/** One account an update would change a lot: many of its transactions gone, or older ones than it has. */
export type UpdateWarning = { accountId: string; ynab: string; gone: number; older: number };

/** What it takes to undo an update: the transactions it changed, as they were, and the ones it added. */
export type UpdateSnapshot = { at: number; before: Txn[]; added: string[]; syncedBefore?: number };

/**
 * What an undo did, so the next update can tell its marks from yours: `was` holds each row it put back
 * with the edit time it had before (the undo had to stamp it now so it syncs), `removed` the rows it took
 * out again. A row still carrying the undo's stamp `at` hasn't been touched since.
 */
export type UndoMark = { at: number; was: Record<string, number>; removed: string[] };

/** How long an update can be undone. */
export const UPDATE_UNDO_DAYS = 30;
export const canUndoUpdate = (u: { at: number } | undefined, now: number) => !!u && now - u.at < UPDATE_UNDO_DAYS * 86_400_000;

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
export function planYnabUpdate(plan: PlanState, d: YnabData, txns: Txn[], lastSync: number, thisMonth: string, newId?: () => string, undo?: UndoMark): YnabUpdate {
  // a row the last undo put back or took out (and nobody touched since) is YNAB's as before, not an edit of yours
  const byUndo = (t: Txn) => !!undo && t.updatedAt === undo.at;
  const editedAt = (t: Txn) => (byUndo(t) && undo!.was[t.id] !== undefined ? undo!.was[t.id]! : t.updatedAt);
  const edited = (t: Txn) => editedAt(t) > lastSync;
  const undoRemoved = new Set(undo?.removed ?? []);
  const reAddable = (t: Txn) => t.deleted && undoRemoved.has(t.id) && byUndo(t);
  const fromYnab = txns.filter((t) => !t.deleted && t.source === "ynab" && !t.id.startsWith("start:"));
  const from = fromYnab.reduce((m, t) => (ym(t.date) < m ? ym(t.date) : m), thisMonth);

  // accounts: first where each one's transactions already are (the import may have put a YNAB account
  // into one of yours with another name, and an old closed account can have the name yours has); then,
  // for the rest, the same name. Others are skipped, never added
  const taken = new Set<string>();
  const accounts: Record<string, AccountChoice> = {};
  const skippedAccounts: string[] = [];
  const yours = new Set([...plan.accounts.map((a) => a.id), ...plan.debts.map((x) => x.id)]);
  const whereIs = new Map<string, string>();
  for (const t of txns) if (t.source === "ynab" && !t.deleted) { whereIs.set(t.id, t.accountId); if (t.importId) whereIs.set(t.importId, t.accountId); }
  const ids = ynabIdsByAccount(d);
  const all = ynabAccounts(d);
  const held = new Set<string>(); // went in as history (or nowhere): never matched by name
  // each YNAB account's best guess; the one holding the most transactions gets an account first
  const best = all.flatMap((a) => {
    const votes = new Map<string, number>();
    for (const id of ids.get(a.name) ?? []) { const at = whereIs.get(id); if (at) votes.set(at, (votes.get(at) ?? 0) + 1); }
    const [top] = [...votes.entries()].sort((x, y) => y[1] - x[1]);
    return top ? [{ name: a.name, at: top[0], n: top[1] }] : [];
  });
  for (const b of best.sort((x, y) => y.n - x.n)) {
    if (yours.has(b.at) && !taken.has(b.at)) { taken.add(b.at); accounts[b.name] = { action: "match", id: b.at }; }
    else if (!yours.has(b.at)) held.add(b.name);
  }
  for (const a of all) {
    if (accounts[a.name]) continue;
    const sug = held.has(a.name) ? undefined : suggestChoice(plan, a, taken);
    if (sug?.action === "match") { taken.add(sug.id); accounts[a.name] = sug; }
    else { accounts[a.name] = { action: "skip" }; skippedAccounts.push(a.name); }
  }
  // categories: yours (same name, hidden ones too); a new one comes in hidden
  const categoryMap: Record<string, CategoryChoice> = {};
  for (const c of ynabCategories(d, recentMonths(thisMonth))) {
    const sug = suggestCategory(plan, c);
    categoryMap[categoryKey(c.group, c.name)] = sug.action === "new" ? { action: "hidden" } : sug;
  }
  const r = buildImport(structuredClone(plan), d, { from, thisMonth, accounts, categories: {}, categoryMap, removeEmpty: false, existing: txns, replaceMatching: true, newId, history: true });

  // deleted ones too: one you deleted here stays deleted (but one the undo took out can come back)
  const have = new Set(txns.filter((t) => !reAddable(t)).flatMap((t) => [t.id, ynabId(t)]));
  const incoming = r.txns.filter((t) => t.source === "ynab" && !t.id.startsWith("start:"));
  const fresh = incoming.filter((t) => !have.has(t.id));
  const now = new Set(incoming.map((t) => t.id));
  const matched = new Set(Object.values(accounts).flatMap((c) => (c.action === "match" ? [c.id] : [])));
  // gone from YNAB: only in accounts the export still covers, and months it covers
  const covered = (t: Txn) => ym(t.date) >= from && matched.has(t.accountId) && !now.has(ynabId(t));
  const missing = fromYnab.filter(covered);
  // one you deleted here that YNAB then changed: matched too, so it stays deleted instead of coming back
  const deletedHere = txns.filter((t) => t.deleted && !reAddable(t) && t.source === "ynab" && !t.id.startsWith("start:") && covered(t));

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
    } else if (edited(old)) {
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
  // a lot changing in one account (many gone, or older than anything it has) is worth a look first
  const warnings: UpdateWarning[] = [];
  for (const [name, c] of Object.entries(accounts)) {
    if (c.action !== "match") continue;
    const mine = fromYnab.filter((t) => t.accountId === c.id && ym(t.date) >= from);
    const gone = left.filter((t) => t.accountId === c.id).length;
    const first = txns.filter((t) => !t.deleted && t.accountId === c.id && !t.id.startsWith("start:")).reduce((m, t) => (t.date < m ? t.date : m), "9999");
    const older = add.filter((t) => t.accountId === c.id && t.date < first).length;
    if ((gone >= 10 && gone >= mine.length * 0.2) || older >= 10) warnings.push({ accountId: c.id, ynab: name, gone, older });
  }
  // only the hidden categories something new or changed uses
  const used = new Set([...add, ...changed, ...changedBoth].flatMap((t) => [t.categoryId, ...(t.splits ?? []).map((s) => s.categoryId)]));
  return {
    add,
    changed,
    changedBoth,
    gone: left.filter((t) => !edited(t)),
    keptEdited: left.filter(edited),
    replaced: r.matches.filter((m) => addIds.has(m.ynab.id)).map((m) => m.mine.id),
    hiddenAdded: r.plan.budget.filter((b) => b.hidden && !plan.budget.some((x) => x.id === b.id) && used.has(b.id)),
    skippedAccounts,
    history: add.filter((t) => isHistoryTxn(t)).length,
    from,
    warnings,
  };
}

/**
 * Transactions after the update. Changed ones are written over (keeping their id here), new ones come
 * in, gone ones are removed if `removeGone`, and ones of YNAB's you changed here since `lastSync` that
 * YNAB no longer has become your own (so a later update never removes them).
 */
export function applyYnabUpdate(txns: Txn[], u: YnabUpdate, lastSync: number, removeGone: boolean, stamp: number): Txn[] {
  const remove = new Set([...(removeGone ? u.gone.map((t) => t.id) : []), ...u.replaced]);
  // an added one that's already here (an undo took it out): it comes back in its place
  const over = new Map([...u.changed, ...u.changedBoth, ...u.add].map((t) => [t.id, t]));
  const here = new Set(txns.map((t) => t.id));
  const kept = new Set(u.keptEdited.map((t) => t.id));
  const out = txns.map((t) => {
    const next = over.get(t.id);
    if (next) return { ...next, updatedAt: stamp };
    if (t.deleted) return t;
    if (remove.has(t.id)) return { ...t, deleted: true, updatedAt: stamp };
    if (kept.has(t.id)) return { ...t, source: "manual" as const, updatedAt: stamp };
    return t;
  });
  return [...out, ...u.add.filter((t) => !here.has(t.id)).map((t) => ({ ...t, updatedAt: stamp }))];
}

/** The undo for an update: every transaction it changed (as it was before) and every one it added. */
export function snapshotUpdate(before: Txn[], after: Txn[], at: number, syncedBefore?: number): UpdateSnapshot {
  const was = new Map(before.map((t) => [t.id, t]));
  const changed: Txn[] = [];
  const added: string[] = [];
  for (const t of after) {
    const old = was.get(t.id);
    if (!old) added.push(t.id);
    else if (old !== t) changed.push(old);
  }
  return { at, before: changed, added, ...(syncedBefore ? { syncedBefore } : {}) };
}

/**
 * Undo an update: the ones it changed go back to how they were, the ones it added are deleted (stamped
 * now, so it syncs). One you changed after the update (on any device) stays as you left it: `kept`.
 */
export function undoYnabUpdate(txns: Txn[], snap: UpdateSnapshot, stamp: number): { txns: Txn[]; kept: number; mark: UndoMark } {
  const back = new Map(snap.before.map((t) => [t.id, t]));
  const added = new Set(snap.added);
  const mark: UndoMark = { at: stamp, was: {}, removed: [] };
  let kept = 0;
  const out = txns.map((t) => {
    const old = back.get(t.id);
    if (!old && !added.has(t.id)) return t;
    if (t.updatedAt > snap.at) { kept++; return t; } // changed since the update: yours
    if (old) { mark.was[t.id] = old.updatedAt; return { ...old, updatedAt: stamp }; }
    if (t.deleted) return t;
    mark.removed.push(t.id);
    return { ...t, deleted: true, updatedAt: stamp };
  });
  return { txns: out, kept, mark };
}
