import { transferPair, type Txn } from "@coastfi/engine";

const DAYS = 5;
const dayGap = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000;

/**
 * A transfer between two of your budget accounts whose other side went missing (removed, or changed
 * by a bank sync when it carried the bank's id): put back, so it shows in both accounts again. When the
 * other account already has a matching side (a bank's that took its place), the two are linked instead.
 * Deleting a transfer removes both sides, so a live side with no partner is never on purpose.
 */
export function repairTransfers(txns: Txn[], budgetIds: ReadonlySet<string>, stamp: number): { txns: Txn[]; fixed: number } {
  const byId = new Map(txns.map((t) => [t.id, t]));
  const live = (id?: string) => {
    const x = id ? byId.get(id) : undefined;
    return x && !x.deleted ? x : undefined;
  };
  const paired = (a: Txn, b?: Txn) => !!b && b.accountId === a.transferAccountId && b.transferId === a.id && Math.abs(b.amount + a.amount) < 0.005;
  const fixes = new Map<string, Txn>();
  for (const t of txns) {
    if (t.deleted || !t.transferAccountId || !budgetIds.has(t.accountId) || !budgetIds.has(t.transferAccountId)) continue;
    if (fixes.has(t.id) || paired(t, live(t.transferId))) continue;
    // a side in the other account that's this transfer, not paired with anything else
    const match = txns.find(
      (x) =>
        !x.deleted && x.id !== t.id && x.accountId === t.transferAccountId && x.transferAccountId === t.accountId && Math.abs(x.amount + t.amount) < 0.005 &&
        dayGap(x.date, t.date) <= DAYS && !fixes.has(x.id) && !paired(x, live(x.transferId)),
    );
    if (match) {
      fixes.set(t.id, { ...t, transferId: match.id, updatedAt: stamp });
      fixes.set(match.id, { ...match, transferId: t.id, updatedAt: stamp });
      continue;
    }
    const pair = transferPair(t);
    if (!pair) continue;
    if (!t.transferId) fixes.set(t.id, { ...t, transferId: pair.id, updatedAt: stamp });
    fixes.set(pair.id, { ...pair, deleted: false, updatedAt: stamp });
  }
  if (!fixes.size) return { txns, fixed: 0 };
  const out = txns.map((t) => fixes.get(t.id) ?? t);
  for (const [id, t] of fixes) if (!byId.has(id)) out.push(t);
  return { txns: out, fixed: fixes.size };
}
