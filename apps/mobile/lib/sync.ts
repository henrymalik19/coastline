/**
 * Offline-first sync with Supabase (PLAN.md Phase 3).
 *
 * - The device copy (the store) is always the source of truth for the UI and keeps working offline.
 * - When signed in, changes are uploaded shortly after they happen.
 * - A plan belongs to its owner. Someone the owner shares it with ("full access") syncs the owner's
 *   plan instead of their own.
 * - The plan is stored as rows (a `plan` row and a table per list; see @coastfi/schema rows.ts). It's
 *   read in one snapshot (get_plan) and saved with only the rows that changed (save_plan).
 * - Two people (or two devices) editing at once: the plan merges part by part (lib/merge.ts) against
 *   the last copy this device synced. A save only goes through if nobody saved since that copy;
 *   otherwise this device takes in the other changes, merges, and saves again.
 * - A plan saved before the rows existed still has its JSON (legacy_state): it's read from there and
 *   the next save turns it into rows.
 * - Transactions and check-ins sync row by row. Other devices' changes arrive live (realtime) and on
 *   app focus.
 */
import type { PlanState, Txn } from "@coastfi/engine";
import { allPages, batches, changedSince, newestStamp, pushedAfterPull, stampMs } from "./pages";
import type { Checkin } from "@coastfi/schema";
import { CheckinSchema, diffRows, planToRows, PlanStateSchema, TxnSchema, withProperties } from "@coastfi/schema";
import { canUndoImport, parseUndo, type ImportSnapshot } from "./importUndo";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { deepEqual, merge3 } from "./merge";
import { firstSyncAction, laterSyncAction, mergeCheckinLists } from "./firstSync";
import { sawStamps } from "./stamp";
import { afterUpload } from "./outbox";
import { planFromSnapshot, snapshotOf, type PlanRow } from "./planSnapshot";
import { freshPlan } from "./presets";
import { loadLimits } from "./limits";
import { checkMembership, onMembershipChange, onSharingSignIn, onSharingSignOut, publishViews } from "./sharing";
import { asRemote, useStore } from "./store";
import { needsSecondStep } from "./mfa";
import { AWAY_LIMIT_DAYS, awayTooLong, lastActive, noteActive } from "./idle";
import { supabase } from "./supabase";

export type SyncStatus = "off" | "signedOut" | "syncing" | "synced" | "offline" | "error";

export const useSync = create<{
  status: SyncStatus;
  email?: string;
  userId?: string;
  /** Whose plan this device syncs: the user's own, or the owner of a plan shared with them. */
  planId?: string;
  /** The owner's email, when the plan is someone else's (shared with full access). */
  sharedBy?: string;
  lastSyncedAt?: number;
  error?: string;
  /** A big job under way (loading or saving thousands of transactions), said for the banner. */
  progress?: string;
  /** Why this device was signed out, when it wasn't the person's choice (the account was deleted elsewhere). */
  notice?: string;
  /** Signed in with the emailed code, but the account also needs the authenticator app's code (this email). */
  secondStep?: string;
  /** Signed in with an emailed code after "Forgot password?": Account opens the new-password form. */
  choosingPassword?: boolean;
  /**
   * Signed in on a device that already set up a plan, to an account that has a different one: whose
   * plan to keep (the plan id). Nothing uploads until it's answered (choosePlan).
   */
  planChoice?: string;
}>(() => ({ status: supabase ? "signedOut" : "off" }));

/** The answer to planChoice, used by the next sync of that plan. */
let chosen: { pid: string; keep: "account" | "device" } | undefined;

/**
 * Answer planChoice: load the account's plan onto this device, or replace the account's plan with this
 * device's. Transactions and check-ins are never replaced either way: both sets are kept.
 */
export function choosePlan(keep: "account" | "device"): Promise<void> {
  const pid = useSync.getState().planChoice;
  if (!pid) return Promise.resolve();
  useSync.setState({ planChoice: undefined });
  lastSyncStart = Date.now();
  return serial(async () => {
    if (keep === "device") {
      // the account's plan goes into its history first, so it can be brought back
      try {
        await keepVersion(pid, "Before it was replaced with another device's plan");
      } catch (e) {
        useSync.setState({ planChoice: pid });
        failNow(e);
        return;
      }
    }
    chosen = { pid, keep };
    await syncInner();
  });
}

/* ---------- plan history: earlier versions, kept on the server ---------- */
export type PlanVersion = { id: number; saved_at: string; note: string | null };

/** False when the server doesn't have plan history yet (the app can ship before the migration). */
const noHistory = (e: { message?: string; code?: string }) => /save_plan_version|plan_version|PGRST202|PGRST205|42P01|42883/.test(`${e.message} ${e.code}`);

/** Keep a version of a plan now: the server's copy, or `snapshot` (shaped like get_plan's). */
async function keepVersion(pid: string, note: string, snapshot?: Record<string, unknown>): Promise<void> {
  if (!supabase) return;
  const res = await supabase.rpc("save_plan_version", { p: pid, p_note: note, ...(snapshot ? { p_snapshot: snapshot } : {}) });
  if (res.error && !noHistory(res.error)) throw res.error;
}

/** This device's plan, shaped like get_plan's. */
function deviceSnapshot(): Record<string, unknown> {
  const s = useStore.getState();
  return snapshotOf(s.plan, s.todoDone, s.onboarded, s.updatedAt);
}

