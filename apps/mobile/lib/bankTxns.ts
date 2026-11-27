/**
 * Transactions from your banks (Plaid), merged into yours. No store, no network.
 *
 * Who owns what: the bank owns the amount, the date and whether it's still pending; you own the payee,
 * category, memo and splits, and nothing from the bank writes over them. A new one is held for review
 * (listed, not counted) until you accept it.
 *
 * Each one's id here is "bank:" + the bank's first id for it, so every device makes the same one. When a
 * pending one posts, the bank gives it a new id (pointing back at the pending one): the same transaction
 * here takes the new id as its `importId`, and keeps what you set.
 *
 * One you already have (typed in, or from YNAB) with the same account and amount within a few days is
 * the same purchase: it becomes the bank's, keeping what you set (and YNAB's id, so a YNAB import finds
 * it rather than adding it again).
 */
import { isStartTxn, startTxnId, type PlanState, type Txn } from "@coastfi/engine";
import { isCard } from "./register";

/** One bank transaction as the server keeps it (latest state). Amount as Plaid gives it: money out is positive. */
export type BankTxn = {
  transactionId: string;
  /** Plaid's account id. */
  accountId: string;
  /** "YYYY-MM-DD" */
  date: string;
  amount: number;
  name: string;
  merchantName?: string | null;
  pending: boolean;
  /** A posted one's pending one, when it had one. */
  pendingTransactionId?: string | null;
  /** The bank took it back (a pending one that never posted, or a correction). */
  removed?: boolean;
};

export const BANK_ID = "bank:";
/** How far apart (days) the bank's date and yours can be for the same purchase. */
export const MATCH_DAYS = 4;

const cents = (v: number) => Math.round(v * 100) / 100;
const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
const uncategorized = (t: Txn) => !t.categoryId && !t.splits?.length;

/** Your plan's account (or card) for each matched bank account. */
export function bankAccountMap(p: Pick<PlanState, "accounts" | "debts">): Map<string, string> {
  const m = new Map<string, string>();
  for (const a of p.accounts) if (a.plaidAccountId) m.set(a.plaidAccountId, a.id);
  for (const d of p.debts) if (d.plaidAccountId) m.set(d.plaidAccountId, d.id);
  return m;
}

/** Each matched account's bank start date (`bankFrom`): from that day on, its transactions are the bank's. */
export function bankFromMap(p: Pick<PlanState, "accounts" | "debts">): Map<string, string> {
  const m = new Map<string, string>();
  for (const x of [...p.accounts, ...p.debts]) if (x.plaidAccountId && x.bankFrom) m.set(x.id, x.bankFrom);
  return m;
}

/** How far back (days) a bank account's transactions start when you have none here for it yet. */
export const BANK_BACK_DAYS = 30;
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The first day a bank transaction can come into an account: only one whose transactions you keep here
 * (it has a starting balance), and only after that balance, which already counts what came before. A
 * starting balance from YNAB is the month before its first day, so that day counts too.
 */
function firstDay(txns: Txn[], accountId: string): string | null {
  const s = txns.find((t) => t.id === startTxnId(accountId) && !t.deleted);
  if (!s) return null;
  if (s.source === "ynab") return s.date;
  return addDays(s.date, 1);
}

/** A bank account's transactions can start on `day` at the earliest BANK_BACK_DAYS back, and no later than today. */
export const bankStartDay = (day: string, today: string) => {
  const earliest = addDays(today, -BANK_BACK_DAYS);
  return day > today ? today : day < earliest ? earliest : day;
};

/** The day a bank-connected account's transactions would start: the one you picked, else the budget's first day. */
export const bankStartFor = (plan: Pick<PlanState, "budgetPlan">, x: { bankFrom?: string }, today: string) => bankStartDay(x.bankFrom ?? `${plan.budgetPlan?.start ?? today.slice(0, 7)}-01`, today);

export type BankStart = { accountId: string; from: string; start?: Txn };

/**
 * Bank start dates for the matched accounts in `rows` that need one (cash accounts and cards, once the
 * budget has started):
 * - One with transactions here already (from YNAB, or typed in): from the day of its newest one (that day
 *   overlaps, and the same purchase links), at most BANK_BACK_DAYS back. What came before stays as it is.
 * - One without (new, or the budget started over): it starts on the budget's first day, at most
 *   BANK_BACK_DAYS back, with what it held then: the bank's balance now (`current`, by Plaid account id)
 *   less what's posted since. Pending ones aren't in the bank's balance yet, so they count on top, as
 *   in the bank's own available balance.
 */
