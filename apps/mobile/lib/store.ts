import AsyncStorage from "@react-native-async-storage/async-storage";
import { transferPair, type PlanState, type Txn } from "@coastfi/engine";
import { CheckinSchema, PlanStateSchema, TxnSchema, withProperties, type Checkin } from "@coastfi/schema";
import { applyRegisterBalances, applyTracked, budgetAccounts, foldSavingsLines, startTxnFor } from "./register";
import { z } from "zod";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { syncPaycheckLoans } from "./loans";
import { freshPlan } from "./presets";

export { newId } from "./id";

/**
 * The user's plan + check-ins, saved on the device (AsyncStorage; localStorage on web).
 * Phase 3 adds sync on top of this; the store stays the single source of truth for the UI.
 */
export type AppState = {
  plan: PlanState;
  checkins: Checkin[];
  /** Transactions in your budget accounts (deleted ones kept as tombstones so deletions sync). */
  txns: Txn[];
  /** False until setup is finished; until then the app opens setup. */
  onboarded: boolean;
  /** Ticked to-dos per month: { "2026-11": ["debt", "ira"] } */
  todoDone: Record<string, string[]>;
  updatedAt: number;
  /**
   * The last copy of the plan this device synced with the server (for merging two people's edits),
   * and whose plan it is (the signed-in user, or the owner of a plan shared with them).
   */
  syncBase?: SyncBase;
  hydrated: boolean;

  /** Edit the plan with a mutating function on a copy. */
  update: (fn: (draft: PlanState) => void) => void;
  setPlan: (plan: PlanState) => void;
  toggleTodo: (month: string, key: string) => void;
  logCheckin: (c: Checkin) => void;
  /** Add or change a transaction (and the other side of a transfer). Balances follow. */
  saveTxn: (t: Omit<Txn, "updatedAt">, today: string) => void;
  deleteTxn: (id: string) => void;
  /** Delete every transaction (starting the budget over). */
  clearTxns: () => void;
  /** Merge transactions from another device: the newer copy of each wins. */
  mergeTxns: (incoming: Txn[]) => void;
  /** Bring in an import (from YNAB): the plan it made, and its transactions (same ids replace older copies). */
  importBudget: (plan: PlanState, txns: Txn[], replaced?: string[]) => void;
  completeOnboarding: () => void;
  /** Restore a backup made by this app. Throws a readable error. */
  importJson: (text: string) => void;
  exportJson: () => string;
  /** Clear the plan and go back through setup (check-ins are kept). */
  startFresh: () => void;
};

export type SyncBase = { owner: string; at: number; plan: PlanState; todoDone: Record<string, string[]> };

