/**
 * A plan as the server's get_plan returns it, a "snapshot": the plan row, and each table's rows by
 * table name. Plan history keeps versions in this shape.
 */
import type { PlanState } from "@coastfi/engine";
import { PLAN_TABLES, planToRows, rowsToPlan, type PlanRows, type PlanTable } from "@coastfi/schema";

/** The plan as the server has it: settings, lists, and (until it's turned into rows) the old JSON. */
export type PlanRow = {
  /** The plan as rows say it, or from the old JSON. Not validated yet. */
  state: unknown;
  todo_done: Record<string, string[]>;
  onboarded: boolean;
  client_updated_at: number;
  /** Still the old JSON on the server: the next save writes every row. */
  legacy: boolean;
};

export type Snapshot = Record<string, unknown> & { plan: Record<string, unknown> };

/** A snapshot, as the app's objects. */
export function planFromSnapshot(snap: Snapshot): PlanRow {
  const at = Number(snap.plan.client_updated_at ?? 0);
  if (snap.plan.legacy_state) {
    return { state: snap.plan.legacy_state, todo_done: (snap.plan.legacy_todo_done as Record<string, string[]>) ?? {}, onboarded: !!snap.plan.onboarded, client_updated_at: at, legacy: true };
  }
  const tables = {} as PlanRows["tables"];
  for (const t of Object.keys(PLAN_TABLES) as PlanTable[]) tables[t] = (snap[t] as Record<string, unknown>[]) ?? [];
  const back = rowsToPlan({ plan: snap.plan, tables });
  return { state: back.plan, todo_done: back.todoDone, onboarded: back.onboarded, client_updated_at: at, legacy: false };
}

/** A plan on this device, as a snapshot (to keep in history). */
export function snapshotOf(plan: PlanState, todoDone: Record<string, string[]>, onboarded: boolean, updatedAt: number): Snapshot {
  const rows = planToRows(plan, todoDone, onboarded);
  return { ...rows.tables, plan: { ...rows.plan, client_updated_at: updatedAt } };
}
