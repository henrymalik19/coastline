import { transferPair, type PlanState, type Txn } from "@coastfi/engine";
import { CheckinSchema, PlanStateSchema, TxnSchema, withProperties, type Checkin } from "@coastfi/schema";
import { applyRegisterBalances, applyTracked, budgetAccounts, foldSavingsLines, startTxnFor, todayIso } from "./register";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appStorage } from "./txnStorage";
import { syncPaycheckLoans } from "./loans";
import { freshPlan } from "./presets";
import { stampMs } from "./pages";
import { canUndoImport, fromOldSnapshot, importSnapshot, parseUndo, readImportBackup, undoImportTxns, type ImportSnapshot } from "./importUndo";
import { applyYnabUpdate, canUndoUpdate, snapshotUpdate, undoYnabUpdate as undoYnabUpdateTxns, type UndoMark, type UpdateSnapshot, type YnabUpdate } from "./ynabUpdate";
import { renamePayeesIn } from "./payees";
import { bankStarts, mergeBankTxns, type BankTxn } from "./bankTxns";
import { combineCategory, uncombineTxns } from "./combine";
import { keepFamilyGroups } from "./subcats";
import { salvagePlan, salvageTxns } from "./salvage";
import { sawStamps, stamp } from "./stamp";
import { addIds, changedIds, seedOutbox } from "./outbox";

/** Changes made from inside this are the server's (other devices'), not this device's: they don't go in the outbox. */
let remote = 0;
export function asRemote<T>(fn: () => T): T {
  remote++;
  try {
    return fn();
  } finally {
    remote--;
  }
}

/** The device's saved copy has been read (until then nothing is written over it). */
let loaded = false;

/** A saved copy that couldn't be read: kept aside on this device (web), so it isn't lost for good. */
function keepDamaged(raw: unknown) {
  try {
    globalThis.localStorage?.setItem(`coastfi.app.damaged.${Date.now()}`, JSON.stringify(raw));
  } catch {
    // no room or no storage: nothing more to do
  }
}

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
  /** Transactions changed on this device and not yet confirmed by the server (lib/outbox.ts). */
  outbox: string[];
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
  /** What it takes to undo the last update from YNAB (this device only; gone after the next update or import). */
  lastUpdate?: UpdateSnapshot;
  /** What undoing the last update did, so updating again treats those rows as YNAB's (this device only). */
  lastUndo?: UndoMark;
  hydrated: boolean;
  /** Something in this device's saved copy couldn't be read when the app opened (said once; not saved). */
  loadNotice?: string;

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
  /** Put the transactions back as they were just before the last update from YNAB. Returns how many you'd changed since (those stay). */
  undoYnabUpdate: () => number;
  /** Rename a payee, or combine several into one (`to`), on every transaction. */
  renamePayees: (from: string[], to: string) => void;
  /** Merge your banks' transactions in (lib/bankTxns.ts). Returns how many came in new (held for review). */
  /** `current`: the bank's balance now, by Plaid account id (for an account whose transactions start here). */
  mergeBank: (rows: BankTxn[], current?: Map<string, number>) => number;
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