/** The synced plan's earlier versions, newest first. Empty when there are none (or no history yet). */
export async function listPlanVersions(): Promise<PlanVersion[]> {
  if (!supabase || !planId) return [];
  const res = await supabase.from("plan_version").select("id, saved_at, note").eq("plan_id", planId).order("saved_at", { ascending: false }).limit(100);
  if (res.error) {
    if (noHistory(res.error)) return [];
    throw res.error;
  }
  return (res.data ?? []) as PlanVersion[];
}

/** One earlier version, as a plan (null when it can't be read). */
export async function loadPlanVersion(id: number): Promise<{ plan: PlanState; todoDone: Record<string, string[]>; counts: { accounts: number; categories: number; goals: number } } | null> {
  if (!supabase || !planId) return null;
  const res = await supabase.from("plan_version").select("snapshot").eq("id", id).eq("plan_id", planId).maybeSingle();
  if (res.error) throw res.error;
  const snap = (res.data as { snapshot?: Record<string, unknown> & { plan: Record<string, unknown> } } | null)?.snapshot;
  if (!snap?.plan) return null;
  const row = planFromSnapshot(snap);
  const ok = PlanStateSchema.safeParse(row.state);
  const n = (k: string) => (Array.isArray(snap[k]) ? (snap[k] as unknown[]).length : 0);
  // an old plan saved as JSON has no tables: count from the plan itself
  const legacy = row.legacy ? (row.state as { accounts?: unknown[]; budget?: unknown[]; goals?: unknown[] }) : undefined;
  const counts = legacy
    ? { accounts: legacy.accounts?.length ?? 0, categories: legacy.budget?.length ?? 0, goals: legacy.goals?.length ?? 0 }
    : { accounts: n("account"), categories: n("category"), goals: n("goal") };
  return ok.success ? { plan: ok.data, todoDone: row.todo_done ?? {}, counts } : null;
}

/**
 * Bring back an earlier version: the plan as it is now is kept in history first, then the earlier one
 * becomes this device's plan and saves like any other change (every device gets it). Transactions
 * and check-ins aren't part of a version and don't change.
 */
export async function restorePlanVersion(id: number): Promise<void> {
  const pid = planId;
  if (!supabase || !pid) throw new Error("Sign in first.");
  const v = await loadPlanVersion(id);
  if (!v) throw new Error("This version couldn't be read.");
  await keepVersion(pid, "Before an earlier version was restored");
  useStore.setState({ plan: v.plan, todoDone: v.todoDone, updatedAt: Date.now() });
  await syncNow();
}

/**
 * This device has a plan it never saved to an account, and it's about to open a plan shared with
 * you instead: keep this device's plan in your own account first. With no plan there yet it becomes
 * your plan (its transactions and check-ins too); otherwise it's kept in your plan's history.
 */
async function keepDevicePlan(userId: string): Promise<void> {
  if (!supabase) return;
  const s = useStore.getState();
  const own = await fetchPlan(userId);
  if (own) return keepVersion(userId, "A plan from a device, kept when it opened a plan shared with you", deviceSnapshot());
  const rows = planToRows(s.plan, s.todoDone, true);
  const res = await supabase.rpc("save_plan", { p: userId, p_base: null, p_at: Math.max(s.updatedAt, 1), p_plan: rows.plan, p_changes: diffRows(undefined, rows) });
  if (res.error) throw res.error;
  if (s.checkins.length) {
    const ci = await supabase.from("checkin").upsert(s.checkins.map((c) => toRow(c, userId)), { onConflict: "plan_id,month" });
    if (ci.error) throw ci.error;
  }
  await pushTxns(userId);
}

/** Read a plan in one snapshot, as the app's objects. Null when there's no plan yet. */
/**
 * The plan's latest "reload all my devices" request (the server's time), or null. Null too while the
 * server doesn't have the column yet (the app can ship before the migration).
 */
async function fetchReloadAt(pid: string): Promise<string | null> {
  if (!supabase) return null;
  const res = await supabase.from("plan").select("reload_at").eq("id", pid).maybeSingle();
  if (res.error) {
    if (/42703|reload_at/.test(String(res.error.code) + res.error.message)) return null;
    throw res.error;
  }
  return (res.data as { reload_at: string | null } | null)?.reload_at ?? null;
}

/** A reload request this device hasn't acted on yet. */
const newReload = (pid: string, at: string | null | undefined) => {
  if (!at) return false;
  const seen = useStore.getState().reloadSeen;
  return !(seen?.owner === pid && stampMs(seen.at) === stampMs(at));
};

/**
 * Throw away this device's copy of the plan, its transactions and check-ins, so the next sync loads
 * them fresh from the account (as a device signing in for the first time would). Stays signed in.
 * Anything not synced yet is lost: that's the point of reloading.
 */
function dropLocalCopy() {
  applyingRemote = true;
  useStore.setState({
    txns: [], checkins: [], syncBase: undefined, txnCursor: undefined, txnPushed: undefined, outbox: [],
    // the account's plan is the newer one now (a plan saved at 0 never wins)
    updatedAt: 0,
    lastImport: undefined, importedAt: undefined, ynabSyncedAt: undefined, importDirty: false,
  });
  applyingRemote = false;
}