export function bankStarts(plan: PlanState, txns: Txn[], rows: BankTxn[], current: Map<string, number>, today: string, stamp: number): BankStart[] {
  if (!plan.budgetPlan) return [];
  const accounts = bankAccountMap(plan);
  const earliest = addDays(today, -BANK_BACK_DAYS);
  const out: BankStart[] = [];
  for (const pid of new Set(rows.map((r) => r.accountId))) {
    const id = accounts.get(pid);
    const cash = plan.accounts.find((a) => a.id === id && a.type === "cash");
    const card = plan.debts.find((d) => d.id === id && isCard(d));
    if (!id || (!cash && !card)) continue;
    if (txns.some((t) => t.id === startTxnId(id) && !t.deleted)) {
      if ((cash ?? card)!.bankFrom) continue;
      const newest = txns.reduce<string | null>((m, t) => (!t.deleted && t.accountId === id && !isStartTxn(t) && t.date <= today && (!m || t.date > m) ? t.date : m), null) ?? firstDay(txns, id) ?? today;
      out.push({ accountId: id, from: newest < earliest ? earliest : newest > today ? today : newest });
      continue;
    }
    // the day you picked, else the budget's first day; never more than BANK_BACK_DAYS back
    const want = (cash ?? card)!.bankFrom ?? `${plan.budgetPlan.start}-01`;
    const from = bankStartDay(want, today);
    // a card's balance here is what you owe, as a negative
    const now = current.has(pid) ? (card ? -current.get(pid)! : current.get(pid)!) : cash ? cash.balance : -card!.balance;
    const posted = rows.filter((r) => r.accountId === pid && !r.removed && !r.pending && r.date >= from && r.date <= today).reduce((a, r) => a - r.amount, 0);
    out.push({
      accountId: id, from,
      start: { id: startTxnId(id), accountId: id, date: from, amount: cents(now - posted), payee: "Starting balance", ...(cash ? { categoryId: "ready" } : {}), cleared: "reconciled", source: "manual", updatedAt: stamp },
    });
  }
  return out;
}

const cleared = (pending: boolean, was?: Txn["cleared"]): Txn["cleared"] => (was === "reconciled" ? "reconciled" : pending ? "uncleared" : "cleared");

export type BankMerge = { txns: Txn[]; added: number; updated: number; linked: number; removed: number };

/**
 * Your transactions with the bank's merged in. Running it again with the same rows changes nothing (and
 * stamps nothing), so devices agree.
 */
export function mergeBankTxns(txns: Txn[], plan: Pick<PlanState, "accounts" | "debts">, rows: BankTxn[], stamp: number): BankMerge {
  const out = new Map(txns.map((t) => [t.id, t]));
  const accounts = bankAccountMap(plan);
  const res = { added: 0, updated: 0, linked: 0, removed: 0 };
  // the bank's id → yours (deleted ones too, so one you deleted never comes back)
  const byBank = new Map<string, string>();
  for (const t of txns) if (t.source === "plaid" && t.importId) byBank.set(t.importId, t.id);
  // from the account's bank start date when it has one (and still keeps transactions here)
  const bankFrom = bankFromMap(plan);
  const first = new Map<string, string | null>();
  const startOf = (id: string) => {
    if (!first.has(id)) {
      const day = firstDay(txns, id);
      first.set(id, day && bankFrom.has(id) ? bankFrom.get(id)! : day);
    }
    return first.get(id)!;
  };
  const relinks = new Map<string, string>();
  const put = (t: Txn) => out.set(t.id, t);

  // posted before taken back: a pending one that posted is in the new one, not removed
  const ordered = [...rows].sort((a, b) => Number(!!a.removed) - Number(!!b.removed));
  for (const r of ordered) {
    const mine = byBank.get(r.transactionId) ?? (r.pendingTransactionId ? byBank.get(r.pendingTransactionId) : undefined);
    const have = mine ? out.get(mine) : undefined;
    if (r.removed) {
      if (!have || have.deleted || have.importId !== r.transactionId) continue;
      // also in YNAB: it stays as YNAB's, just no longer the bank's
      if (have.ynabId) put({ ...have, source: "ynab", id: have.id, importId: have.ynabId, updatedAt: stamp });
      else put({ ...have, deleted: true, updatedAt: stamp });
      res.removed++;
      continue;
    }
    const amount = cents(-r.amount);
    if (have) {
      byBank.set(r.transactionId, have.id);
      if (have.deleted) {
        if (have.importId !== r.transactionId) put({ ...have, importId: r.transactionId, updatedAt: stamp });
        continue;
      }
      const c = cleared(r.pending, have.cleared);
      if (sameAmount(have.amount, amount) && have.date === r.date && have.cleared === c && have.importId === r.transactionId) continue;
      const next: Txn = { ...have, amount, date: r.date, cleared: c, importId: r.transactionId, updatedAt: stamp };
      // a split that no longer adds up (a tip went on): yours to look at again
      if (have.splits?.length && !sameAmount(have.amount, amount)) next.review = true;
      put(next);
      res.updated++;
      continue;
    }
    const acct = accounts.get(r.accountId);
    const from = acct ? startOf(acct) : null;
    if (!acct || !from || r.date < from) continue;
    const id = BANK_ID + r.transactionId;
    byBank.set(r.transactionId, id);
    const base = { id, accountId: acct, date: r.date, amount, cleared: cleared(r.pending), source: "plaid" as const, importId: r.transactionId, updatedAt: stamp };
    // the same purchase already here (typed in, or from YNAB): the closest date wins
    const same = [...out.values()]
      .filter((t) => !t.deleted && t.accountId === acct && t.source !== "plaid" && !isStartTxn(t) && sameAmount(t.amount, amount) && days(t.date, r.date) <= MATCH_DAYS)
      .sort((a, b) => days(a.date, r.date) - days(b.date, r.date) || a.id.localeCompare(b.id))[0];
    if (same) {
      const { id: _old, accountId: _a, date: _d, amount: _m, cleared: _c, source, importId, updatedAt: _u, deleted: _x, ...yours } = same;
      put({ ...yours, ...base, ...(source === "ynab" ? { ynabId: importId ?? same.id } : same.ynabId ? { ynabId: same.ynabId } : {}) });
      put({ ...same, deleted: true, updatedAt: stamp });
      relinks.set(same.id, id);
      res.linked++;
      continue;
    }
    put({ ...base, payee: (r.merchantName || r.name || "").trim() || undefined, review: true });
    res.added++;
  }
  // a transfer's other side points at the one that took its place
  if (relinks.size)
    for (const t of out.values())
      if (t.transferId && relinks.has(t.transferId)) put({ ...t, transferId: relinks.get(t.transferId)!, updatedAt: stamp });
  return { txns: dedupeBank([...out.values()], stamp), ...res };
}