/** An edit time, always after every edit seen (lib/stamp.ts: devices' clocks differ). */
const now = stamp;

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
      outbox: [],

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
        // an edit time: the newer copy of a month wins between devices
        set({ checkins: [...rest, { ...old, ...c, updatedAt: now() }].sort((a, b) => a.month.localeCompare(b.month)) });
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
        // and the bank start dates: the banks' transactions come in again (from the budget's new start)
        const plan = structuredClone(get().plan);
        for (const x of [...plan.accounts, ...plan.debts]) delete x.bankFrom;
        set({ plan, txns: get().txns.map((x) => (x.deleted ? x : { ...x, deleted: true, updatedAt: stamp })), updatedAt: stamp });
      },
      mergeTxns: (incoming) => {
        // the next edit here must come after these, whatever the other device's clock said
        sawStamps(...incoming.map((t) => t.updatedAt));
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
        asRemote(() => set({ txns: list, plan }));
      },
      importBudget: (plan, incoming, replaced = []) => {
        const stamp = now();
        const by = new Map(get().txns.map((x) => [x.id, replaced.includes(x.id) ? { ...x, deleted: true, updatedAt: stamp } : x]));
        for (const t of incoming) by.set(t.id, t);
        const list = [...by.values()];
        const snapshot = importSnapshot(stamp, structuredClone(get().plan), get().txns, list);
        const next = structuredClone(plan);
        applyRegisterBalances(next, list);
        set({ plan: next, txns: list, lastImport: snapshot, importedAt: stamp, ynabSyncedAt: stamp, importDirty: true, updatedAt: now(), lastUpdate: undefined, lastUndo: undefined });
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
      mergeBank: (rows, current = new Map()) => {
        const s = get();
        // a matched account's bank start date, the first time its transactions come in (one with none
        // here yet starts then, at what it held: lib/bankTxns.ts bankStarts)
        const st = bankStarts(s.plan, s.txns, rows, current, todayIso(), now());
        const plan = st.length ? structuredClone(s.plan) : s.plan;
        for (const b of st) {
          const x = plan.accounts.find((a) => a.id === b.accountId) ?? plan.debts.find((d) => d.id === b.accountId);
          if (x) x.bankFrom = b.from;
        }
        const starts = st.flatMap((b) => (b.start ? [b.start] : []));
        const r = mergeBankTxns([...s.txns, ...starts], plan, rows, now());
        const same = !st.length && r.txns.length === s.txns.length && r.txns.every((t, i) => t === s.txns[i]);
        if (same) return 0;
        const next = structuredClone(plan);
        applyRegisterBalances(next, r.txns);
        set({ plan: next, txns: r.txns, updatedAt: now() });
        return r.added;
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
        const lastUpdate = snapshotUpdate(s.txns, list, stamp, s.ynabSyncedAt);
        set({ plan: next, txns: list, ynabSyncedAt: stamp, importDirty: true, updatedAt: stamp, lastUpdate, lastUndo: undefined });
      },
      undoYnabUpdate: () => {
        const s = get();
        if (!s.lastUpdate) return 0;
        const stamp = now();
        const { txns: list, kept, mark } = undoYnabUpdateTxns(s.txns, s.lastUpdate, stamp);
        const next = structuredClone(s.plan);
        applyRegisterBalances(next, list);
        set({ plan: next, txns: list, ynabSyncedAt: s.lastUpdate.syncedBefore ?? s.importedAt, importDirty: true, updatedAt: stamp, lastUpdate: undefined, lastUndo: mark });
        return kept;
      },
      undoImport: (keepAdded = false) => {
        const snap = get().lastImport;
        if (!snap) return;
        const stamp = now();
        const list = undoImportTxns(get().txns, snap, stamp, keepAdded);
        const plan = structuredClone(snap.plan);
        applyRegisterBalances(plan, list);
        set({ plan, txns: list, lastImport: undefined, importedAt: undefined, ynabSyncedAt: undefined, importDirty: true, updatedAt: stamp, lastUpdate: undefined, lastUndo: undefined });
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
        set({ plan: freshPlan(), txns, txnCursor: undefined, txnPushed: undefined, onboarded: false, todoDone: {}, lastImport: undefined, importedAt: undefined, ynabSyncedAt: undefined, importDirty: true, updatedAt: stamp, lastUpdate: undefined, lastUndo: undefined });
      },
    }),
    {
      name: "coastfi.app",
      version: 1,
      // everyday data in one entry; history (closed accounts) kept apart (lib/txnStorage.ts). Nothing is
      // written until the saved copy has loaded: the device's storage is read asynchronously, and a
      // change made before then would save a blank starting state over everything.
      storage: (() => {
        const s = appStorage<Partial<AppState>>("coastfi.app");
        return { ...s, setItem: (name: string, value: Parameters<typeof s.setItem>[1]) => (loaded ? s.setItem(name, value) : undefined) };
      })(),
      partialize: ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase, txnCursor, txnPushed, outbox, reloadSeen, lastImport, importedAt, ynabSyncedAt, importDirty, lastUpdate, lastUndo }) => ({ plan, checkins, txns, onboarded, todoDone, updatedAt, syncBase, txnCursor, txnPushed, outbox, reloadSeen, lastImport, importedAt, ynabSyncedAt, importDirty, lastUpdate, lastUndo }),
      // never trust stored data blindly: validate, and fall back to a blank plan
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState> & { isSampleData?: boolean; seenWelcome?: boolean };
        // one bad item drops only that item (lib/salvage.ts), never the whole plan or list
        const sp = salvagePlan(p.plan);
        // saves from before the sample plan was removed: an untouched sample becomes a blank plan.
        // Only a save marked as the sample: today's saves carry neither flag, and setup in progress must survive a reload
        const wasSample = !p.onboarded && p.isSampleData === true;
        const st = salvageTxns(p.txns ?? []);
        const storedTxns = st.txns;
        sawStamps(...storedTxns.map((t) => t.updatedAt), typeof p.txnPushed?.at === "number" ? p.txnPushed.at : 0, typeof p.updatedAt === "number" ? p.updatedAt : 0);
        // the marker only means something with the transactions it was saved with: if some couldn't be read, load them all again
        const c = p.txnCursor;
        const txnCursor = !st.dropped && c && typeof c.owner === "string" && typeof c.at === "string" && !Number.isNaN(stampMs(c.at)) ? c : undefined;
        const base = (() => {
          const b = p.syncBase;
          const bp = b && PlanStateSchema.safeParse(b.plan);
          return b && bp?.success && typeof b.owner === "string" && typeof b.at === "number" ? { ...b, plan: bp.data, todoDone: b.todoDone ?? {} } : undefined;
        })();
        // a finished plan that couldn't be read at all: never treat it as blank (that would sync a blank
        // plan to the account). Take the last synced copy; without one, leave setup unfinished, which
        // uploads nothing and lets the account's plan win at the next sync. The unreadable copy is kept aside.
        const lost = !sp.plan && !!p.onboarded && !!p.plan;
        if (lost) keepDamaged(p);
        const notice = lost
          ? base
            ? "Part of this device's saved plan couldn't be read, so it went back to the last copy synced with your account."
            : "This device's saved plan couldn't be read, so setup starts again. If you have a Coastwise account, sign in and your plan loads from it. A copy of the damaged data is kept on this device: send a diagnostic report (Settings → Backup & restore) and we can help get it back."
          : sp.dropped || st.dropped
            ? `${sp.dropped + st.dropped} saved item${sp.dropped + st.dropped === 1 ? "" : "s"} on this device couldn't be read and ${sp.dropped + st.dropped === 1 ? "was" : "were"} left out. Your account still has ${sp.dropped + st.dropped === 1 ? "it" : "them"} if you sync.`
            : undefined;
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
          loadNotice: notice,
          plan: lost && base ? withProperties(base.plan) : sp.plan && !wasSample ? withProperties(sp.plan) : current.plan,
          onboarded: lost ? !!base : !!p.onboarded,
          checkins: Array.isArray(p.checkins) ? p.checkins : [],
          txns: storedTxns,
          txnCursor,
          reloadSeen: p.reloadSeen && typeof p.reloadSeen.owner === "string" && typeof p.reloadSeen.at === "string" ? p.reloadSeen : undefined,
          txnPushed: (() => {
            const x = p.txnPushed;
            // what was uploaded still was (a dropped bad row is simply loaded from the account again)
            return x && typeof x.owner === "string" && typeof x.at === "number" ? x : undefined;
          })(),
          // what still has to go up; a copy saved before the outbox existed fills it from the old marker
          outbox: Array.isArray(p.outbox) && p.outbox.every((x) => typeof x === "string")
            ? p.outbox
            // only a marker for the plan this device syncs counts (one for another plan meant "upload them all")
            : seedOutbox(storedTxns, typeof p.txnPushed?.at === "number" && (!base || p.txnPushed.owner === base.owner) ? p.txnPushed.at : undefined),
          todoDone: lost && base ? base.todoDone : p.todoDone && typeof p.todoDone === "object" ? p.todoDone : {},
          // a lost plan: as old as the synced copy (or 0), so it never counts as the newer one
          updatedAt: lost ? (base?.at ?? 0) : typeof p.updatedAt === "number" ? p.updatedAt : 0,
          // the undo copy, while it can still be used (it's dropped once the window closes)
          lastImport,
          importedAt: typeof p.importedAt === "number" ? p.importedAt : undefined,
          ynabSyncedAt: typeof p.ynabSyncedAt === "number" ? p.ynabSyncedAt : undefined,
          lastUpdate: (() => {
            const u = p.lastUpdate;
            // past its 30 days it's dropped (so is one from before the window existed)
            if (!u || typeof u.at !== "number" || !canUndoUpdate(u, Date.now()) || !Array.isArray(u.added) || !u.added.every((x) => typeof x === "string")) return undefined;
            const b = z.array(TxnSchema).safeParse(u.before);
            return b.success ? { at: u.at, before: b.data, added: u.added, ...(typeof u.syncedBefore === "number" ? { syncedBefore: u.syncedBefore } : {}) } : undefined;
          })(),
          lastUndo: (() => {
            const m = p.lastUndo;
            if (!m || typeof m.at !== "number" || !Array.isArray(m.removed) || !m.removed.every((x) => typeof x === "string") || !m.was || typeof m.was !== "object") return undefined;
            const was = Object.fromEntries(Object.entries(m.was).filter(([, v]) => typeof v === "number")) as Record<string, number>;
            return { at: m.at, was, removed: m.removed };
          })(),
          // an older full undo copy was just made small: the account gets it
          importDirty: !!p.importDirty || oldCopy,
          syncBase: base,
        };
      },
      // while the saved copy loads, its transactions aren't edits made here (nothing goes in the outbox)
      onRehydrateStorage: () => {
        remote++;
        return () => {
          remote--;
          loaded = true;
          useStore.setState({ hydrated: true });
        };
      },
    },
  ),
);

// every transaction change made on this device goes in the outbox (whichever action made it);
// changes from the server (asRemote) and the saved copy loading don't
useStore.subscribe((s, prev) => {
  if (s.txns === prev.txns || remote || !loaded) return;
  const ids = changedIds(prev.txns, s.txns);
  if (ids.length) useStore.setState({ outbox: addIds(s.outbox, ids) });
});

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