/** This device: drop its copy and load everything fresh from the account. */
export function reloadFromAccount(): Promise<void> {
  lastSyncStart = Date.now();
  return serial(async () => {
    dropLocalCopy();
    await syncInner();
  });
}

/**
 * Every device signed in to this plan reloads from the account (an open one right away, others when
 * they next open). This device saves its own changes first, then asks; it doesn't reload itself.
 */
export async function reloadAllDevices(): Promise<void> {
  if (!supabase || !planId) throw new Error("Sign in first.");
  await syncNow();
  const pid = planId;
  const res = await supabase.rpc("reload_devices", { p: pid });
  if (res.error) throw new Error(/reload_devices/.test(res.error.message) ? "This needs an update on the server first. Try again later." : res.error.message);
  useStore.setState({ reloadSeen: { owner: pid, at: res.data as string } });
}

async function fetchPlan(pid: string): Promise<PlanRow | null> {
  if (!supabase) return null;
  const res = await supabase.rpc("get_plan", { p: pid });
  if (res.error) throw res.error;
  const snap = res.data as (Record<string, unknown> & { plan: Record<string, unknown> }) | null;
  return snap ? planFromSnapshot(snap) : null;
}

/** The server still has a plan's old JSON: the next save writes it all as rows. */
let legacyOnServer = false;
type CheckinRow = {
  month: string;
  checked_on: string | null;
  invested: number;
  cash: number;
  debt: number;
  net_worth: number;
  expected_next_invested: number;
  spent: number | null;
  budget: number | null;
  client_updated_at?: number | string | null;
};

const toRow = (c: Checkin, owner: string) => ({
  client_updated_at: c.updatedAt ?? 0,
  plan_id: owner,
  month: `${c.month}-01`,
  checked_on: c.date ?? null,
  invested: c.invested,
  cash: c.cash,
  debt: c.debt,
  net_worth: c.netWorth,
  expected_next_invested: c.expectedNextInvested,
  spent: c.spent ?? null,
  budget: c.budget ?? null,
});
const fromRow = (r: CheckinRow): Checkin | null => {
  const parsed = CheckinSchema.safeParse({
    month: r.month.slice(0, 7),
    date: r.checked_on ?? undefined,
    invested: Number(r.invested),
    cash: Number(r.cash),
    debt: Number(r.debt),
    netWorth: Number(r.net_worth),
    expectedNextInvested: Number(r.expected_next_invested),
    spent: r.spent === null ? undefined : Number(r.spent),
    budget: r.budget === null ? undefined : Number(r.budget),
    ...(Number(r.client_updated_at) > 0 ? { updatedAt: Number(r.client_updated_at) } : {}),
  });
  return parsed.success ? parsed.data : null;
};

/* ---------- transactions: their own table, row by row ---------- */
type SplitRow = { sort: number; category_id: string; amount: number | string; memo: string | null; original_category?: string | null };
type TxnRow = {
  id: string; account_id: string; date: string; amount: number | string; payee: string | null; memo: string | null;
  category_id: string | null; transfer_account_id: string | null; transfer_id: string | null; original_category?: string | null;
  cleared: Txn["cleared"]; source: Txn["source"]; import_id: string | null; deleted: boolean; client_updated_at: number | string;
  tracked_amount?: number | string | null;
  review?: boolean | null;
  /** When the server last saved it (its clock). */
  updated_at?: string;
  transaction_split?: SplitRow[];
};
/** A transaction for save_transactions, with its split lines. */
const txnToRow = (t: Txn) => ({
  id: t.id, account_id: t.accountId, date: t.date, amount: t.amount, payee: t.payee ?? null, memo: t.memo ?? null,
  category_id: t.categoryId ?? null, transfer_account_id: t.transferAccountId ?? null,
  transfer_id: t.transferId ?? null, cleared: t.cleared, source: t.source, import_id: t.importId ?? null,
  deleted: !!t.deleted, client_updated_at: t.updatedAt, tracked_amount: t.trackedAmount ?? null, original_category: t.originalCategory ?? null, review: !!t.review,
  splits: (t.splits ?? []).map((x) => ({ category_id: x.categoryId, amount: x.amount, memo: x.memo ?? null, original_category: x.originalCategory ?? null })),
});
const txnFromRow = (r: TxnRow): Txn | null => {
  const parsed = TxnSchema.safeParse({
    id: r.id, accountId: r.account_id, date: String(r.date).slice(0, 10), amount: Number(r.amount),
    payee: r.payee ?? undefined, memo: r.memo ?? undefined, categoryId: r.category_id ?? undefined,
    splits: r.transaction_split?.length
      ? [...r.transaction_split]
          .sort((a, b) => a.sort - b.sort)
          .map((x) => ({ categoryId: x.category_id, amount: Number(x.amount), ...(x.memo ? { memo: x.memo } : {}), ...(x.original_category ? { originalCategory: x.original_category } : {}) }))
      : undefined,
    ...(r.original_category ? { originalCategory: r.original_category } : {}),
    transferAccountId: r.transfer_account_id ?? undefined, transferId: r.transfer_id ?? undefined,
    cleared: r.cleared, source: r.source, importId: r.import_id ?? undefined, updatedAt: Number(r.client_updated_at),
    trackedAmount: r.tracked_amount === null || r.tracked_amount === undefined ? undefined : Number(r.tracked_amount),
    deleted: r.deleted || undefined,
    review: r.review || undefined,
  });
  return parsed.success ? parsed.data : null;
};
/** False once the server says it has no transactions table yet (sync keeps working without it). */
let txnTable = true;
/** Transactions per save request (an import is thousands). */
const TXN_BATCH = 500;
/** Edit time of the newest transaction already uploaded. */
/**
 * Edit time of the newest transaction this device has uploaded to `owner`'s plan. Kept on the device:
 * without it, every app start uploaded every transaction again (and could put back rows meant to be gone).
 */
