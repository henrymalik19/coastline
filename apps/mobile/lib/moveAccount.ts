/**
 * Move one account's transactions into another (to remove an account that has some): each of its
 * transactions moves, transfers to or from it point at the other one instead, and a transfer between
 * the two (which would now go nowhere) is dropped. Its starting balance goes with it: the other
 * account's balance comes from its own start plus everything now in it. Then the account is removed.
 */
import { isStartTxn, startTxnId, type PlanState, type Txn } from "@coastfi/engine";
import { applyRegisterBalances } from "./register";

/** Transactions in an account (its starting balance aside). */
export const txnsInAccount = (txns: Txn[], id: string) => txns.filter((t) => !t.deleted && t.accountId === id && !isStartTxn(t)).length;

export function moveAccountTxns(plan: PlanState, txns: Txn[], from: string, to: string, stamp: number): { plan: PlanState; txns: Txn[]; moved: number } {
  if (from === to) return { plan, txns, moved: 0 };
  let moved = 0;
  const next = txns.map((t): Txn => {
    if (t.deleted) return t;
    if (t.id === startTxnId(from)) return { ...t, deleted: true, updatedAt: stamp };
    const acct = t.accountId === from ? to : t.accountId;
    const other = t.transferAccountId === from ? to : t.transferAccountId;
    if (acct === t.accountId && other === t.transferAccountId) return t;
    // a transfer between the two: now from the account to itself, so it goes
    if (other && other === acct) return { ...t, deleted: true, updatedAt: stamp };
    if (t.accountId === from) moved++;
    return { ...t, accountId: acct, ...(other ? { transferAccountId: other } : {}), updatedAt: stamp };
  });
  const p = structuredClone(plan);
  p.accounts = p.accounts.filter((a) => a.id !== from);
  p.debts = p.debts.filter((d) => d.id !== from);
  applyRegisterBalances(p, next);
  return { plan: p, txns: next, moved };
}