/**
 * The same bank transaction twice (two devices each brought it in before syncing): the one with the
 * lowest id stays, so every device keeps the same one.
 */
export function dedupeBank(txns: Txn[], stamp: number): Txn[] {
  const keep = new Map<string, string>();
  for (const t of txns)
    if (t.source === "plaid" && t.importId && !t.deleted) {
      const k = keep.get(t.importId);
      if (!k || t.id < k) keep.set(t.importId, t.id);
    }
  return txns.map((t) => (t.source === "plaid" && t.importId && !t.deleted && keep.get(t.importId) !== t.id ? { ...t, deleted: true, updatedAt: stamp } : t));
}

/**
 * YNAB's transactions, linked to the bank's where they're the same purchase. One already linked (its
 * YNAB id is on a bank one) isn't added again; one with the same account and amount within a few days
 * links to that bank one, which takes YNAB's payee, category and memo if you haven't set them. `rest`
 * is what's left to add as YNAB's; `linked` are the bank ones that changed.
 *
 * In an account with a bank start date (`bankFrom`: account id → day), YNAB's from that day on are the
 * bank's to bring in: one that doesn't link to a bank one isn't added (`skipped`).
 */
export function linkYnabToBank(existing: Txn[], ynab: Txn[], stamp: number, bankFrom: Map<string, string> = new Map()): { rest: Txn[]; linked: Txn[]; skipped: number } {
  const bank = existing.filter((t) => t.source === "plaid" && !t.deleted);
  if (!bank.length && !bankFrom.size) return { rest: ynab, linked: [], skipped: 0 };
  const known = new Set(bank.flatMap((t) => (t.ynabId ? [t.ynabId] : [])));
  const changed = new Map<string, Txn>();
  const to = new Map<string, string>(); // YNAB's id → the bank one's
  const dropped = new Set<string>();
  const rest: Txn[] = [];
  const bankDays = (y: Txn) => bankFrom.has(y.accountId) && y.date >= bankFrom.get(y.accountId)!;
  for (const y of ynab) {
    const yid = y.importId ?? y.id;
    if (isStartTxn(y) || y.source !== "ynab") { rest.push(y); continue; }
    if (known.has(yid)) {
      const b = bank.find((t) => t.ynabId === yid)!;
      to.set(y.id, b.id);
      continue;
    }
    const hit = bank
      .filter((t) => !t.ynabId && !changed.has(t.id) && t.accountId === y.accountId && sameAmount(t.amount, y.amount) && days(t.date, y.date) <= MATCH_DAYS)
      .sort((a, b) => days(a.date, y.date) - days(b.date, y.date) || a.id.localeCompare(b.id))[0];
    if (!hit) {
      if (bankDays(y)) dropped.add(y.id);
      else rest.push(y);
      continue;
    }
    const next: Txn = { ...hit, ynabId: yid, updatedAt: stamp };
    // still as the bank brought it (not looked at): YNAB's details fill it in
    if (hit.review && uncategorized(hit) && !hit.memo) {
      if (y.payee) next.payee = y.payee;
      if (y.memo) next.memo = y.memo;
      for (const k of ["categoryId", "splits", "originalCategory", "transferAccountId", "transferId", "trackedAmount"] as const) if (y[k] !== undefined) (next as Record<string, unknown>)[k] = y[k];
      if (y.review) next.review = true;
      else delete next.review;
    }
    changed.set(hit.id, next);
    to.set(y.id, hit.id);
  }
  // a transfer's other side points at the bank one that took its place (or at nothing, when that side
  // wasn't added: it's still a transfer to that account)
  const relink = (t: Txn): Txn => {
    if (!t.transferId) return t;
    if (to.has(t.transferId)) return { ...t, transferId: to.get(t.transferId)! };
    if (dropped.has(t.transferId)) { const { transferId: _x, ...u } = t; return u; }
    return t;
  };
  return { rest: rest.map(relink), linked: [...changed.values()].map(relink), skipped: dropped.size };
}