const pushedThrough = (owner: string) => {
  const p = useStore.getState().txnPushed;
  return p?.owner === owner ? p.at : 0;
};
const setPushedThrough = (owner: string, at: number) => useStore.setState({ txnPushed: { owner, at: Math.max(pushedThrough(owner), at) } });
const newestEdit = (txns: Txn[]) => txns.reduce((m, t) => Math.max(m, t.updatedAt), 0);
const missingTable = (e: unknown) => /PGRST205|42P01|does not exist|Could not find the table/i.test(String((e as { message?: string; code?: string })?.message ?? "") + String((e as { code?: string })?.code ?? ""));

async function pushTxns(owner: string): Promise<void> {
  if (!supabase || !txnTable) return;
  // exactly what this device changed and the server hasn't confirmed (lib/outbox.ts): no clocks involved
  const { txns, outbox } = useStore.getState();
  if (!outbox.length) return;
  const queued = new Set(outbox);
  const changed = txns.filter((t) => queued.has(t.id));
  // ids of rows no longer here (nothing to send) leave the queue
  if (changed.length < outbox.length)
    useStore.setState((st) => {
      const here = new Set(st.txns.map((t) => t.id));
      return { outbox: st.outbox.filter((id) => here.has(id)) };
    });
  if (!changed.length) return;
  // in batches: an import is thousands of rows, too much for one request. Each batch's ids leave the
  // outbox once it's saved (a failed one keeps its ids for the next sync; saving again is harmless).
  const all = batches(changed, TXN_BATCH);
  try {
    for (const [i, batch] of all.entries()) {
      if (all.length > 1) setSync({ progress: `Saving transactions: ${(i * TXN_BATCH).toLocaleString()} of ${changed.length.toLocaleString()}` });
      const res = await supabase.rpc("save_transactions", { p: owner, p_rows: batch.map(txnToRow) });
      if (res.error) {
        if (missingTable(res.error)) {
          txnTable = false;
          return;
        }
        throw res.error;
      }
      // confirmed: out of the queue, unless edited again while this was on its way
      useStore.setState((st) => ({ outbox: afterUpload(st.outbox, batch, st.txns) }));
    }
  } finally {
    if (all.length > 1) setSync({ progress: undefined });
  }
  setPushedThrough(owner, newestEdit(changed));
}

/**
 * The plan's transactions saved on the server after `cursor` (all of them without one), and the newest
 * save stamp among them. Page by page: the server sends at most 1,000 rows per request. Pages go in id
 * order, which never changes, so a row saved meanwhile can only come twice, never be skipped; and
 * anything short of every page is an error (a partial list would mean wrong balances).
 */
async function fetchTxns(owner: string, cursor?: string): Promise<{ txns: Txn[]; through?: string } | null> {
  if (!supabase || !txnTable) return null;
  const sb = supabase;
  const after = changedSince(cursor);
  const res = await allPages<TxnRow>(
    (from, to) => {
      let q = sb.from("transaction").select("*, transaction_split(sort, category_id, amount, memo, original_category)").eq("plan_id", owner);
      if (after) q = q.gt("updated_at", after);
      return q.order("id").range(from, to);
    },
    undefined,
    (got) => got >= 1000 && setSync({ progress: `Loading transactions: ${got.toLocaleString()} so far` }),
  ).finally(() => useSync.getState().progress?.startsWith("Loading") && setSync({ progress: undefined }));
  if (res.error) {
    if (missingTable(res.error)) {
      txnTable = false;
      return null;
    }
    throw res.error;
  }
  return { txns: res.data.map(txnFromRow).filter((t): t is Txn => !!t), through: newestStamp(res.data.map((r) => r.updated_at), cursor) };
}

async function pullTxns(owner: string): Promise<void> {
  const held = useStore.getState().txnCursor;
  const remote = await fetchTxns(owner, held?.owner === owner ? held.at : undefined);
  if (!remote) return;
  // what came from the server needn't go back up (decided before merging: are this device's own edits waiting?)
  const pushed = pushedAfterPull(useStore.getState().txns, pushedThrough(owner), remote.txns);
  applyingRemote = true;
  if (remote.txns.length) useStore.getState().mergeTxns(remote.txns);
  useStore.setState({ txnPushed: { owner, at: pushed }, ...(remote.through ? { txnCursor: { owner, at: remote.through } } : {}) });
  applyingRemote = false;
  // a member's new purchase changes what's available: tell them
  void publishViews();
}

/* ---------- the import from YNAB (one row per plan; see the ynab_import migration) ---------- */

let importTable = true;
type ImportRow = { imported_at: number | null; synced_at: number | null; undo: { at?: unknown; plan?: unknown; had?: unknown; before?: unknown } | null };

