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
import { CheckinSchema, diffRows, PLAN_TABLES, planToRows, PlanStateSchema, rowsToPlan, TxnSchema, withProperties, type PlanRows, type PlanTable } from "@coastfi/schema";
import { canUndoImport, parseUndo, type ImportSnapshot } from "./importUndo";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { deepEqual, merge3 } from "./merge";
import { freshPlan } from "./presets";
import { loadLimits } from "./limits";
import { checkMembership, onMembershipChange, onSharingSignIn, onSharingSignOut, publishViews } from "./sharing";
import { useStore } from "./store";
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
}>(() => ({ status: supabase ? "signedOut" : "off" }));

/** The plan as the server has it: settings, lists, and (until it's turned into rows) the old JSON. */
type PlanRow = {
  /** The plan as rows say it, or from the old JSON. Not validated yet. */
  state: unknown;
  todo_done: Record<string, string[]>;
  onboarded: boolean;
  client_updated_at: number;
  /** Still the old JSON on the server: the next save writes every row. */
  legacy: boolean;
};

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
    txns: [], checkins: [], syncBase: undefined, txnCursor: undefined, txnPushed: undefined,
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
  if (!snap) return null;
  const at = Number(snap.plan.client_updated_at ?? 0);
  if (snap.plan.legacy_state) {
    return { state: snap.plan.legacy_state, todo_done: (snap.plan.legacy_todo_done as Record<string, string[]>) ?? {}, onboarded: !!snap.plan.onboarded, client_updated_at: at, legacy: true };
  }
  const tables = {} as PlanRows["tables"];
  for (const t of Object.keys(PLAN_TABLES) as PlanTable[]) tables[t] = (snap[t] as Record<string, unknown>[]) ?? [];
  const back = rowsToPlan({ plan: snap.plan, tables });
  return { state: back.plan, todo_done: back.todoDone, onboarded: back.onboarded, client_updated_at: at, legacy: false };
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
};

