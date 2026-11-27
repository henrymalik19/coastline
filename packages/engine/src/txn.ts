/**
 * Transactions in your budget accounts (checking, savings, credit cards), and what they mean for the
 * budget: money in to assign, money out of categories, and credit-card spending moving into the
 * card's payment category (the envelope way), so the payment is always covered.
 */
import type { SpentAverage, Txn } from "./types";
import { num } from "./util";

/** What a month's transactions do to the budget. */
export type TxnActivity = {
  /** Money in with no job yet ("ready to assign"). */
  income: number;
  /** Money out per category (positive = spent; refunds lower it). */
  spent: Record<string, number>;
  /** Card spending that moves into each card's payment category (`debt:<id>`). */
  cardFunded: Record<string, number>;
  /** Each category's spending on each card (category → card payment key → amount; refunds lower it). */
  cardSpent: Record<string, Record<string, number>>;
  /**
   * Money in or out with no category yet (not a transfer, not an account's starting balance): it comes
   * out of (or goes into) ready to assign until it gets one, so ready to assign follows your money.
   * Negative = spent. Not part of `income`.
   */
  uncategorized: number;
};

const ymOf = (date: string) => date.slice(0, 7);

/**
 * A month's activity. `cards` maps a credit card's account id (its debt id) to its payment category key.
 * Transfers between budget accounts don't touch categories, except a payment to a card, which spends
 * from that card's payment category. A transfer out to an account you don't budget (an IRA, a loan)
 * spends from the category on it.
 */
/**
 * History from an account that isn't here (a closed one left out of an import): its account id is
 * "outside:" plus that account's name. It's kept to look back at, and never counts in the budget.
 */
export const isHistoryTxn = (t: { accountId?: string }): boolean => !!t.accountId && t.accountId.startsWith("outside:");

export function txnActivity(txns: Txn[], month: string, cards: Record<string, string>, asOf?: string): TxnActivity {
  const out: TxnActivity = { income: 0, spent: {}, cardFunded: {}, cardSpent: {}, uncategorized: 0 };
  const add = (rec: Record<string, number>, k: string, v: number) => { rec[k] = (rec[k] ?? 0) + v; };
  for (const t of txns) {
    if (t.deleted || t.review || ymOf(t.date) !== month || isUpcoming(t, asOf) || isHistoryTxn(t)) continue;
    const amt = num(t.amount);
    const card = cards[t.accountId];
    // a payment to a card: spends from its payment category (counted once, on the card's side)
    if (t.transferAccountId && cards[t.transferAccountId] && !card) continue;
    if (t.transferAccountId && card && amt > 0 && !cards[t.transferAccountId]) {
      add(out.spent, card, amt);
      continue;
    }
    const parts = t.splits?.length ? t.splits.map((x) => ({ cat: x.categoryId, amt: num(x.amount) })) : [{ cat: t.categoryId, amt }];
    for (const p of parts) {
      if (!p.cat) {
        // a transfer between budget accounts (no category): nothing to the budget. An account's starting
        // balance: already counted when the budget started (a card's is what you owed then).
        if (t.transferAccountId || t.id.startsWith("start:")) continue;
        // not categorized yet: from (or to) ready to assign for now. On a card, it's set aside for the card.
        out.uncategorized += p.amt;
        if (card && p.amt < 0) add(out.cardFunded, card, -p.amt);
        continue;
      }
      // "ready", or a transfer filed under an account's old Budget line (those lines are gone): in or
      // out of ready to assign
      if (p.cat === "ready" || p.cat.startsWith("acct:")) {
        out.income += p.amt;
        continue;
      }
      add(out.spent, p.cat, -p.amt);
      // spending on a card moves that money to the card's payment
      if (card && p.cat !== card) {
        add(out.cardFunded, card, -p.amt);
        add((out.cardSpent[p.cat] ??= {}), card, -p.amt);
      }
    }
  }
  return out;
}

/**
 * What you've spent on each category a month, over the `months` full months before `thisMonth` ("YYYY-MM"):
 * from the first of those months that has any transactions (so a newer budget averages what it has).
 * Refunds count against it; a category with nothing spent is 0. Same rules as the budget (txnActivity).
 */
export function averageSpent(txns: Txn[], thisMonth: string, cards: Record<string, string>, months = 12): SpentAverage {
  const [y, m] = thisMonth.split("-").map(Number) as [number, number];
  const list: string[] = [];
  for (let i = months; i >= 1; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    list.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  const first = list[0]!;
  const inWindow = txns.filter((t) => !t.deleted && !t.id.startsWith("start:") && ymOf(t.date) >= first && ymOf(t.date) < thisMonth);
  const used = list.filter((mo) => mo >= (inWindow.reduce<string | null>((a, t) => (!a || ymOf(t.date) < a ? ymOf(t.date) : a), null) ?? thisMonth));
  const by: Record<string, number> = {};
  for (const mo of used) for (const [k, v] of Object.entries(txnActivity(inWindow, mo, cards).spent)) by[k] = (by[k] ?? 0) + v;
  for (const k of Object.keys(by)) by[k] = Math.max(0, Math.round((by[k]! / used.length) * 100) / 100);
  return { months: used.length, by };
}

/**
 * A transaction dated after `asOf` ("YYYY-MM-DD", today): it's upcoming, so it doesn't count in balances or
 * spending until its day comes. Without `asOf`, everything counts.
 */
export const isUpcoming = (t: Pick<Txn, "date">, asOf?: string): boolean => !!asOf && t.date > asOf;

/** An account's balance: where its register started, plus everything since (cleared only, if asked), up to `asOf`. */
export function registerBalance(opening: number, txns: Txn[], accountId: string, clearedOnly = false, asOf?: string): number {
  let b = num(opening);
  for (const t of txns) {
    if (t.deleted || t.review || t.accountId !== accountId || isUpcoming(t, asOf)) continue;
    if (clearedOnly && t.cleared === "uncleared") continue;
    b += num(t.amount);
  }
  return b;
}

/** The other side of a transfer between two of your accounts (same id prefix, opposite amount). */
export function transferPair(t: Txn): Txn | null {
  if (!t.transferAccountId) return null;
  return {
    ...t,
    id: t.transferId ?? t.id + ":t",
    accountId: t.transferAccountId,
    transferAccountId: t.accountId,
    transferId: t.id,
    amount: -num(t.amount),
    categoryId: undefined,
    splits: undefined,
  };
}