/** Save this device's import record (imported, undone, kept, or started over) when it changed here. */
async function pushImport(owner: string): Promise<void> {
  const s = useStore.getState();
  if (!supabase || !importTable || !s.importDirty) return;
  const keep = s.lastImport && canUndoImport(s.lastImport, Date.now()) ? s.lastImport : null;
  const res = await supabase.from("ynab_import").upsert(
    { plan_id: owner, imported_at: s.importedAt ?? null, synced_at: s.importedAt ? (s.ynabSyncedAt ?? s.importedAt) : null, undo: s.importedAt && keep ? keep : null, updated_at: new Date().toISOString() },
    { onConflict: "plan_id" },
  );
  if (res.error) {
    if (missingTable(res.error)) { importTable = false; return; }
    throw res.error;
  }
  // only if nothing changed while it saved
  const n = useStore.getState();
  if (n.importedAt === s.importedAt && n.lastImport === s.lastImport && n.ynabSyncedAt === s.ynabSyncedAt) useStore.setState({ importDirty: false });
}

/** Take in the import record from the server (another device imported, undid or kept it). */
async function pullImport(owner: string, force = false): Promise<void> {
  if (!supabase || !importTable) return;
  const res = await supabase.from("ynab_import").select("imported_at, synced_at, undo").eq("plan_id", owner).maybeSingle();
  if (res.error) {
    if (missingTable(res.error)) { importTable = false; return; }
    throw res.error;
  }
  const s = useStore.getState();
  // this device's own change wins until it's saved (unless the plan itself switched)
  if (s.importDirty && !force) return;
  const row = res.data as ImportRow | null;
  if (!row) {
    // an import from before this was saved to the account: upload this device's record
    if (s.importedAt && !force) useStore.setState({ importDirty: true });
    else if (force) useStore.setState({ importedAt: undefined, ynabSyncedAt: undefined, lastImport: undefined, importDirty: false });
    return;
  }
  const importedAt = row.imported_at ?? undefined;
  let lastImport: ImportSnapshot | undefined;
  if (importedAt && row.undo && canUndoImport({ at: Number(row.undo.at) }, Date.now())) {
    const p = PlanStateSchema.safeParse(row.undo.plan);
    lastImport = p.success ? parseUndo(row.undo, withProperties(p.data)) : undefined;
  }
  // an undo copy past its 30 days: clear it on the server too
  const expired = !!row.undo && !lastImport;
  const syncedAt = importedAt ? (row.synced_at ?? importedAt) : undefined;
  // another device updated from YNAB (or undid) since: this device's undo would put back the wrong copy
  const moved = Number(syncedAt ?? 0) !== Number(s.ynabSyncedAt ?? 0) ? { lastUpdate: undefined, lastUndo: undefined } : {};
  useStore.setState({ importedAt, ynabSyncedAt: syncedAt, lastImport, importDirty: expired, ...moved });
}

let started = false;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: RealtimeChannel | null = null;
/** Whose plan rows this device reads and writes (see useSync.planId). */
let planId: string | undefined;

const setSync = (patch: Partial<ReturnType<typeof useSync.getState>>) => useSync.setState(patch);
const isNetworkError = (e: unknown) => /fetch|network|Failed to fetch|timeout/i.test(String((e as Error)?.message ?? e));
const failNow = (e: unknown) => setSync(isNetworkError(e) ? { status: "offline" } : { status: "error", error: String((e as Error)?.message ?? e) });

/** The signed-in account no longer exists (deleted on another device): the server says so. */
async function accountGone(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.auth.getUser();
  if (!error || isNetworkError(error)) return false;
  const code = (error as { code?: string }).code;
  return code === "user_not_found" || /sub claim in JWT does not exist|user not found/i.test(error.message);
}
let goneNotice: string | undefined;
/** The person chose to sign out (so there's nothing to explain). */
let signingOut = false;

/**
 * A sync step failed. Usually that's the network or a passing error; but if the account was deleted
 * on another device, every save would keep failing, so sign this device out instead (its plan stays).
 */
const fail = (e: unknown) => {
  failNow(e);
  if (isNetworkError(e)) return;
  void accountGone().then((gone) => gone && signOutGone()).catch(() => undefined);
};

/** Sign this device out because its account no longer exists, and say why (its plan stays on it). */
function signOutGone() {
  if (!supabase) return;
  goneNotice = "This account no longer exists (it was deleted on another device), so this device was signed out. Your plan is still here.";
  void supabase.auth.signOut({ scope: "local" });
}

/** One sync step at a time (a save and a check never interleave). */
let queue: Promise<void> = Promise.resolve();
/**
 * Each step runs to its end before the next starts: two at once could write stale "synced up to"
 * markers. A stuck request can't hold the queue: every request gives up on its own (REQUEST_LIMIT in
 * lib/supabase.ts), so a step ends. This limit is only a last resort, long past any real step (a
 * large import is a few dozen requests).
 */
const STEP_LIMIT = 10 * 60_000;
const serial = (fn: () => Promise<void>) => {
  const step = () => Promise.race([fn(), new Promise<void>((resolve) => setTimeout(resolve, STEP_LIMIT))]);
  return (queue = queue.then(step, step));
};

/** The last synced copy, when it's of this plan. */
const baseFor = (pid: string) => {
  const b = useStore.getState().syncBase;
  return b && b.owner === pid ? b : undefined;
};

