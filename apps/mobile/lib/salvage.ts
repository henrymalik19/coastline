/**
 * Reading the device's saved copy without losing it to one bad item. A plan or transaction list that
 * fails the check as a whole used to be thrown away: the plan became blank (and then synced as blank
 * to the account and every device), and an empty transaction list was saved over the history. Here
 * each list item is checked on its own and only the bad ones are dropped.
 */
import type { PlanState, Txn } from "@coastfi/engine";
import { PlanStateSchema, TxnSchema } from "@coastfi/schema";

type Checker = { safeParse: (v: unknown) => { success: boolean } };
type Wrapped = Checker & { unwrap?: () => unknown; element?: Checker };

/** The plan, with any list items that fail the check dropped; no plan when even that doesn't pass. */
export function salvagePlan(raw: unknown): { plan?: PlanState; dropped: number } {
  const whole = PlanStateSchema.safeParse(raw);
  if (whole.success) return { plan: whole.data as PlanState, dropped: 0 };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { dropped: 0 };
  const copy: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  let dropped = 0;
  for (const [key, field] of Object.entries(PlanStateSchema.shape as Record<string, Wrapped>)) {
    const value = copy[key];
    if (!Array.isArray(value)) continue;
    // a list (or an optional list): keep the items that pass
    const list = field.element ?? (typeof field.unwrap === "function" ? (field.unwrap() as Wrapped).element : undefined);
    if (!list) continue;
    const keep = value.filter((x) => list.safeParse(x).success);
    dropped += value.length - keep.length;
    copy[key] = keep;
  }
  const again = PlanStateSchema.safeParse(copy);
  return again.success ? { plan: again.data as PlanState, dropped } : { dropped: 0 };
}

/** The transactions that pass the check, and how many didn't. Not a list at all: none, nothing dropped. */
export function salvageTxns(raw: unknown): { txns: Txn[]; dropped: number } {
  if (!Array.isArray(raw)) return { txns: [], dropped: 0 };
  const txns: Txn[] = [];
  for (const x of raw) {
    const r = TxnSchema.safeParse(x);
    if (r.success) txns.push(r.data as Txn);
  }
  return { txns, dropped: raw.length - txns.length };
}