const now = () => Date.now();

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      plan: freshPlan(),
      checkins: [],
      txns: [],
      onboarded: false,
      todoDone: {},
      updatedAt: 0,
      hydrated: false,

      update: (fn) => {
        const draft = structuredClone(get().plan);
        // before the change, so an amount typed into a line adds to what's folded into it, not twice
        foldSavingsLines(draft);
        fn(draft);
        syncGoalSteps(draft);
        syncPaycheckLoans(draft);
        set({ plan: draft, updatedAt: now() });
      },
      setPlan: (plan) => set({ plan, updatedAt: now() }),
      toggleTodo: (month, key) => {
        const cur = get().todoDone[month] ?? [];
        const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
        set({ todoDone: { ...get().todoDone, [month]: next } });
      },
      logCheckin: (c) => {
        const rest = get().checkins.filter((x) => x.month !== c.month);
        set({ checkins: [...rest, c].sort((a, b) => a.month.localeCompare(b.month)), updatedAt: now() });
      },
      saveTxn: (input, today) => {
        const t: Txn = { ...input, updatedAt: now() };
        const others = get().txns.filter((x) => x.id !== t.id);
        const old = get().txns.find((x) => x.id === t.id);
        let list = [...others, t];
        // a transfer: keep the other side in step (or remove it when it stops being a transfer)
        const pairId = t.transferId ?? old?.transferId;
        // (only between budget accounts; a transfer out to the IRA or a loan just spends from its category)
        const bothBudget = !!t.transferAccountId && budgetAccounts(get().plan).some((a) => a.id === t.transferAccountId);
        if (t.transferAccountId && bothBudget) {
          const pair = transferPair({ ...t, transferId: pairId ?? t.id + ":t" });
          if (pair) {
            const linked = { ...t, transferId: pair.id };
            list = [...list.filter((x) => x.id !== pair.id && x.id !== t.id), linked, { ...pair, updatedAt: t.updatedAt }];
          }
        } else if (pairId) {
          list = list.map((x) => (x.id === pairId ? { ...x, deleted: true, updatedAt: t.updatedAt } : x));
        }
        const plan = structuredClone(get().plan);
        // an account's first transaction: its register starts with what's in it now
        for (const id of bothBudget ? [t.accountId, t.transferAccountId!] : [t.accountId]) {
          const start = startTxnFor(plan, list, id, today);
          if (start) list = [start, ...list];
        }
        // a transfer to or from an IRA, brokerage account or loan moves its balance too (kept on the transaction)
        const moved = applyTracked(plan, old, t);
        list = list.map((x) => (x.id === t.id ? { ...x, trackedAmount: moved } : x));
        applyRegisterBalances(plan, list);
        set({ txns: list, plan, updatedAt: now() });
      },
      deleteTxn: (id) => {
        const t = get().txns.find((x) => x.id === id);
        if (!t) return;
        const stamp = now();
        const list = get().txns.map((x) => (x.id === id || (t.transferId && x.id === t.transferId) ? { ...x, deleted: true, updatedAt: stamp } : x));
        const plan = structuredClone(get().plan);
        applyRegisterBalances(plan, list);
        applyTracked(plan, t, null);
        set({ txns: list.map((x) => (x.id === id ? { ...x, trackedAmount: undefined } : x)), plan, updatedAt: stamp });
      },
      clearTxns: () => {
        const stamp = now();
        set({ txns: get().txns.map((x) => (x.deleted ? x : { ...x, deleted: true, updatedAt: stamp })), updatedAt: stamp });
      },
      mergeTxns: (incoming) => {
        const by = new Map(get().txns.map((x) => [x.id, x]));
        let changed = false;
        for (const t of incoming) {
          const mine = by.get(t.id);
          if (!mine || t.updatedAt > mine.updatedAt) {
            by.set(t.id, t);
            changed = true;
          }
        }
        if (!changed) return;
        const list = [...by.values()];
        const plan = structuredClone(get().plan);
        applyRegisterBalances(plan, list);
        set({ txns: list, plan });
      },
      importBudget: (plan, incoming, replaced = []) => {
        const stamp = now();
        const by = new Map(get().txns.map((x) => [x.id, replaced.includes(x.id) ? { ...x, deleted: true, updatedAt: stamp } : x]));
        for (const t of incoming) by.set(t.id, t);
        const list = [...by.values()];
        const next = structuredClone(plan);
        applyRegisterBalances(next, list);
        set({ plan: next, txns: list, updatedAt: now() });
      },
      completeOnboarding: () => set({ onboarded: true, updatedAt: now() }),
      importJson: (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error("That isn't a Coastline backup file.");
        }
        const r = raw as { app?: string; plan?: unknown; checkins?: unknown; txns?: unknown };
        if (!r || typeof r !== "object" || r.app !== "coastfi" || !r.plan) throw new Error("That isn't a Coastline backup file.");
        const plan = PlanStateSchema.safeParse(r.plan);
        if (!plan.success) throw new Error("The backup is damaged or from an incompatible version.");
        const checkins = z.array(CheckinSchema).safeParse(r.checkins ?? []);
        const txns = z.array(TxnSchema).safeParse(r.txns ?? []);
        set({ plan: withProperties(plan.data), checkins: checkins.success ? checkins.data : [], txns: txns.success ? txns.data : [], onboarded: true, updatedAt: now() });
      },
      exportJson: () => {
        const { plan, checkins, txns } = get();
        return JSON.stringify({ app: "coastfi", exportedAt: new Date().toISOString(), plan, checkins, txns: txns.filter((t) => !t.deleted) }, null, 2);
      },
      startFresh: () => set({ plan: freshPlan(), onboarded: false, todoDone: {}, updatedAt: now() }),
    }),
    {
      name: "coastfi.app",
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase }) => ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase }),
      // never trust stored data blindly: validate, and fall back to a blank plan
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & { isSampleData?: boolean; seenWelcome?: boolean };
        const ok = PlanStateSchema.safeParse(p.plan);
        // saves from before the sample plan was removed: an untouched sample becomes a blank plan
        const wasSample = !p.onboarded && (p.isSampleData === true || (p.isSampleData === undefined && !p.seenWelcome));
        return {
          ...current,
          plan: ok.success && !wasSample ? withProperties(ok.data) : current.plan,
          onboarded: !!p.onboarded,
          checkins: Array.isArray(p.checkins) ? p.checkins : [],
          txns: (() => { const r = z.array(TxnSchema).safeParse(p.txns ?? []); return r.success ? r.data : []; })(),
          todoDone: p.todoDone && typeof p.todoDone === "object" ? p.todoDone : {},
          updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
          syncBase: (() => {
            const b = p.syncBase;
            const bp = b && PlanStateSchema.safeParse(b.plan);
            return b && bp?.success && typeof b.owner === "string" && typeof b.at === "number" ? { ...b, plan: bp.data, todoDone: b.todoDone ?? {} } : undefined;
          })(),
        };
      },
      onRehydrateStorage: () => () => useStore.setState({ hydrated: true }),
    },
  ),
);

/** Every goal has exactly one plan step; new goals go just before "taxable" (as in the prototype). */
export function syncGoalSteps(p: PlanState): void {
  // recurring goals are set aside like a bill, not a step in the plan
  const ids = p.goals.filter((g) => !g.recurring).map((g) => `goal:${g.id}` as const);
  const steps = p.plan.steps.filter((s) => !s.startsWith("goal:") || ids.includes(s as `goal:${string}`));
  for (const id of ids) {
    if (steps.includes(id)) continue;
    const t = steps.indexOf("taxable");
    steps.splice(t < 0 ? steps.length : t, 0, id);
  }
  p.plan.steps = steps;
}

/** "YYYY-MM" for a date (check-ins and to-dos are keyed by month). */
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