const toRow = (c: Checkin, owner: string) => ({
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
  const since = pushedThrough(owner);
  const changed = useStore.getState().txns.filter((t) => t.updatedAt > since);
  if (!changed.length) return;
  // in batches: an import is thousands of rows, too much for one request. Saving is safe to repeat, so
  // if a batch fails the next sync sends them all again (an import's rows share one edit time).
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
  useStore.setState({ importedAt, ynabSyncedAt: importedAt ? (row.synced_at ?? importedAt) : undefined, lastImport, importDirty: expired });
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
const STEP_LIMIT = 45_000;
const serial = (fn: () => Promise<void>) => {
  // a step that never finishes (a stuck request) must not stop every later sync
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

/** Add check-ins only the server has (a month both have keeps this device's copy, which is uploaded). */
function mergeCheckins(remote: Checkin[]) {
  const local = useStore.getState().checkins;
  const months = new Set(local.map((c) => c.month));
  const missing = remote.filter((c) => !months.has(c.month));
  if (!missing.length) return;
  applyingRemote = true;
  useStore.setState({ checkins: [...local, ...missing].sort((a, b) => a.month.localeCompare(b.month)) });
  applyingRemote = false;
}

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
    useStore.setState({
      plan: ok.data, todoDone, onboarded: remote.onboarded, updatedAt: remote.client_updated_at, txns, txnCursor,
      checkins: [...checkins].sort((a, b) => a.month.localeCompare(b.month)),
      syncBase: { owner: pid, at: remote.client_updated_at, plan: ok.data, todoDone },
    });
  } else {
    const plan = freshPlan();
    useStore.setState({ plan, todoDone: {}, onboarded: false, updatedAt: 0, txns, txnCursor, checkins, syncBase: { owner: pid, at: 0, plan, todoDone: {} } });
  }
  applyingRemote = false;
  useStore.setState({ txnPushed: { owner: pid, at: newestEdit(txns) } });
}

/** Upload this device's changes: the plan (if it changed), check-ins and transactions. */
async function pushInner(depth = 0): Promise<void> {
  const userId = useSync.getState().userId;
  const pid = planId;
  if (!supabase || !userId || !pid) return;
  const s = useStore.getState();
  // never upload an unfinished setup: it could replace a real plan from another device
  if (!s.onboarded) return;
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
    const { checkins } = useStore.getState();
    if (checkins.length) {
      const ci = await supabase.from("checkin").upsert(checkins.map((c) => toRow(c, pid)), { onConflict: "plan_id,month" });
      if (ci.error) throw ci.error;
    }
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
      // first sync on this device: the newer copy wins; a finished plan beats an unfinished setup
      if (remote.client_updated_at > s.updatedAt || (remote.onboarded && !s.onboarded)) {
        take(pid, remote, ok.data);
        tookPlan = true;
      }
    } else if (remote.client_updated_at !== base.at) {
      const localChanged = !deepEqual(base.plan, s.plan) || !deepEqual(base.todoDone, s.todoDone);
      if (!localChanged || (remote.onboarded && !s.onboarded)) {
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
  setSync({ status: supabase ? "signedOut" : "off", userId: undefined, email: undefined, planId: undefined, sharedBy: undefined, lastSyncedAt: undefined, error: undefined, choosingPassword: undefined });
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

/* ---------- account actions ---------- */

export async function sendCode(email: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, token: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) throw error;
}

export const MIN_PASSWORD = 10;

export async function signInWithPassword(email: string, password: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  // signing in with a password means you know it: drop a "Forgot password?" started earlier
  useSync.setState({ choosingPassword: undefined });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) return;
  // the same answer whether the email has an account or not, so it can't be used to find accounts
  if (/invalid login credentials/i.test(error.message))
    throw new Error("Wrong email or password. If you haven't set a password yet, email yourself a code instead.");
  throw error;
}

/** Set or change the password for the signed-in account. */
export async function setPassword(password: string) {
  if (!supabase) throw new Error("Sync isn't set up in this build.");
  if (password.length < MIN_PASSWORD) throw new Error(`Use at least ${MIN_PASSWORD} characters.`);
  const { error } = await supabase.auth.updateUser({ password });
  if (!error) return;
  const code = (error as { code?: string }).code;
  if (code === "same_password") throw new Error("That's already your password.");
  if (code === "weak_password") throw new Error("That password is too easy to guess. Try a longer one.");
  throw error;
}

/** Sign out every other device and browser; this one stays signed in. */
export async function signOutOthers() {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut({ scope: "others" });
  if (error) throw error;
}

/** Sign out. The plan stays on this device unless `forget` is true. */
export async function signOut(forget = false) {
  if (!supabase) return;
  signingOut = true;
  // this device only: other devices stay signed in (Account has "Sign out other devices" for those)
  await supabase.auth.signOut({ scope: "local" });
  if (forget) {
    useStore.getState().startFresh();
    // forgetting clears this device only: the account's import record and transactions aren't this
    // device's to change (startFresh marks transactions deleted, which signing back in would upload)
    useStore.setState({ importDirty: false, txns: [], checkins: [], syncBase: undefined, txnCursor: undefined, txnPushed: undefined });
  }
}

/** Delete the account and all synced data. The copy on this device is kept unless `forget`. */
export async function deleteAccount(forget: boolean) {
  if (!supabase) return;
  // disconnect your banks at Plaid first (deleting the rows alone would leave Plaid's access, and its billing, running)
  const me = useSync.getState().userId;
  const banks = me ? await supabase.from("plaid_items").select("id").eq("plan_id", me).limit(1) : null;
  if (banks && !banks.error && banks.data.length) {
    const r = await supabase.functions.invoke("plaid", { body: { action: "remove_all", planId: me } });
    if (r.error) throw new Error("Couldn't disconnect your banks, so your account wasn't deleted. Try again in a moment.");
  }
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await signOut(forget);
}
