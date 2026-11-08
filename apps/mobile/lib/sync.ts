/**
 * Offline-first sync with Supabase (PLAN.md Phase 3).
 *
 * - The device copy (the store) is always the source of truth for the UI and keeps working offline.
 * - When signed in, changes are uploaded shortly after they happen.
 * - A plan belongs to its owner. Someone the owner shares it with ("full access") syncs the owner's
 *   plan instead of their own.
 * - Two people (or two devices) editing at once: the plan merges part by part (lib/merge.ts) against
 *   the last copy this device synced. A save only goes through if nobody saved since that copy;
 *   otherwise this device takes in the other changes, merges, and saves again.
 * - Transactions and check-ins sync row by row. Other devices' changes arrive live (realtime) and on
 *   app focus.
 */
import type { PlanState, Txn } from "@coastfi/engine";
import type { Checkin } from "@coastfi/schema";
import { CheckinSchema, PlanStateSchema, TxnSchema } from "@coastfi/schema";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { deepEqual, merge3 } from "./merge";
import { freshPlan } from "./presets";
import { checkMembership, onMembershipChange, onSharingSignIn, onSharingSignOut, publishViews } from "./sharing";
import { useStore } from "./store";
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
}>(() => ({ status: supabase ? "signedOut" : "off" }));

type PlanRow = {
  user_id: string;
  state: unknown;
  todo_done: Record<string, string[]>;
  onboarded: boolean;
  client_updated_at: number;
};
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
  user_id: owner,
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
type TxnRow = {
  id: string; account_id: string; date: string; amount: number | string; payee: string | null; memo: string | null;
  category_id: string | null; splits: Txn["splits"] | null; transfer_account_id: string | null; transfer_id: string | null;
  cleared: Txn["cleared"]; source: Txn["source"]; import_id: string | null; deleted: boolean; client_updated_at: number | string;
};
const txnToRow = (t: Txn, owner: string) => ({
  user_id: owner, id: t.id, account_id: t.accountId, date: t.date, amount: t.amount, payee: t.payee ?? null, memo: t.memo ?? null,
  category_id: t.categoryId ?? null, splits: t.splits ?? null, transfer_account_id: t.transferAccountId ?? null,
  transfer_id: t.transferId ?? null, cleared: t.cleared, source: t.source, import_id: t.importId ?? null,
  deleted: !!t.deleted, client_updated_at: t.updatedAt,
});
const txnFromRow = (r: TxnRow): Txn | null => {
  const parsed = TxnSchema.safeParse({
    id: r.id, accountId: r.account_id, date: String(r.date).slice(0, 10), amount: Number(r.amount),
    payee: r.payee ?? undefined, memo: r.memo ?? undefined, categoryId: r.category_id ?? undefined,
    splits: r.splits ?? undefined, transferAccountId: r.transfer_account_id ?? undefined, transferId: r.transfer_id ?? undefined,
    cleared: r.cleared, source: r.source, importId: r.import_id ?? undefined, updatedAt: Number(r.client_updated_at),
    deleted: r.deleted || undefined,
  });
  return parsed.success ? parsed.data : null;
};
/** False once the server says it has no transactions table yet (sync keeps working without it). */
let txnTable = true;
/** Edit time of the newest transaction already uploaded. */
let txnPushedThrough = 0;
const missingTable = (e: unknown) => /PGRST205|42P01|does not exist|Could not find the table/i.test(String((e as { message?: string; code?: string })?.message ?? "") + String((e as { code?: string })?.code ?? ""));

async function pushTxns(owner: string): Promise<void> {
  if (!supabase || !txnTable) return;
  const changed = useStore.getState().txns.filter((t) => t.updatedAt > txnPushedThrough);
  if (!changed.length) return;
  const res = await supabase.from("transactions").upsert(changed.map((t) => txnToRow(t, owner)), { onConflict: "user_id,id" });
  if (res.error) {
    if (missingTable(res.error)) {
      txnTable = false;
      return;
    }
    throw res.error;
  }
  txnPushedThrough = Math.max(txnPushedThrough, ...changed.map((t) => t.updatedAt));
}