/** Find out whose plan to sync (the user's own, or one shared with them), and listen to it. */
async function resolvePlanId(userId: string): Promise<string> {
  const row = await checkMembership();
  // couldn't check (offline): keep the plan this device was using
  const id = row === "error" ? (planId ?? useStore.getState().syncBase?.owner ?? userId) : row && row.role === "full" ? row.owner_id : userId;
  setSync({ planId: id, sharedBy: id !== userId ? ((row !== "error" && row?.owner_email) || useSync.getState().sharedBy) : undefined });
  if (id !== planId) {
    planId = id;
    listen(userId, id);
  }
  return id;
}

/** Take the server's copy of the plan as it is. */
function take(pid: string, row: PlanRow, plan: PlanState) {
  const todoDone = row.todo_done ?? {};
  applyingRemote = true;
  useStore.setState({ plan, todoDone, onboarded: row.onboarded, updatedAt: row.client_updated_at, syncBase: { owner: pid, at: row.client_updated_at, plan, todoDone } });
  applyingRemote = false;
}

/** Take in the server's check-ins: months this device doesn't have, and newer copies of ones it does. */
function mergeCheckins(remote: Checkin[]) {
  const next = mergeCheckinLists(useStore.getState().checkins, remote);
  if (!next) return;
  sawStamps(...remote.map((c) => c.updatedAt ?? 0));
  applyingRemote = true;
  useStore.setState({ checkins: next });
  applyingRemote = false;
}

/** Check-ins changed here since they were last uploaded, per plan (all of them once after the app opens; the server keeps the newer copy). */
const checkinsPushed = new Map<string, number>();

/**
 * This device last synced a different plan (it just joined someone's plan, or left one): replace
 * everything on it with this plan. Nothing from the other plan is uploaded here.
 */
async function switchTo(pid: string, remote: PlanRow | null, checkins: Checkin[]) {
  const got = await fetchTxns(pid);
  const txns = got?.txns ?? [];
  const txnCursor = got?.through ? { owner: pid, at: got.through } : undefined;
  const ok = remote ? PlanStateSchema.safeParse(remote.state) : null;
  legacyOnServer = !!remote?.legacy;
  applyingRemote = true;
  if (remote && ok?.success) {
    const todoDone = remote.todo_done ?? {};
    asRemote(() => useStore.setState({
      plan: ok.data, todoDone, onboarded: remote.onboarded, updatedAt: remote.client_updated_at, txns, txnCursor,
      checkins: [...checkins].sort((a, b) => a.month.localeCompare(b.month)),
      syncBase: { owner: pid, at: remote.client_updated_at, plan: ok.data, todoDone },
    }));
  } else {
    const plan = freshPlan();
    asRemote(() => useStore.setState({ plan, todoDone: {}, onboarded: false, updatedAt: 0, txns, txnCursor, checkins, syncBase: { owner: pid, at: 0, plan, todoDone: {} } }));
  }
  applyingRemote = false;
  useStore.setState({ txnPushed: { owner: pid, at: newestEdit(txns) }, outbox: [] });
}

/** Upload this device's changes: the plan (if it changed), check-ins and transactions. */
async function pushInner(depth = 0): Promise<void> {
  const userId = useSync.getState().userId;
  const pid = planId;
  if (!supabase || !userId || !pid) return;
  const s = useStore.getState();
  // never upload an unfinished setup: it could replace a real plan from another device
  if (!s.onboarded) return;
  // waiting to hear whose plan to keep: upload nothing yet
  if (useSync.getState().planChoice) return;
  setSync({ status: "syncing" });
  try {
    const base = baseFor(pid);
    if (!base || legacyOnServer || !deepEqual(base.plan, s.plan) || !deepEqual(base.todoDone, s.todoDone)) {
      const rows = planToRows(s.plan, s.todoDone, true);
      // save only the rows that changed, and only if nobody saved since the copy these changes were made on.
      // The first save from this device (or over the old JSON) writes everything, if it's the newer copy.
      const whole = !base || base.at <= 0 || legacyOnServer;
      const at = whole && !legacyOnServer ? s.updatedAt : Math.max(Date.now(), (base?.at ?? 0) + 1);
      const res = await supabase.rpc("save_plan", {
        p: pid,
        p_base: whole ? null : base!.at,
        p_at: at,
        p_plan: rows.plan,
        p_changes: diffRows(whole ? undefined : planToRows(base!.plan, base!.todoDone, true), rows),
      });
      if (res.error) throw res.error;
      if (res.data === null) {
        // someone else saved first (or the server's copy is newer): take in their changes, then save again
        if (depth < 3) return await syncInner(depth + 1);
        throw new Error("Couldn't save: the plan kept changing on another device. Try again in a moment.");
      }
      legacyOnServer = false;
      useStore.setState({ syncBase: { owner: pid, at, plan: s.plan, todoDone: s.todoDone } });
    }
    const since = checkinsPushed.get(pid);
    const changed = useStore.getState().checkins.filter((c) => since === undefined || (c.updatedAt ?? 0) > since);
    if (changed.length) {
      const ci = await supabase.from("checkin").upsert(changed.map((c) => toRow(c, pid)), { onConflict: "plan_id,month" });
      if (ci.error) throw ci.error;
    }
    checkinsPushed.set(pid, Math.max(since ?? 0, ...changed.map((c) => c.updatedAt ?? 0)));
    await pushTxns(pid);
    await pushImport(pid);
    void publishViews();
    setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
  } catch (e) {
    fail(e);
  }
}

