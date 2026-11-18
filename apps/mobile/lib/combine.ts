/**
 * Combine one budget category into another (Budget → a category → Combine into…): its transactions
 * (split lines too) are filed under the other one, its amounts add to the other's month by month (and
 * what it started with), its plan amount adds to the other's, and it's removed. The other keeps its own
 * name, group, switches and links. Undone by putting back the plan and the transactions as they were.
 */
import type { PlanState, Txn } from "@coastfi/engine";

const add = (a: number | undefined, b: number | undefined) => Math.round(((a ?? 0) + (b ?? 0)) * 100) / 100;

/** How many transactions are filed under a category (split lines count once per transaction). */
export const txnsIn = (txns: Txn[], id: string) => txns.filter((t) => !t.deleted && (t.categoryId === id || t.splits?.some((x) => x.categoryId === id))).length;

/** The plan and transactions with `from` combined into `into` (new objects; `stamp` marks the transactions changed). */
export function combineCategory(plan: PlanState, txns: Txn[], from: string, into: string, stamp: number): { plan: PlanState; txns: Txn[]; changed: Txn[] } {
  const p = structuredClone(plan);
  const a = p.budget.find((b) => b.id === from);
  const b = p.budget.find((x) => x.id === into);
  if (!a || !b || from === into) return { plan, txns, changed: [] };
  if (!b.hidden && !b.paysDebt) b.amount = add(b.amount, a.amount);
  const bp = p.budgetPlan;
  if (bp) {
    for (const e of Object.values(bp.months ?? {})) {
      if (e.assigned && from in e.assigned) {
        e.assigned[into] = add(e.assigned[into], e.assigned[from]);
        delete e.assigned[from];
      }
      if (e.cardDebt?.some((x) => x.cat === from)) {
        const merged = new Map<string, number>();
        for (const x of e.cardDebt) {
          const cat = x.cat === from ? into : x.cat;
          merged.set(cat + "\u0000" + x.card, add(merged.get(cat + "\u0000" + x.card), x.amount));
        }
        e.cardDebt = [...merged].map(([k, amount]) => { const [cat, card] = k.split("\u0000") as [string, string]; return { cat, card, amount }; });
      }
    }
    if (bp.opening && from in bp.opening) {
      bp.opening[into] = add(bp.opening[into], bp.opening[from]);
      delete bp.opening[from];
    }
  }
  p.budget = p.budget.filter((x) => x.id !== from);
  const changed: Txn[] = [];
  const out = txns.map((t) => {
    if (t.deleted) return t;
    const hit = t.categoryId === from || t.splits?.some((x) => x.categoryId === from);
    if (!hit) return t;
    changed.push(t);
    return {
      ...t,
      ...(t.categoryId === from ? { categoryId: into } : {}),
      ...(t.splits?.length ? { splits: t.splits.map((x) => (x.categoryId === from ? { ...x, categoryId: into } : x)) } : {}),
      updatedAt: stamp,
    };
  });
  return { plan: p, txns: changed.length ? out : txns, changed };
}

/** Undo a combine: the transactions it changed back as they were (marked `stamp`, so they sync). */
export function uncombineTxns(txns: Txn[], before: Txn[], stamp: number): Txn[] {
  const was = new Map(before.map((t) => [t.id, t]));
  return txns.map((t) => (was.has(t.id) ? { ...was.get(t.id)!, updatedAt: stamp } : t));
}
