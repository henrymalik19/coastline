/**
 * Bank connections (Plaid). The app never talks to Plaid with keys: it asks the `plaid` server function,
 * reads the results (plaid_items, plaid_accounts) with the user's own session, and copies balances into
 * the plan accounts and debts they're matched to. Plaid's sign-in window (Link) opens on the web.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { create } from "zustand";
import { BANKS_ON } from "./features";
import { applyBankBalances, dropMatches, type BankAccount } from "./plaidMatch";
import { hasRegister } from "./register";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { useSync } from "./sync";

export type BankItem = {
  id: string;
  institution: string;
  kind: "bank" | "investments";
  status: "ok" | "login_required" | "pending_expiration" | "error";
  errorCode?: string | null;
  lastSyncedAt?: string | null;
};

type PlaidState = {
  planId?: string; items: BankItem[]; accounts: BankAccount[]; loaded: boolean; busy: boolean; error?: string;
  /** May this person connect new banks? Undefined until asked. */
  canLink?: boolean;
};
export const usePlaid = create<PlaidState>(() => ({ items: [], accounts: [], loaded: false, busy: false }));

// signed out: forget the bank connections and accounts loaded for that sign-in (a shared computer)
useSync.subscribe((s, prev) => {
  if (prev.userId && !s.userId) usePlaid.setState({ planId: undefined, items: [], accounts: [], loaded: false, busy: false, error: undefined, canLink: undefined });
});

/** Bank connections work when sync is set up and you're signed in (the plan is on the server). */
export const banksAvailable = () => !!supabase && !!useSync.getState().planId && !!useSync.getState().userId;

async function call<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const planId = useSync.getState().planId;
  if (!supabase || !planId) throw new Error("Sign in first.");
  const { data, error } = await supabase.functions.invoke("plaid", { body: { action, planId, ...body } });
  if (error) {
    // the function's own message ("Sign in first.", the bank's message) is in the response body
    const ctx = (error as { context?: Response }).context;
    const msg = ctx && typeof ctx.json === "function" ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined) : undefined;
    throw new Error(msg || "Couldn't reach the bank connection service.");
  }
  return data as T;
}

type ItemRow = { id: string; institution_name: string | null; kind: BankItem["kind"]; status: BankItem["status"]; error_code: string | null; last_synced_at: string | null };
type AccountRow = {
  id: string; item: string; account_id: string; name: string; official_name: string | null; mask: string | null; type: string; subtype: string | null;
  current: number | string | null; available: number | string | null; credit_limit: number | string | null; apr: number | string | null; min_payment: number | string | null; updated_at: string;
};
const num = (v: number | string | null) => (v == null ? null : Number(v));

/** Read this plan's connections and bank accounts (the app's own session; row level security). */
export async function loadBanks(): Promise<void> {
  const planId = useSync.getState().planId;
  if (!supabase || !planId) return;
  const [items, accts] = await Promise.all([
    supabase.from("plaid_items").select("id, institution_name, kind, status, error_code, last_synced_at").eq("plan_id", planId).order("created_at"),
    supabase.from("plaid_accounts").select("*").eq("plan_id", planId).order("name"),
  ]);
  if (items.error || accts.error) {
    usePlaid.setState({ error: "Couldn't load your bank connections." });
    return;
  }
  usePlaid.setState({
    planId,
    loaded: true,
    error: undefined,
    items: (items.data as ItemRow[]).map((r) => ({ id: r.id, institution: r.institution_name || "Bank", kind: r.kind, status: r.status, errorCode: r.error_code, lastSyncedAt: r.last_synced_at })),
    accounts: (accts.data as AccountRow[]).map((r) => ({
      id: r.id, item: r.item, accountId: r.account_id, name: r.name, officialName: r.official_name, mask: r.mask, type: r.type, subtype: r.subtype,
      current: num(r.current), available: num(r.available), creditLimit: num(r.credit_limit), apr: num(r.apr), minPayment: num(r.min_payment), updatedAt: r.updated_at,
    })),
  });
}

/** Copy the bank balances into matched accounts and debts (only when something changed, so it doesn't re-save the plan). */
export function applyBanks(): void {
  const { accounts } = usePlaid.getState();
  if (!accounts.length) return;
  const s = useStore.getState();
  const reg = (id: string) => hasRegister(s.txns, id);
  if (!applyBankBalances(structuredClone(s.plan), accounts, reg)) return;
  s.update((p) => { applyBankBalances(p, accounts, reg); });
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  usePlaid.setState({ busy: true, error: undefined });
  try {
    return await fn();
  } catch (e) {
    usePlaid.setState({ error: e instanceof Error ? e.message : String(e) });
    return undefined;
  } finally {
    usePlaid.setState({ busy: false });
  }
}

/** Refresh balances from the banks (the server skips ones refreshed in the last few hours unless forced). */
export const syncBanks = (force = false) =>
  run(async () => {
    await call("sync", { force });
    await loadBanks();
    applyBanks();
  });

/* ---------- Plaid Link (web) ---------- */

type LinkMeta = { institution?: { institution_id?: string; name?: string } | null };
type LinkHandler = { open: () => void; destroy?: () => void };
type PlaidGlobal = { create: (o: { token: string; receivedRedirectUri?: string; onSuccess: (publicToken: string, meta: LinkMeta) => void; onExit: (err: { display_message?: string; error_message?: string } | null) => void }) => LinkHandler };