/** Compare with the server: take in other changes, merge, and upload this device's. */
async function syncInner(depth = 0): Promise<void> {
  const userId = useSync.getState().userId;
  if (!supabase || !userId) return;
  setSync({ status: "syncing" });
  try {
    const pid = await resolvePlanId(userId);
    const [remote, ciRes, reloadAt] = await Promise.all([fetchPlan(pid), supabase.from("checkin").select("*").eq("plan_id", pid), fetchReloadAt(pid)]);
    if (ciRes.error) throw ciRes.error;
    // "reload all my devices" was asked for since this device last looked: a device that has synced this
    // plan drops its copy and loads it fresh below (one that hasn't has nothing to drop)
    if (newReload(pid, reloadAt)) {
      if (baseFor(pid)) dropLocalCopy();
      useStore.setState({ reloadSeen: { owner: pid, at: reloadAt! } });
    }
    legacyOnServer = !!remote?.legacy;
    const remoteCheckins = ((ciRes.data ?? []) as CheckinRow[]).map(fromRow).filter((c): c is Checkin => !!c);

    const before = useStore.getState().syncBase;
    if ((before && before.owner !== pid) || (!before && pid !== userId)) {
      // a plan only this device has would be dropped by the switch: keep it in your account first
      if (!before && pid !== userId && useStore.getState().onboarded) await keepDevicePlan(userId);
      await switchTo(pid, remote, remoteCheckins);
      // another plan: its import record, not this device's old one
      await pullImport(pid, true);
      setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
      return;
    }

    await pullTxns(pid);
    await pullImport(pid);
    mergeCheckins(remoteCheckins);
    if (!remote) {
      // a plan this device synced before is gone from the server: the account was deleted elsewhere
      // (sign this device out, keeping its copy), or only the plan was (upload all of it again)
      if (baseFor(pid)) {
        if (await accountGone()) return signOutGone();
        useStore.setState({ syncBase: undefined });
      }
      if (useStore.getState().onboarded) await pushInner(depth);
      else setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
      return;
    }
    const ok = PlanStateSchema.safeParse(remote.state);
    if (!ok.success) {
      setSync({ status: "error", error: "The synced plan didn't pass validation, so this device kept its own copy." });
      return;
    }
    // no awaits from here until the store is updated: an edit made meanwhile can't be lost
    let tookPlan = false;
    const s = useStore.getState();
    const base = baseFor(pid);
    const remoteTodo = remote.todo_done ?? {};
    if (!base) {
      // first sync on this device. Both have a finished plan and they differ: ask whose to keep (the
      // newer one isn't always the one you want: a fresh setup here is newer than your real plan)
      const pick = chosen?.pid === pid ? chosen.keep : undefined;
      chosen = undefined;
      const action = firstSyncAction(s, { plan: ok.data, onboarded: remote.onboarded, at: remote.client_updated_at }, pick);
      if (action === "ask") {
        setSync({ planChoice: pid, status: "synced", lastSyncedAt: Date.now(), error: undefined });
        return;
      }
      if (action === "device") {
        // this device's copy is the newer one now, so the first save replaces the account's
        useStore.setState({ updatedAt: Math.max(Date.now(), remote.client_updated_at + 1) });
      } else if (action === "account") {
        take(pid, remote, ok.data);
        tookPlan = true;
      }
    } else {
      const action = laterSyncAction(base, s, { at: remote.client_updated_at, onboarded: remote.onboarded });
      if (action === "none") {
        // nobody else saved since this device's last sync: its own changes upload below
      } else if (action === "take") {
        take(pid, remote, ok.data);
        tookPlan = !s.onboarded;
      }
      else {
        // both changed: keep both sets of changes
        const merged = PlanStateSchema.safeParse(merge3(base.plan, s.plan, ok.data));
        applyingRemote = true;
        useStore.setState({
          plan: merged.success ? merged.data : ok.data,
          todoDone: merge3(base.todoDone, s.todoDone, remoteTodo),
          syncBase: { owner: pid, at: remote.client_updated_at, plan: ok.data, todoDone: remoteTodo },
        });
        applyingRemote = false;
        if (!merged.success) {
          setSync({ status: "error", error: "A change on this device clashed with one made elsewhere, so the other one was kept." });
          return;
        }
      }
    }
    // a device that just took the account's plan (it had none of its own) takes its import record too
    if (tookPlan) await pullImport(pid, true);
    await pushInner(depth);
  } catch (e) {
    fail(e);
  }
}

/** Compare with the server and bring both copies up to date. */
export function syncNow(): Promise<void> {
  lastSyncStart = Date.now();
  return serial(() => syncInner());
}

/** When a sync last started; coming back to the app within this long doesn't sync again. */
let lastSyncStart = 0;
export const RESYNC_AFTER = 30_000;
function syncIfStale() {
  if (Date.now() - lastSyncStart < RESYNC_AFTER) return;
  void syncNow();
}

function schedulePush() {
  if (!useSync.getState().userId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void serial(() => pushInner()), 1500);
}

/**
 * A transaction changed somewhere (the live connection only says that something did): fetch what
 * changed once things go quiet, not once per row (an import changes thousands at once).
 */
