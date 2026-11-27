/**
 * Bank connections (Plaid). The app never talks to Plaid with keys: it asks the `plaid` server function,
 * reads the results (plaid_items, plaid_accounts) with the user's own session, and copies balances into
 * the plan accounts and debts they're matched to. Plaid's sign-in window (Link) opens on the web.
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { BANKS_ON } from "./features";
import { applyBankBalances, dropMatches, fillDebtTerms, type BankAccount } from "./plaidMatch";
import { type BankTxn } from "./bankTxns";
import { hasRegister, isCard } from "./register";
import { useStore } from "./store";
import { supabase } from "./supabase";
import { useSync } from "./sync";

// the loaded connections and accounts live in lib/plaidState.ts (no imports there, so lib/plan.ts can read them)
export { usePlaid, type BankItem } from "./plaidState";
import { usePlaid, type BankItem } from "./plaidState";

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

/** A load in flight: pages that show banks at the same time share it instead of each asking. */
let loading: Promise<void> | undefined;
/** Read this plan's connections and bank accounts (the app's own session; row level security). */
export function loadBanks(): Promise<void> {
  if (!loading) loading = loadBanksNow().finally(() => { loading = undefined; });
  return loading;
}

async function loadBanksNow(): Promise<void> {
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

/** When this device last saved the bank balances into the plan, per plan (this device only). */
const SNAP = "coastwise.bankSnapshot";
const DAY = 24 * 3600_000;
const snapshotAt = (planId: string): number => {
  try {
    return Number((JSON.parse(globalThis.localStorage?.getItem(SNAP) ?? "{}") as Record<string, number>)[planId] ?? 0);
  } catch {
    return 0;
  }
};
const markSnapshot = (planId: string) => {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(SNAP) ?? "{}") as Record<string, number>;
    globalThis.localStorage?.setItem(SNAP, JSON.stringify({ ...all, [planId]: Date.now() }));
  } catch {
    // no storage: it saves again next time, which is fine
  }
};

/**
 * After the bank data loads. Screens show the bank's balances without editing the plan (usePlan lays
 * them over it). The plan itself gets them at most once a day (`force`: now, e.g. before disconnecting),
 * so a device that isn't signed in, and plan history, still have recent numbers. A debt's rate and
 * minimum fill in whenever you haven't set them.
 */
export function applyBanks(force = false): void {
  const { accounts, planId } = usePlaid.getState();
  if (!accounts.length) return;
  const s = useStore.getState();
  const reg = (id: string) => hasRegister(s.txns, id);
  const due = force || !planId || Date.now() - snapshotAt(planId) > DAY;
  const balances = due && applyBankBalances(structuredClone(s.plan), accounts, reg);
  const terms = fillDebtTerms(structuredClone(s.plan), accounts);
  if (planId && due) markSnapshot(planId);
  if (!balances && !terms) return;
  s.update((p) => {
    if (balances) applyBankBalances(p, accounts, reg);
    fillDebtTerms(p, accounts);
  });
}

/**
 * Where this device last read the bank transactions to (the server's time), per plan, and for which of
 * your accounts: matching another account to a bank reads them all again, so that one's come in too.
 */
const TXNS_AT = "coastwise.bankTxnsAt";
type TxnsAt = { at: string; accounts: string };
const readTxnsAt = (planId: string): TxnsAt | undefined => {
  try {
    return (JSON.parse(globalThis.localStorage?.getItem(TXNS_AT) ?? "{}") as Record<string, TxnsAt>)[planId];
  } catch {
    return undefined;
  }
};
const markTxnsAt = (planId: string, v: TxnsAt) => {
  try {
    const all = JSON.parse(globalThis.localStorage?.getItem(TXNS_AT) ?? "{}") as Record<string, TxnsAt>;
    globalThis.localStorage?.setItem(TXNS_AT, JSON.stringify({ ...all, [planId]: v }));
  } catch {
    // no storage: it reads them all again next time, which changes nothing
  }
};
type BankTxnRow = {
  transaction_id: string; account_id: string; date: string; amount: number | string; name: string; merchant_name: string | null;
  pending: boolean; pending_transaction_id: string | null; removed: boolean; updated_at: string;
};
const PAGE = 1000;

/**
 * Bring in the bank transactions the server has that this device hasn't merged yet (only for accounts
 * you've matched to a bank). Returns how many came in new.
 */
