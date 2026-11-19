import { transferPair, type PlanState, type Txn } from "@coastfi/engine";
import { CheckinSchema, PlanStateSchema, TxnSchema, withProperties, type Checkin } from "@coastfi/schema";
import { applyRegisterBalances, applyTracked, budgetAccounts, foldSavingsLines, startTxnFor } from "./register";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appStorage } from "./txnStorage";
import { syncPaycheckLoans } from "./loans";
import { freshPlan } from "./presets";
import { stampMs } from "./pages";
import { canUndoImport, fromOldSnapshot, importSnapshot, parseUndo, readImportBackup, undoImportTxns, type ImportSnapshot } from "./importUndo";
import { applyYnabUpdate, type YnabUpdate } from "./ynabUpdate";
import { renamePayeesIn } from "./payees";
import { combineCategory, uncombineTxns } from "./combine";
import { keepFamilyGroups } from "./subcats";

export { newId } from "./id";

/**
 * The user's plan + check-ins, saved on the device (AsyncStorage; localStorage on web; history apart, see txnStorage.ts).
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
  /**
   * This device has every transaction of `owner`'s plan saved on the server up to `at` (the server's
   * own clock): the next sync asks only for ones saved after it. Missing: load them all.
   */
  txnCursor?: { owner: string; at: string };
  /** This device has uploaded its transactions edited up to `at` (ms) to `owner`'s plan. Missing: upload them all. */
  txnPushed?: { owner: string; at: number };
  /** The last "reload all my devices" request for `owner`'s plan this device acted on (the server's time). */
  reloadSeen?: { owner: string; at: string };
  /** What it takes to undo the import from YNAB (saved with your account too, so Undo works on any device). */
  lastImport?: ImportSnapshot;
  /** When you imported from YNAB (ms), kept after the undo window closes. Synced with the plan. */
  importedAt?: number;
  /** When transactions were last brought in from YNAB (the import, or an update since). Synced with the import record. */
  ynabSyncedAt?: number;
  /** The import record changed here (imported, undone, kept, started over) and the server's copy needs it. */
  importDirty?: boolean;
  hydrated: boolean;

  /** Edit the plan with a mutating function on a copy. */
  update: (fn: (draft: PlanState) => void) => void;
  setPlan: (plan: PlanState) => void;
  toggleTodo: (month: string, key: string) => void;
  /** Save this month's balances record (lib/history.ts). Not a plan change, so the plan isn't re-saved for it. */
  recordMonth: (c: Checkin) => void;
  /** Add or change a transaction (and the other side of a transfer). Balances follow. */
  saveTxn: (t: Omit<Txn, "updatedAt">, today: string) => void;
  deleteTxn: (id: string) => void;
  /** Delete every transaction (starting the budget over). */
  clearTxns: () => void;
  /** Merge transactions from another device: the newer copy of each wins. */
  mergeTxns: (incoming: Txn[]) => void;
  /** Bring in an import (from YNAB): the plan it made, and its transactions (same ids replace older copies). */
  importBudget: (plan: PlanState, txns: Txn[], replaced?: string[]) => void;
  /** Recount balances for today (upcoming transactions count on their day). Run when the app opens or comes back. */
  refreshBalances: () => void;
  /** Bring in a newer YNAB export's transactions (ynabUpdate.ts): new ones in, gone ones out if `removeGone`. */
  updateFromYnab: (u: YnabUpdate, removeGone: boolean) => void;
  /** Rename a payee, or combine several into one (`to`), on every transaction. */
  renamePayees: (from: string[], to: string) => void;
  /** Combine one budget category into another (lib/combine.ts). Returns its undo (puts both back as they were). */
  combineCategories: (from: string, into: string) => () => void;
  /** Put the plan and transactions back as they were just before the last import. `keepAdded`: ones you added since stay where they still fit. */
  undoImport: (keepAdded?: boolean) => void;
  /** Keep the import as it is: no more undo (drops the copy kept for it). */
  keepImport: () => void;
  completeOnboarding: () => void;
  /** Restore a backup made by this app. Throws a readable error. */
  importJson: (text: string) => void;
  exportJson: () => string;
  /** Clear the plan and transactions and go back through setup (check-ins are kept). */
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
        // sub categories stay in their category's group
        draft.budget = keepFamilyGroups(draft.budget);
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
      recordMonth: (c) => {
        const old = get().checkins.find((x) => x.month === c.month);
        const rest = get().checkins.filter((x) => x.month !== c.month);
        // an old check-in's spending answer is kept
        set({ checkins: [...rest, { ...old, ...c }].sort((a, b) => a.month.localeCompare(b.month)) });
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
      refreshBalances: () => {
        // a new day: upcoming transactions whose day has come now count in balances
        const plan = structuredClone(get().plan);
        applyRegisterBalances(plan, get().txns);
        const was = get().plan;
        const changed =
          plan.accounts.some((a, i) => a.balance !== was.accounts[i]?.balance) || plan.debts.some((d, i) => d.balance !== was.debts[i]?.balance);
        if (changed) set({ plan, updatedAt: now() });
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
        const snapshot = importSnapshot(stamp, structuredClone(get().plan), get().txns, list);
        const next = structuredClone(plan);
        applyRegisterBalances(next, list);
        set({ plan: next, txns: list, lastImport: snapshot, importedAt: stamp, ynabSyncedAt: stamp, importDirty: true, updatedAt: now() });
      },
      combineCategories: (from, into) => {
        const stamp = now();
        const before = get().plan;
        const r = combineCategory(before, get().txns, from, into, stamp);
        if (!r.changed.length && r.plan === before) return () => {};
        set({ plan: r.plan, txns: r.txns, updatedAt: stamp });
        return () => {
          const at = now();
          set({ plan: structuredClone(before), txns: uncombineTxns(get().txns, r.changed, at), updatedAt: at });
        };
      },
      renamePayees: (from, to) => {
        const list = renamePayeesIn(get().txns, from, to, now());
        if (list !== get().txns) set({ txns: list });
      },
      updateFromYnab: (u, removeGone) => {
        const stamp = now();
        const s = get();
        const list = applyYnabUpdate(s.txns, u, s.ynabSyncedAt ?? s.importedAt ?? 0, removeGone, stamp);
        const next = structuredClone(s.plan);
        next.budget.push(...u.hiddenAdded.filter((b) => !next.budget.some((x) => x.id === b.id)));
        applyRegisterBalances(next, list);
        set({ plan: next, txns: list, ynabSyncedAt: stamp, importDirty: true, updatedAt: stamp });
      },
      undoImport: (keepAdded = false) => {
        const snap = get().lastImport;
        if (!snap) return;
        const stamp = now();
        const list = undoImportTxns(get().txns, snap, stamp, keepAdded);
        const plan = structuredClone(snap.plan);
        applyRegisterBalances(plan, list);
        set({ plan, txns: list, lastImport: undefined, importedAt: undefined, ynabSyncedAt: undefined, importDirty: true, updatedAt: stamp });
      },
      keepImport: () => set({ lastImport: undefined, importDirty: true }),
      completeOnboarding: () => set({ onboarded: true, updatedAt: now() }),
      importJson: (text) => {
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          throw new Error("That isn't a Coastwise backup file.");
        }
        const r = raw as { app?: string; plan?: unknown; checkins?: unknown; txns?: unknown; ynabImport?: unknown };
        if (!r || typeof r !== "object" || r.app !== "coastfi" || !r.plan) throw new Error("That isn't a Coastwise backup file.");
        const plan = PlanStateSchema.safeParse(r.plan);
        if (!plan.success) throw new Error("The backup is damaged or from an incompatible version.");
        const checkins = z.array(CheckinSchema).safeParse(r.checkins ?? []);
        const txns = z.array(TxnSchema).safeParse(r.txns ?? []);
        // the YNAB import comes back with the backup (and Undo with it, while it can still be used); a
        // backup without one leaves none, so an undo copy from before can't be applied to this plan
        const imp = readImportBackup(r.ynabImport, Date.now());
        set({
          plan: withProperties(plan.data), checkins: checkins.success ? checkins.data : [], txns: txns.success ? txns.data : [], onboarded: true, updatedAt: now(),
          importedAt: imp?.importedAt, ynabSyncedAt: imp ? (imp.syncedAt ?? imp.importedAt) : undefined, lastImport: imp?.undo, importDirty: true,
        });
      },
      exportJson: () => {
        const { plan, checkins, txns, importedAt, ynabSyncedAt, lastImport } = get();
        // the YNAB import goes along, with its undo copy, so a restore can still undo it
        const ynabImport = importedAt ? { importedAt, ...(ynabSyncedAt ? { syncedAt: ynabSyncedAt } : {}), ...(lastImport ? { undo: lastImport } : {}) } : undefined;
        return JSON.stringify({ app: "coastfi", exportedAt: new Date().toISOString(), plan, checkins, txns: txns.filter((t) => !t.deleted), ...(ynabImport ? { ynabImport } : {}) }, null, 2);
      },
      startFresh: () => {
        // transactions too (marked deleted, so it syncs); check-ins are kept
        const stamp = now();
        const txns = get().txns.map((x) => (x.deleted ? x : { ...x, deleted: true, updatedAt: stamp }));
        set({ plan: freshPlan(), txns, txnCursor: undefined, txnPushed: undefined, onboarded: false, todoDone: {}, lastImport: undefined, importedAt: undefined, ynabSyncedAt: undefined, importDirty: true, updatedAt: stamp });
      },
    }),
    {
      name: "coastfi.app",
      version: 1,
      // everyday data in one entry; history (closed accounts) kept apart (lib/txnStorage.ts)
      storage: appStorage<Partial<AppState>>("coastfi.app"),
      partialize: ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase, txnCursor, txnPushed, reloadSeen, lastImport, importedAt, ynabSyncedAt, importDirty }) => ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase, txnCursor, txnPushed, reloadSeen, lastImport, importedAt, ynabSyncedAt, importDirty }),
      // never trust stored data blindly: validate, and fall back to a blank plan
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & { isSampleData?: boolean; seenWelcome?: boolean };
        const ok = PlanStateSchema.safeParse(p.plan);
        // saves from before the sample plan was removed: an untouched sample becomes a blank plan.
        // Only a save marked as the sample: today's saves carry neither flag, and setup in progress must survive a reload
        const wasSample = !p.onboarded && p.isSampleData === true;
        const parsedTxns = z.array(TxnSchema).safeParse(p.txns ?? []);
        const storedTxns = parsedTxns.success ? parsedTxns.data : [];
        // the marker only means something with the transactions it was saved with: if those couldn't be read, load them all again
        const c = p.txnCursor;
        const txnCursor = parsedTxns.success && c && typeof c.owner === "string" && typeof c.at === "string" && !Number.isNaN(stampMs(c.at)) ? c : undefined;
        const li = p.lastImport as unknown as (ImportSnapshot & { txns?: unknown }) | undefined;
        const oldCopy = !!li && Array.isArray(li.txns) && canUndoImport(li, Date.now());
        const lastImport = (() => {
          if (!li || typeof li.at !== "number" || !canUndoImport(li, Date.now())) return undefined;
          const lp = PlanStateSchema.safeParse(li.plan);
          if (!lp.success) return undefined;
          if (Array.isArray(li.txns)) {
            const lt = z.array(TxnSchema).safeParse(li.txns);
            return lt.success ? fromOldSnapshot({ at: li.at, plan: withProperties(lp.data), txns: lt.data }, storedTxns) : undefined;
          }
          return parseUndo(li, withProperties(lp.data));
        })();
        return {
          ...current,
          plan: ok.success && !wasSample ? withProperties(ok.data) : current.plan,
          onboarded: !!p.onboarded,
          checkins: Array.isArray(p.checkins) ? p.checkins : [],
          txns: storedTxns,
          txnCursor,
          reloadSeen: p.reloadSeen && typeof p.reloadSeen.owner === "string" && typeof p.reloadSeen.at === "string" ? p.reloadSeen : undefined,
          txnPushed: (() => {
            const x = p.txnPushed;
            return parsedTxns.success && x && typeof x.owner === "string" && typeof x.at === "number" ? x : undefined;
          })(),
          todoDone: p.todoDone && typeof p.todoDone === "object" ? p.todoDone : {},
          updatedAt: typeof p.updatedAt === "number" ? p.updatedAt : 0,
          // the undo copy, while it can still be used (it's dropped once the window closes)
          lastImport,
          importedAt: typeof p.importedAt === "number" ? p.importedAt : undefined,
          ynabSyncedAt: typeof p.ynabSyncedAt === "number" ? p.ynabSyncedAt : undefined,
          // an older full undo copy was just made small: the account gets it
          importDirty: !!p.importDirty || oldCopy,
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