let ringTimer: ReturnType<typeof setTimeout> | undefined;
function ring(pid: string) {
  if (ringTimer) clearTimeout(ringTimer);
  ringTimer = setTimeout(() => {
    ringTimer = undefined;
    if (planId === pid) void serial(() => pullTxns(pid)).catch(() => undefined);
  }, 1500);
}

/** Hear about changes to this plan made elsewhere. */
function listen(userId: string, pid: string) {
  if (!supabase) return;
  channel?.unsubscribe();
  // a channel with this name may still be open (e.g. after a reload in development): close it first
  for (const c of supabase.getChannels()) if (c.topic.startsWith(`realtime:plan-${userId}`)) void supabase.removeChannel(c);
  channel = supabase
    .channel(`plan-${userId}-${pid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "plan", filter: `id=eq.${pid}` }, (payload) => {
      const row = payload.new as { client_updated_at?: number; reload_at?: string | null } | undefined;
      if (row && (Number(row.client_updated_at) !== baseFor(pid)?.at || newReload(pid, row.reload_at))) void syncNow();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "transaction", filter: `plan_id=eq.${pid}` }, () => ring(pid))
    .subscribe();
}

async function onSignedIn(session: Session) {
  if (!supabase) return;
  // two-step sign-in is on and this sign-in hasn't finished it: load nothing until the app's code is in
  // (a device that was syncing stops too: two-step was just turned on elsewhere)
  if (await needsSecondStep()) {
    if (useSync.getState().userId) leavePlan();
    setSync({ status: "signedOut", secondStep: session.user.email ?? "" });
    return;
  }
  if (useSync.getState().userId === session.user.id) return;
  planId = undefined;
  setSync({ userId: session.user.id, email: session.user.email ?? undefined, notice: undefined, secondStep: undefined });
  // link any invite first, so a shared plan loads instead of this account's own
  await onSharingSignIn(session.user.id, session.user.email).catch(() => undefined);
  await syncNow();
}

function onSignedOut() {
  // signed out without choosing to: the sign-in ended (expired, or the account is gone)
  const wasIn = !!useSync.getState().userId;
  if (wasIn && !signingOut && !goneNotice) goneNotice = "You were signed out: this device's sign-in ended, or the account no longer exists. Your plan is still here; sign in again to keep syncing.";
  signingOut = false;
  leavePlan();
  setSync({ notice: goneNotice, secondStep: undefined });
  goneNotice = undefined;
}

/** Stop syncing and forget whose plan this was (the copy on this device stays). */
function leavePlan() {
  onSharingSignOut();
  channel?.unsubscribe();
  channel = null;
  planId = undefined;
  chosen = undefined;
  setSync({ status: supabase ? "signedOut" : "off", userId: undefined, email: undefined, planId: undefined, sharedBy: undefined, lastSyncedAt: undefined, error: undefined, choosingPassword: undefined, planChoice: undefined });
}

/** Sign this device out if the app hasn't been opened on it for a long time (its plan stays). */
async function signOutIfAway() {
  if (!supabase) return;
  const last = await lastActive();
  if (awayTooLong(last, Date.now())) {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      // couldn't reach the server: stay signed in for now and try again next time
      if (error) return;
      goneNotice = `You were signed out because Coastwise wasn't opened on this device for over ${AWAY_LIMIT_DAYS} days. Your plan is still here; sign in again to keep syncing.`;
    }
  }
  noteActive();
}

/** Call once at app start. Safe to call when sync isn't configured. */
export function startSync() {
  if (started || !supabase) return;
  started = true;
  // the shared contribution limits (anyone can read them)
  void loadLimits().catch(() => undefined);
  // invited, removed, or given full access while signed in: sync the right plan
  onMembershipChange(() => void syncNow());
  const auth = supabase.auth;
  void (async () => {
    // not opened for a long time (an old or shared device): sign it out before anything syncs
    await signOutIfAway();
    void auth.getSession().then(({ data }) => data.session && onSignedIn(data.session));
    // run outside the auth callback: the auth client holds a lock while it runs, and every request
    // (which reads the session) would wait for that lock, so awaiting them here would never finish
    auth.onAuthStateChange((_event, session) => {
      setTimeout(() => {
        if (session) void onSignedIn(session);
        else onSignedOut();
      }, 0);
    });
  })();
  AppState.addEventListener("change", (st) => st === "active" && noteActive());
  if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("focus", () => noteActive());
  // upload changes made on this device
  useStore.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.updatedAt !== prev.updatedAt || s.todoDone !== prev.todoDone || s.checkins !== prev.checkins || s.txns !== prev.txns || (s.importDirty && !prev.importDirty)) schedulePush();
  });
  // catch up when the app comes back to the foreground or the network returns
  // coming back to the app: catch up, unless it synced moments ago (live updates cover the rest)
  AppState.addEventListener("change", (st) => st === "active" && syncIfStale());
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("focus", syncIfStale);
    window.addEventListener("online", () => void syncNow());
  }
}

/** Signing out on purpose (not an expired sign-in): the next signed-out event shows no notice. */
export function markSigningOut() {
  signingOut = true;
}

// sign in, codes, passwords, sign out and deleting the account: lib/account.ts
export { deleteAccount, MIN_PASSWORD, sendCode, setPassword, signInWithPassword, signOut, signOutOthers, verifyCode } from "./account";