let script: Promise<PlaidGlobal> | null = null;
function loadLink(): Promise<PlaidGlobal> {
  if (Platform.OS !== "web" || typeof document === "undefined") return Promise.reject(new Error("Connecting a bank works in the web app for now."));
  const w = window as unknown as { Plaid?: PlaidGlobal };
  if (w.Plaid) return Promise.resolve(w.Plaid);
  if (!script)
    script = new Promise((resolve, reject) => {
      const el = document.createElement("script");
      el.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
      el.async = true;
      el.onload = () => (w.Plaid ? resolve(w.Plaid) : reject(new Error("Plaid didn't load.")));
      el.onerror = () => {
        script = null;
        reject(new Error("Couldn't load Plaid. Check your connection and try again."));
      };
      document.head.appendChild(el);
    });
  return script;
}

/**
 * A link in progress, kept for this browser tab: a bank that signs you in on its own site (OAuth) sends
 * you back to /plaid-oauth, a fresh page load, which picks the link up from here and finishes it.
 */
type PendingLink = { token: string; kind: "bank" | "investments"; itemId?: string; at: number };
const PENDING = "coastwise.plaidLink";
/** Plaid's link tokens last 4 hours; give up on one much older than a sign-in takes. */
const PENDING_FOR = 30 * 60_000;
const savePending = (p: PendingLink | null) => {
  try {
    if (p) sessionStorage.setItem(PENDING, JSON.stringify(p));
    else sessionStorage.removeItem(PENDING);
  } catch {
    // no storage (a private window): a bank that signs in on its own site won't come back to finish
  }
};
const readPending = (): PendingLink | null => {
  try {
    const p = JSON.parse(sessionStorage.getItem(PENDING) ?? "null") as PendingLink | null;
    return p && typeof p.token === "string" && Date.now() - p.at < PENDING_FOR ? p : null;
  } catch {
    return null;
  }
};

/**
 * Open Plaid's window with a link token; resolves with what it returns, or null if you closed it.
 * `returnedFrom`: the page a bank sent you back to (its address carries Plaid's OAuth state).
 */
async function openLink(token: string, returnedFrom?: string): Promise<{ publicToken: string; meta: LinkMeta } | null> {
  const P = await loadLink();
  return new Promise((resolve, reject) => {
    const done = <T,>(fn: (v: T) => void) => (v: T) => {
      savePending(null);
      fn(v);
    };
    const h = P.create({
      token,
      ...(returnedFrom ? { receivedRedirectUri: returnedFrom } : {}),
      onSuccess: (publicToken, meta) => done(resolve)({ publicToken, meta }),
      onExit: (err) => (err ? done(reject)(new Error(err.display_message || err.error_message || "The bank connection didn't finish.")) : done(resolve)(null)),
    });
    h.open();
  });
}

/** After the bank's window: save a new connection, or note a reconnected one, then refresh. */
async function finish(r: { publicToken: string; meta: LinkMeta } | null, kind: "bank" | "investments", itemId?: string) {
  if (!r) return;
  if (itemId) await call("reconnected", { itemId });
  else await call("exchange", { publicToken: r.publicToken, kind, institution: { id: r.meta.institution?.institution_id, name: r.meta.institution?.name } });
  await loadBanks();
  applyBanks();
}

/** Connect a bank or card ("bank") or an investment/retirement account ("investments"). */
export const connectBank = (kind: "bank" | "investments") =>
  run(async () => {
    const { linkToken } = await call<{ linkToken: string }>("link_token", { kind });
    savePending({ token: linkToken, kind, at: Date.now() });
    await finish(await openLink(linkToken), kind);
  });

/** Sign in to the bank again when it asks (same connection, same matches). */
export const reconnectBank = (itemId: string) =>
  run(async () => {
    const { linkToken } = await call<{ linkToken: string }>("link_token", { itemId });
    savePending({ token: linkToken, kind: "bank", itemId, at: Date.now() });
    await finish(await openLink(linkToken), "bank", itemId);
  });

/**
 * Back from a bank's own sign-in page (/plaid-oauth): reopen Plaid's window where it left off and finish
 * the link. False when there's nothing to finish (opened on its own, or too long ago).
 */
export async function resumeBankLink(returnedFrom: string): Promise<boolean> {
  const p = readPending();
  if (!p) return false;
  await run(async () => finish(await openLink(p.token, returnedFrom), p.kind, p.itemId));
  return true;
}

/** May this person connect new banks? (Before banks open to everyone: admins and people on a list.) */
export async function loadBankAccess(): Promise<void> {
  try {
    const r = await call<{ canLink: boolean }>("access");
    usePlaid.setState({ canLink: r.canLink });
  } catch {
    // unknown: leave the buttons; the server still refuses if it must
  }
}

/** Disconnect a bank: it's removed at Plaid too; your plan accounts stay, just no longer matched. */
export const disconnectBank = (itemId: string) =>
  run(async () => {
    const ids = usePlaid.getState().accounts.filter((a) => a.item === itemId).map((a) => a.accountId);
    await call("remove", { itemId });
    const s = useStore.getState();
    if (dropMatches(structuredClone(s.plan), ids)) s.update((p) => { dropMatches(p, ids); });
    await loadBanks();
  });

/** Sandbox only (local development): a test bank without the sign-in window. */
export const connectTestBank = (kind: "bank" | "investments") =>
  run(async () => {
    await call("sandbox_connect", { kind });
    await loadBanks();
    applyBanks();
  });

/** Once per plan while the app is open: refresh the bank balances (mounted under the tabs). */
let autoFor: string | undefined;
export function useBankAutoSync() {
  const planId = useSync((s) => s.planId);
  const userId = useSync((s) => s.userId);
  const status = useSync((s) => s.status);
  const onboarded = useStore((s) => s.onboarded);
  useEffect(() => {
    if (!BANKS_ON || !supabase || !planId || !userId || !onboarded || status !== "synced" || autoFor === planId) return;
    autoFor = planId;
    void (async () => {
      await loadBanks();
      if (usePlaid.getState().items.length) await syncBanks(false);
    })();
  }, [planId, userId, onboarded, status]);
}
