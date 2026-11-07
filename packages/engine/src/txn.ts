/**
 * Transactions in your budget accounts (checking, savings, credit cards), and what they mean for the
 * budget: money in to assign, money out of categories, and credit-card spending moving into the
 * card's payment category (the envelope way), so the payment is always covered.
 */
import type { Txn } from "./types";
import { num } from "./util";

/** What a month's transactions do to the budget. */
export type TxnActivity = {
  /** Money in with no job yet ("ready to assign"). */
  income: number;
  /** Money out per category (positive = spent; refunds lower it). */
  spent: Record<string, number>;
  /** Card spending that moves into each card's payment category (`debt:<id>`). */
  cardFunded: Record<string, number>;
};

const ymOf = (date: string) => date.slice(0, 7);

/**
 * A month's activity. `cards` maps a credit card's account id (its debt id) to its payment category key.
 * Transfers between budget accounts don't touch categories, except a payment to a card, which spends
 * from that card's payment category. A transfer out to an account you don't budget (an IRA, a loan)
 * spends from the category on it.
 */
export function txnActivity(txns: Txn[], month: string, cards: Record<string, string>): TxnActivity {
  const out: TxnActivity = { income: 0, spent: {}, cardFunded: {} };
  const add = (rec: Record<string, number>, k: string, v: number) => { rec[k] = (rec[k] ?? 0) + v; };
  for (const t of txns) {
    if (t.deleted || ymOf(t.date) !== month) continue;
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
      if (!p.cat) continue; // a transfer between budget accounts, or not categorized yet
      if (p.cat === "ready") {
        out.income += p.amt;
        continue;
      }
      add(out.spent, p.cat, -p.amt);
      // spending on a card moves that money to the card's payment
      if (card && p.cat !== card) add(out.cardFunded, card, -p.amt);
    }
  }
  return out;
}

/** An account's balance: where its register started, plus everything since (cleared only, if asked). */
export function registerBalance(opening: number, txns: Txn[], accountId: string, clearedOnly = false): number {
  let b = num(opening);
  for (const t of txns) {
    if (t.deleted || t.accountId !== accountId) continue;
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