async function fetchTxns(owner: string): Promise<Txn[] | null> {
  if (!supabase || !txnTable) return null;
  const res = await supabase.from("transactions").select("*").eq("user_id", owner);
  if (res.error) {
    if (missingTable(res.error)) {
      txnTable = false;
      return null;
    }
    throw res.error;
  }
  return ((res.data ?? []) as TxnRow[]).map(txnFromRow).filter((t): t is Txn => !!t);
}

async function pullTxns(owner: string): Promise<void> {
  const remote = await fetchTxns(owner);
  if (!remote) return;
  applyingRemote = true;
  useStore.getState().mergeTxns(remote);
  applyingRemote = false;
  // a member's new purchase changes what's available: tell them
  void publishViews();
}

let started = false;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: RealtimeChannel | null = null;
/** Whose plan rows this device reads and writes (see useSync.planId). */
let planId: string | undefined;

const setSync = (patch: Partial<ReturnType<typeof useSync.getState>>) => useSync.setState(patch);
const isNetworkError = (e: unknown) => /fetch|network|Failed to fetch|timeout/i.test(String((e as Error)?.message ?? e));
const fail = (e: unknown) => setSync(isNetworkError(e) ? { status: "offline" } : { status: "error", error: String((e as Error)?.message ?? e) });

/** One sync step at a time (a save and a check never interleave). */
let queue: Promise<void> = Promise.resolve();
const serial = (fn: () => Promise<void>) => (queue = queue.then(fn, fn));

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
  const txns = (await fetchTxns(pid)) ?? [];
  const ok = remote ? PlanStateSchema.safeParse(remote.state) : null;
  applyingRemote = true;
  if (remote && ok?.success) {
    const todoDone = remote.todo_done ?? {};
    useStore.setState({
      plan: ok.data, todoDone, onboarded: remote.onboarded, updatedAt: remote.client_updated_at, txns,
      checkins: [...checkins].sort((a, b) => a.month.localeCompare(b.month)),
      syncBase: { owner: pid, at: remote.client_updated_at, plan: ok.data, todoDone },
    });
  } else {
    const plan = freshPlan();
    useStore.setState({ plan, todoDone: {}, onboarded: false, updatedAt: 0, txns, checkins, syncBase: { owner: pid, at: 0, plan, todoDone: {} } });
  }
  applyingRemote = false;
  txnPushedThrough = Math.max(0, ...txns.map((t) => t.updatedAt));
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
    if (!base || !deepEqual(base.plan, s.plan) || !deepEqual(base.todoDone, s.todoDone)) {
      const row = { user_id: pid, state: s.plan, todo_done: s.todoDone, onboarded: true, schema_version: 2 };
      let at: number;
      if (base && base.at > 0) {
        // save only if nobody saved since the copy these changes were made on
        at = Math.max(Date.now(), base.at + 1);
        const res = await supabase.from("plans").update({ ...row, client_updated_at: at }).eq("user_id", pid).eq("client_updated_at", base.at).select("client_updated_at");
        if (res.error) throw res.error;
        if (!res.data?.length) {
          // someone else saved first: take in their changes, then save again
          if (depth < 3) return await syncInner(depth + 1);
          throw new Error("Couldn't save: the plan kept changing on another device. Try again in a moment.");
        }
      } else {
        // first save from this device: the newer copy wins (the database ignores an older one)
        at = s.updatedAt;
        const res = await supabase.from("plans").upsert({ ...row, client_updated_at: at }, { onConflict: "user_id" });
        if (res.error) throw res.error;
      }
      useStore.setState({ syncBase: { owner: pid, at, plan: s.plan, todoDone: s.todoDone } });
    }
    const { checkins } = useStore.getState();
    if (checkins.length) {
      const ci = await supabase.from("checkins").upsert(checkins.map((c) => toRow(c, pid)), { onConflict: "user_id,month" });
      if (ci.error) throw ci.error;
    }
    await pushTxns(pid);
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
    const [planRes, ciRes] = await Promise.all([
      supabase.from("plans").select("user_id, state, todo_done, onboarded, client_updated_at").eq("user_id", pid).maybeSingle<PlanRow>(),
      supabase.from("checkins").select("*").eq("user_id", pid),
    ]);
    if (planRes.error) throw planRes.error;
    if (ciRes.error) throw ciRes.error;
    const remote = planRes.data;
    const remoteCheckins = ((ciRes.data ?? []) as CheckinRow[]).map(fromRow).filter((c): c is Checkin => !!c);

    const before = useStore.getState().syncBase;
    if ((before && before.owner !== pid) || (!before && pid !== userId)) {
      await switchTo(pid, remote, remoteCheckins);
      setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
      return;
    }

    await pullTxns(pid);
    mergeCheckins(remoteCheckins);
    if (!remote) {
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
    const s = useStore.getState();
    const base = baseFor(pid);
    const remoteTodo = remote.todo_done ?? {};
    if (!base) {
      // first sync on this device: the newer copy wins; a finished plan beats an unfinished setup
      if (remote.client_updated_at > s.updatedAt || (remote.onboarded && !s.onboarded)) take(pid, remote, ok.data);
    } else if (remote.client_updated_at !== base.at) {
      const localChanged = !deepEqual(base.plan, s.plan) || !deepEqual(base.todoDone, s.todoDone);
      if (!localChanged || (remote.onboarded && !s.onboarded)) take(pid, remote, ok.data);
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
    await pushInner(depth);
  } catch (e) {
    fail(e);
  }
}

