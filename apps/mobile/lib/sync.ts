/**
 * Offline-first sync with Supabase (PLAN.md Phase 3).
 *
 * - The device copy (the store) is always the source of truth for the UI and keeps working offline.
 * - When signed in, changes are uploaded shortly after they happen.
 * - Conflicts: last write wins by the edit time (`updatedAt`), enforced again by the database.
 * - Other devices' changes arrive live (realtime) and on app focus.
 */
import type { Txn } from "@coastfi/engine";
import type { Checkin } from "@coastfi/schema";
import { CheckinSchema, PlanStateSchema, TxnSchema } from "@coastfi/schema";
import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { AppState, Platform } from "react-native";
import { create } from "zustand";
import { useStore } from "./store";
import { supabase } from "./supabase";

export type SyncStatus = "off" | "signedOut" | "syncing" | "synced" | "offline" | "error";

export const useSync = create<{
  status: SyncStatus;
  email?: string;
  userId?: string;
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

const toRow = (c: Checkin) => ({
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
const txnToRow = (t: Txn) => ({
  id: t.id, account_id: t.accountId, date: t.date, amount: t.amount, payee: t.payee ?? null, memo: t.memo ?? null,
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

async function pushTxns(): Promise<void> {
  if (!supabase || !txnTable) return;
  const changed = useStore.getState().txns.filter((t) => t.updatedAt > txnPushedThrough);
  if (!changed.length) return;
  const res = await supabase.from("transactions").upsert(changed.map(txnToRow), { onConflict: "user_id,id" });
  if (res.error) {
    if (missingTable(res.error)) {
      txnTable = false;
      return;
    }
    throw res.error;
  }
  txnPushedThrough = Math.max(txnPushedThrough, ...changed.map((t) => t.updatedAt));
}

async function pullTxns(userId: string): Promise<void> {
  if (!supabase || !txnTable) return;
  const res = await supabase.from("transactions").select("*").eq("user_id", userId);
  if (res.error) {
    if (missingTable(res.error)) {
      txnTable = false;
      return;
    }
    throw res.error;
  }
  const remote = ((res.data ?? []) as TxnRow[]).map(txnFromRow).filter((t): t is Txn => !!t);
  applyingRemote = true;
  useStore.getState().mergeTxns(remote);
  applyingRemote = false;
}

let started = false;
let applyingRemote = false;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let channel: RealtimeChannel | null = null;

const setSync = (patch: Partial<ReturnType<typeof useSync.getState>>) => useSync.setState(patch);
const isNetworkError = (e: unknown) => /fetch|network|Failed to fetch|timeout/i.test(String((e as Error)?.message ?? e));

/** Upload the device copy (plan row + all check-ins). */
async function push(): Promise<void> {
  const userId = useSync.getState().userId;
  if (!supabase || !userId) return;
  const s = useStore.getState();
  // never upload an unfinished setup: it could replace a real plan from another device
  if (!s.onboarded) return;
  setSync({ status: "syncing" });
  try {
    const plan = await supabase.from("plans").upsert(
      { user_id: userId, state: s.plan, todo_done: s.todoDone, onboarded: s.onboarded, client_updated_at: s.updatedAt, schema_version: 2 },
      { onConflict: "user_id" },
    );
    if (plan.error) throw plan.error;
    if (s.checkins.length) {
      const ci = await supabase.from("checkins").upsert(s.checkins.map(toRow), { onConflict: "user_id,month" });
      if (ci.error) throw ci.error;
    }
    await pushTxns();
    setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
  } catch (e) {
    setSync(isNetworkError(e) ? { status: "offline" } : { status: "error", error: String((e as Error)?.message ?? e) });
  }
}

function schedulePush() {
  if (!useSync.getState().userId) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), 1500);
}

/** Take the server copy into the device (only called when it's newer). */
function applyRemote(row: PlanRow, remoteCheckins: Checkin[]) {
  const ok = PlanStateSchema.safeParse(row.state);
  if (!ok.success) {
    setSync({ status: "error", error: "The synced plan didn't pass validation, so this device kept its own copy." });
    return;
  }
  const local = useStore.getState();
  // check-ins: union by month; the newer side wins a month that both have
  const byMonth = new Map(local.checkins.map((c) => [c.month, c]));
  for (const c of remoteCheckins) byMonth.set(c.month, c);
  applyingRemote = true;
  useStore.setState({
    plan: ok.data,
    onboarded: row.onboarded,
    todoDone: row.todo_done ?? {},
    checkins: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    updatedAt: row.client_updated_at,
  });
  applyingRemote = false;
}

/** Compare with the server and move whichever copy is newer. */
export async function syncNow(): Promise<void> {
  const userId = useSync.getState().userId;
  if (!supabase || !userId) return;
  setSync({ status: "syncing" });
  try {
    const [planRes, ciRes] = await Promise.all([
      supabase.from("plans").select("user_id, state, todo_done, onboarded, client_updated_at").eq("user_id", userId).maybeSingle<PlanRow>(),
      supabase.from("checkins").select("*").eq("user_id", userId),
    ]);
    if (planRes.error) throw planRes.error;
    if (ciRes.error) throw ciRes.error;
    await pullTxns(userId);
    const remote = planRes.data;
    const remoteCheckins = ((ciRes.data ?? []) as CheckinRow[]).map(fromRow).filter((c): c is Checkin => !!c);
    const local = useStore.getState();

    // a finished plan always beats an unfinished setup on this device (e.g. a new phone)
    const remoteWins = !!remote && (remote.client_updated_at > local.updatedAt || (remote.onboarded && !local.onboarded));
    if (remote && remoteWins) {
      applyRemote(remote, remoteCheckins);
      // send back any check-ins only this device had
      const remoteMonths = new Set(remoteCheckins.map((c) => c.month));
      if (useStore.getState().checkins.some((c) => !remoteMonths.has(c.month))) await push();
      else setSync({ status: "synced", lastSyncedAt: Date.now(), error: undefined });
    } else if (local.onboarded) {
      // this device is newer (or the account is empty and this device has a plan)
      const localMonths = new Set(local.checkins.map((c) => c.month));
      const missing = remoteCheckins.filter((c) => !localMonths.has(c.month));
      if (missing.length) {
        applyingRemote = true;
        useStore.setState({ checkins: [...local.checkins, ...missing].sort((a, b) => a.month.localeCompare(b.month)) });
        applyingRemote = false;
      }
      await push();
    } else {
      setSync({ status: "synced", lastSyncedAt: Date.now() });
    }
  } catch (e) {
    setSync(isNetworkError(e) ? { status: "offline" } : { status: "error", error: String((e as Error)?.message ?? e) });
  }
}

async function onSignedIn(session: Session) {
  if (!supabase) return;
  if (useSync.getState().userId === session.user.id) return;
  setSync({ userId: session.user.id, email: session.user.email ?? undefined });
  await syncNow();
  channel?.unsubscribe();
  channel = supabase
    .channel(`plan-${session.user.id}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "plans", filter: `user_id=eq.${session.user.id}` }, (payload) => {
      const row = payload.new as PlanRow | undefined;
      if (row && row.client_updated_at > useStore.getState().updatedAt) void syncNow();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `user_id=eq.${session.user.id}` }, () => {
      void pullTxns(session.user.id).catch(() => undefined);
    })
    .subscribe();
}

function onSignedOut() {
  channel?.unsubscribe();
  channel = null;
  setSync({ status: supabase ? "signedOut" : "off", userId: undefined, email: undefined, lastSyncedAt: undefined, error: undefined });
}

/** Call once at app start. Safe to call when sync isn't configured. */
export function startSync() {
  if (started || !supabase) return;
  started = true;
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
