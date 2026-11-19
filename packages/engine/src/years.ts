/**
 * What you spent in each category, month by month (and year by year): every transaction you have,
 * history from closed accounts included (unlike the budget, which never counts history). Spending is
 * money out of a category, less refunds into it. Not counted: transfers between accounts, money in to
 * assign ("ready"), starting balances, and the categories `skip` names (a card's payment line: the
 * purchases on the card already count where they were spent).
 */
import type { Txn } from "./types";
import { num } from "./util";

export type PeriodSpending = {
  /** Periods with any spending, oldest first ("2019-03" by month, "2019" by year). */
  periods: string[];
  /** Category key → period → spent (positive = spent; refunds lower it). */
  byCat: Record<string, Record<string, number>>;
  /** An old YNAB category with no category here (history's originalCategory) → period → spent. */
  byOriginal: Record<string, Record<string, number>>;
  /** Period → money out with no category at all (not a transfer). */
  uncategorized: Record<string, number>;
  /** Period → everything above added up. */
  total: Record<string, number>;
};
/** By year (the periods are "2019"). */
export type YearSpending = Omit<PeriodSpending, "periods"> & { years: string[] };

function spendingBy(txns: Txn[], key: (date: string) => string, skip: (categoryId: string) => boolean, asOf?: string): PeriodSpending {
  const out: PeriodSpending = { periods: [], byCat: {}, byOriginal: {}, uncategorized: {}, total: {} };
  const add = (rec: Record<string, number>, p: string, v: number) => { rec[p] = (rec[p] ?? 0) + v; };
  const seen = new Set<string>();
  for (const t of txns) {
    if (t.deleted || (asOf && t.date > asOf) || t.id.startsWith("start:")) continue;
    const per = key(t.date);
    const parts = t.splits?.length
      ? t.splits.map((x) => ({ cat: x.categoryId, amt: num(x.amount), orig: x.originalCategory }))
      : [{ cat: t.categoryId, amt: num(t.amount), orig: t.originalCategory }];
    for (const p of parts) {
      const v = -p.amt;
      if (p.cat) {
        if (p.cat === "ready" || p.cat.startsWith("acct:") || skip(p.cat)) continue;
        add((out.byCat[p.cat] ??= {}), per, v);
      } else if (p.orig) {
        // YNAB's money in to assign, under its old name
        if (/^inflow:/i.test(p.orig)) continue;
        add((out.byOriginal[p.orig] ??= {}), per, v);
      } else {
        // no category: a transfer moves money, it isn't spent; money in with no category isn't spending either
        if (t.transferAccountId || p.amt >= 0) continue;
        add(out.uncategorized, per, v);
      }
      add(out.total, per, v);
      seen.add(per);
    }
  }
  out.periods = [...seen].sort();
  return out;
}

/** Spending month by month ("2024-03"). */
export const spendingByMonth = (txns: Txn[], skip: (categoryId: string) => boolean = () => false, asOf?: string): PeriodSpending =>
  spendingBy(txns, (d) => d.slice(0, 7), skip, asOf);

/** Spending year by year ("2024"). */
export function spendingByYear(txns: Txn[], skip: (categoryId: string) => boolean = () => false, asOf?: string): YearSpending {
  const { periods, ...rest } = spendingBy(txns, (d) => d.slice(0, 4), skip, asOf);
  return { years: periods, ...rest };
}