export async function pullBankTxns(): Promise<number> {
  const planId = useSync.getState().planId;
  if (!supabase || !planId) return 0;
  // matched to a bank, and from when: matching another one, or one starting again (the budget started
  // over), reads them all again; so does one still waiting for its start (the budget hasn't started)
  const sig = () => {
    const p = useStore.getState().plan;
    return [...p.accounts, ...p.debts].flatMap((x) => (x.plaidAccountId ? [`${x.plaidAccountId}:${x.bankFrom ?? ""}`] : [])).sort().join(",");
  };
  const waiting = () => {
    const { plan: p, txns } = useStore.getState();
    return [...p.accounts.filter((a) => a.type === "cash"), ...p.debts.filter(isCard)].some((x) => x.plaidAccountId && (!x.bankFrom || !hasRegister(txns, x.id)));
  };
  const accounts = sig();
  if (!accounts) return 0;
  const last = readTxnsAt(planId);
  const since = last?.accounts === accounts && !waiting() ? last.at : undefined;
  const rows: BankTxnRow[] = [];
  for (let from = 0; ; from += PAGE) {
    // the same moment again too (>=): merging one twice changes nothing
    let q = supabase.from("plaid_transactions").select("transaction_id, account_id, date, amount, name, merchant_name, pending, pending_transaction_id, removed, updated_at").eq("plan_id", planId);
    if (since) q = q.gte("updated_at", since);
    const r = await q.order("updated_at").order("transaction_id").range(from, from + PAGE - 1);
    if (r.error) return 0; // not there yet (the table comes with the server change), or offline: next time
    rows.push(...(r.data as BankTxnRow[]));
    if (r.data.length < PAGE) break;
  }
  if (!rows.length) return 0;
  const bank: BankTxn[] = rows.map((r) => ({
    transactionId: r.transaction_id, accountId: r.account_id, date: String(r.date).slice(0, 10), amount: Number(r.amount), name: r.name,
    merchantName: r.merchant_name, pending: r.pending, pendingTransactionId: r.pending_transaction_id, removed: r.removed,
  }));
  // the bank's balance now (an account whose transactions start here starts from it)
  const current = new Map(usePlaid.getState().accounts.flatMap((a) => (a.current == null ? [] : [[a.accountId, a.current] as const])));
  const added = useStore.getState().mergeBank(bank, current);
  markTxnsAt(planId, { at: rows.reduce((m, r) => (r.updated_at > m ? r.updated_at : m), since ?? ""), accounts: sig() });
  return added;
}

/** Plaid's message in plain words where it's one we know (the rest as Plaid says it). */
export function plainBankError(msg: string): string {
  if (/register your application with this institution|isn't available yet|institution registration/i.test(msg))
    return "This bank isn't open to Coastwise yet: the connection to it is still being set up (it can take a day). Try again later, or connect another bank.";
  if (/institution.*(down|not responding)|INSTITUTION_(DOWN|NOT_RESPONDING)/i.test(msg)) return "The bank isn't responding right now. Try again in a little while.";
  return msg;
}

async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
  usePlaid.setState({ busy: true, error: undefined });
  try {
    return await fn();
  } catch (e) {
    usePlaid.setState({ error: plainBankError(e instanceof Error ? e.message : String(e)) });
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
    await pullBankTxns();
  });

/**
 * After you set up a connection's accounts: bring in their transactions without a reload. A new
 * connection's history often isn't ready at the bank yet, so it asks again a little later (twice),
 * stopping once transactions come in.
 */
let following = false;
export function pullAfterSetup(): void {
  if (following || !BANKS_ON || !supabase) return;
  following = true;
  void (async () => {
    try {
      for (const wait of [0, 30_000, 120_000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const before = useStore.getState().txns.length;
        await syncBanks(true);
        if (useStore.getState().txns.length > before) break;
      }
    } finally {
      following = false;
    }
  })();
}

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
  const added = itemId ? undefined : await call<{ itemId: string }>("exchange", { publicToken: r.publicToken, kind, institution: { id: r.meta.institution?.institution_id, name: r.meta.institution?.name } });
  await loadBanks();
  applyBanks();
  // a new connection: go through its accounts one by one (new, one you have, or not used)
  if (added?.itemId) usePlaid.setState({ review: added.itemId });
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
/** Who it was asked for, and the request in flight (asked once per plan, not on every page that shows banks). */
let accessFor: string | undefined;
let accessAsk: Promise<void> | undefined;
export function loadBankAccess(): Promise<void> {
  const planId = useSync.getState().planId;
  if (accessAsk) return accessAsk;
  if (planId && accessFor === planId && usePlaid.getState().canLink !== undefined) return Promise.resolve();
  accessAsk = (async () => {
    try {
      const r = await call<{ canLink: boolean }>("access");
      accessFor = planId;
      usePlaid.setState({ canLink: r.canLink, accessFailed: false });
    } catch {
      // unknown: the server still refuses if it must; the page says it couldn't check
      usePlaid.setState({ accessFailed: true });
    } finally {
      accessAsk = undefined;
    }
  })();
  return accessAsk;
}

/** Disconnect a bank: it's removed at Plaid too; your plan accounts stay, just no longer matched. */
export const disconnectBank = (itemId: string) =>
  run(async () => {
    const ids = usePlaid.getState().accounts.filter((a) => a.item === itemId).map((a) => a.accountId);
    // the accounts keep the balances they show now (the plan may only have yesterday's)
    applyBanks(true);
    await call("remove", { itemId });
    const s = useStore.getState();
    if (dropMatches(structuredClone(s.plan), ids)) s.update((p) => { dropMatches(p, ids); });
    await loadBanks();
  });

/** Sandbox only (local development): a test bank without the sign-in window. */
export const connectTestBank = (kind: "bank" | "investments") =>
  run(async () => {
    const added = await call<{ itemId: string }>("sandbox_connect", { kind });
    await loadBanks();
    applyBanks();
    if (added?.itemId) usePlaid.setState({ review: added.itemId });
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