/** Compare with the server and bring both copies up to date. */
export function syncNow(): Promise<void> {
  return serial(() => syncInner());
}

function schedulePush() {
  if (!useSync.getState().userId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void serial(() => pushInner()), 1500);
}

/** Hear about changes to this plan made elsewhere. */
function listen(userId: string, pid: string) {
  if (!supabase) return;
  channel?.unsubscribe();
  // a channel with this name may still be open (e.g. after a reload in development): close it first
  for (const c of supabase.getChannels()) if (c.topic.startsWith(`realtime:plan-${userId}`)) void supabase.removeChannel(c);
  channel = supabase
    .channel(`plan-${userId}-${pid}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter: `user_id=eq.${pid}` }, (payload) => {
      const row = payload.new as PlanRow | undefined;
      if (row && row.client_updated_at !== baseFor(pid)?.at) void syncNow();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${pid}` }, () => {
      void pullTxns(pid).catch(() => undefined);
    })
    .subscribe();
}

async function onSignedIn(session: Session) {
  if (!supabase) return;
  if (useSync.getState().userId === session.user.id) return;
  planId = undefined;
  setSync({ userId: session.user.id, email: session.user.email ?? undefined });
  // link any invite first, so a shared plan loads instead of this account's own
  await onSharingSignIn(session.user.id, session.user.email).catch(() => undefined);
  await syncNow();
}

function onSignedOut() {
  onSharingSignOut();
  channel?.unsubscribe();
  channel = null;
  planId = undefined;
  setSync({ status: supabase ? "signedOut" : "off", userId: undefined, email: undefined, planId: undefined, sharedBy: undefined, lastSyncedAt: undefined, error: undefined });
}

/** Call once at app start. Safe to call when sync isn't configured. */
export function startSync() {
  if (started || !supabase) return;
  started = true;
  // invited, removed, or given full access while signed in: sync the right plan
  onMembershipChange(() => void syncNow());
  void supabase.auth.getSession().then(({ data }) => data.session && onSignedIn(data.session));
  supabase.auth.onAuthStateChange((_event, session) => {
    if (session) void onSignedIn(session);
    else onSignedOut();
  });
  // upload changes made on this device
  useStore.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.updatedAt !== prev.updatedAt || s.todoDone !== prev.todoDone || s.checkins !== prev.checkins || s.txns !== prev.txns) schedulePush();
  });
  // catch up when the app comes back to the foreground or the network returns
  AppState.addEventListener("change", (st) => st === "active" && void syncNow());
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.addEventListener("focus", () => void syncNow());
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

/** Sign out. The plan stays on this device unless `forget` is true. */
export async function signOut(forget = false) {
  if (!supabase) return;
  await supabase.auth.signOut();
  if (forget) useStore.getState().startFresh();
}

/** Delete the account and all synced data. The copy on this device is kept unless `forget`. */
export async function deleteAccount(forget: boolean) {
  if (!supabase) return;
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await signOut(forget);
}
