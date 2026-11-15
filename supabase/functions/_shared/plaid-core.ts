// Plaid bank connections: the logic, with no ties to where it runs.
//
// Only standard web APIs (fetch, WebCrypto, atob/btoa), so it runs the same in a Supabase function
// (Deno), a Vercel/Node function, or any other server. The host supplies three things:
//   - env:   Plaid keys and the token key
//   - store: a small storage interface (the plaid_items / plaid_item_secrets / plaid_accounts tables)
//   - the signed-in user's id (the host checks the session)
// and calls handle(). See supabase/functions/plaid/index.ts for the Supabase host.
//
// Actions (body.action), all for one plan (body.planId):
//   link_token   { kind: "bank" | "investments" } or { itemId } (reconnect)  -> { linkToken }
//   exchange     { publicToken, kind, institution?: { id, name } }            -> { itemId }
//   reconnected  { itemId }                                                    -> { ok }
//   sync         { force?: boolean }                                           -> { items }
//   remove       { itemId }                                                    -> { ok }
//   remove_all   {}  (your own plan only; before deleting the account)         -> { removed }
//   sandbox_connect { kind }  (Sandbox only: a test bank without the Link window) -> { itemId }

export type PlaidEnv = {
  clientId?: string;
  secret?: string;
  /** "sandbox" (default) or "production" */
  env?: string;
  /** 32 random bytes, base64: encrypts access tokens at rest */
  tokenKey?: string;
};

export type ItemRow = { id: string; item_id: string; kind: string; last_synced_at: string | null };
export type ItemUpdate = { status: string; error_code: string | null; last_synced_at?: string };
export type AccountRow = {
  plan_id: string; item: string; account_id: string; name: string; official_name: string | null; mask: string | null;
  type: string; subtype: string | null; current: number | null; available: number | null; credit_limit: number | null;
  currency: string | null; apr: number | null; min_payment: number | null; updated_at: string;
};

/** Where connections are kept. Every method throws on a storage error. */
export interface PlaidStore {
  /** "owner" when userId owns planId, "full" for a household member with full access, else null. */
  access(planId: string, userId: string): Promise<"owner" | "full" | null>;
  item(planId: string, id: string): Promise<ItemRow | null>;
  items(planId: string): Promise<{ id: string; last_synced_at: string | null }[]>;
  addItem(row: { plan_id: string; item_id: string; kind: string; institution_id: string | null; institution_name: string | null; created_by: string }): Promise<string>;
  updateItem(id: string, patch: ItemUpdate): Promise<void>;
  deleteItem(id: string): Promise<void>;
  secret(item: string): Promise<string | null>;
  addSecret(item: string, accessTokenEnc: string): Promise<void>;
  upsertAccounts(rows: AccountRow[]): Promise<void>;
  accountIds(item: string): Promise<string[]>;
  deleteAccounts(accountIds: string[]): Promise<void>;
}

export class PlaidHttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

/* ---------- Plaid API ---------- */

type PlaidErrorBody = { error_code?: string; error_message?: string; display_message?: string | null };

function api(env: PlaidEnv) {
  const base = env.env === "production" ? "https://production.plaid.com" : "https://sandbox.plaid.com";
  return async function plaid<T>(path: string, body: Record<string, unknown>): Promise<T> {
    if (!env.clientId || !env.secret) throw new PlaidHttpError(500, "Bank connections aren't set up on the server yet (Plaid keys missing).", "NOT_CONFIGURED");
    const res = await fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: env.clientId, secret: env.secret, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = data as PlaidErrorBody;
      throw new PlaidHttpError(res.status >= 500 ? 502 : 400, e.display_message || e.error_message || `Plaid ${path} failed`, e.error_code);
    }
    return data as T;
  };
}

/* ---------- access tokens, encrypted at rest (AES-GCM) ---------- */

const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function cipher(env: PlaidEnv) {
  let keyP: Promise<CryptoKey> | null = null;
  const key = () => {
    if (!keyP) {
      if (!env.tokenKey) throw new PlaidHttpError(500, "Bank connections aren't set up on the server yet (token key missing).", "NOT_CONFIGURED");
      const raw = fromB64(env.tokenKey);
      if (raw.length !== 32) throw new PlaidHttpError(500, "The token key must be 32 bytes (base64).", "NOT_CONFIGURED");
      keyP = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    }
    return keyP;
  };
  return {
    async encrypt(text: string): Promise<string> {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(text)));
      return `v1:${toB64(iv)}:${toB64(ct)}`;
    },
    async decrypt(stored: string): Promise<string> {
      const [v, iv, ct] = stored.split(":");
      if (v !== "v1" || !iv || !ct) throw new PlaidHttpError(500, "Unreadable bank token.");
      return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await key(), fromB64(ct)));
    },
  };
}

/* ---------- Plaid's shapes (only what's used) ---------- */

type PlaidAccount = {
  account_id: string; name: string; official_name?: string | null; mask?: string | null; type: string; subtype?: string | null;
  balances: { current?: number | null; available?: number | null; limit?: number | null; iso_currency_code?: string | null };
};
type Liabilities = {
  credit?: { account_id: string; aprs?: { apr_percentage: number; apr_type: string }[]; minimum_payment_amount?: number | null }[] | null;
  student?: { account_id: string; interest_rate_percentage?: number | null; minimum_payment_amount?: number | null }[] | null;
  mortgage?: { account_id: string; interest_rate?: { percentage?: number | null } | null; next_monthly_payment?: number | null }[] | null;
};

const STATUS_FOR: Record<string, string> = { ITEM_LOGIN_REQUIRED: "login_required", PENDING_EXPIRATION: "pending_expiration" };
const PRODUCTS = (kind: string) => (kind === "investments" ? { products: ["investments"] } : { products: ["transactions"], optional_products: ["liabilities"] });
/** Plaid's "First Platypus Bank" test institution (Sandbox only). */
const SANDBOX_INSTITUTION = "ins_109508";

/* ---------- the handler ---------- */

/** Run one action for a signed-in user. Throws PlaidHttpError with a message fit to show. */
export async function handle(body: Record<string, unknown>, userId: string, env: PlaidEnv, store: PlaidStore): Promise<unknown> {
  const plaid = api(env);
  const box = cipher(env);

  const planId = body.planId;
  if (typeof planId !== "string" || !planId) throw new PlaidHttpError(400, "Which plan?");
  if (!(await store.access(planId, userId))) throw new PlaidHttpError(403, "You can't connect banks to this plan.");

  const itemOf = async (itemId: unknown) => {
    if (typeof itemId !== "string") throw new PlaidHttpError(400, "Which connection?");
    const it = await store.item(planId, itemId);
    if (!it) throw new PlaidHttpError(404, "That connection isn't on this plan.");
    return it;
  };
  const accessToken = async (item: string) => {
    const enc = await store.secret(item);
    if (!enc) throw new PlaidHttpError(500, "This connection's token is missing. Remove it and connect again.");
    return box.decrypt(enc);
  };

  /** Pull one connection's accounts and balances (and card/loan rates when shared). Records a bank error on the item. */
  const syncItem = async (item: string, token?: string) => {
    try {
      const access_token = token ?? (await accessToken(item));
      const { accounts } = await plaid<{ accounts: PlaidAccount[] }>("/accounts/get", { access_token });
      const rates = new Map<string, { apr?: number; min?: number }>();
      if (accounts.some((a) => a.type === "credit" || a.type === "loan")) {
        try {
          const { liabilities: l } = await plaid<{ liabilities: Liabilities }>("/liabilities/get", { access_token });
          for (const c of l.credit ?? []) {
            const apr = c.aprs?.find((x) => x.apr_type === "purchase_apr") ?? c.aprs?.[0];
            rates.set(c.account_id, { apr: apr ? apr.apr_percentage / 100 : undefined, min: c.minimum_payment_amount ?? undefined });
          }
          for (const s of l.student ?? []) rates.set(s.account_id, { apr: s.interest_rate_percentage != null ? s.interest_rate_percentage / 100 : undefined, min: s.minimum_payment_amount ?? undefined });
          for (const m of l.mortgage ?? []) rates.set(m.account_id, { apr: m.interest_rate?.percentage != null ? m.interest_rate.percentage / 100 : undefined, min: m.next_monthly_payment ?? undefined });
        } catch {
          // not every bank shares rates (or the product isn't on this connection): balances still count
        }
      }
      const now = new Date().toISOString();
      if (accounts.length)
        await store.upsertAccounts(
          accounts.map((a) => ({
            plan_id: planId, item, account_id: a.account_id, name: a.name ?? "", official_name: a.official_name ?? null, mask: a.mask ?? null,
            type: a.type, subtype: a.subtype ?? null, current: a.balances.current ?? null, available: a.balances.available ?? null,
            credit_limit: a.balances.limit ?? null, currency: a.balances.iso_currency_code ?? null,
            apr: rates.get(a.account_id)?.apr ?? null, min_payment: rates.get(a.account_id)?.min ?? null, updated_at: now,
          })),
        );
      // accounts the bank no longer lists
      const keep = new Set(accounts.map((a) => a.account_id));
      const gone = (await store.accountIds(item)).filter((id) => !keep.has(id));
      if (gone.length) await store.deleteAccounts(gone);
      await store.updateItem(item, { status: "ok", error_code: null, last_synced_at: now });
    } catch (e) {
      const code = e instanceof PlaidHttpError ? e.code : undefined;
      if (code === "NOT_CONFIGURED") throw e;
      await store.updateItem(item, { status: (code && STATUS_FOR[code]) || "error", error_code: code ?? "UNKNOWN" });
    }
  };

  const saveItem = async (publicToken: string, kind: string, institution?: { id?: string; name?: string }) => {
    const ex = await plaid<{ access_token: string; item_id: string }>("/item/public_token/exchange", { public_token: publicToken });
    let inst = institution;
    if (!inst?.name) {
      // the Link window tells the app which bank; the sandbox shortcut doesn't, so ask Plaid
      try {
        const it = await plaid<{ item: { institution_id?: string } }>("/item/get", { access_token: ex.access_token });
        const id = it.item.institution_id;
        if (id) {
          const ins = await plaid<{ institution: { name: string } }>("/institutions/get_by_id", { institution_id: id, country_codes: ["US"] });
          inst = { id, name: ins.institution.name };
        }
      } catch {
        // a name is nice to have
      }
    }
    const id = await store.addItem({ plan_id: planId, item_id: ex.item_id, kind, institution_id: inst?.id ?? null, institution_name: inst?.name ?? null, created_by: userId });
    try {
      await store.addSecret(id, await box.encrypt(ex.access_token));
    } catch (e) {
      await store.deleteItem(id);
      throw e;
    }
    await syncItem(id, ex.access_token);
    return { itemId: id };
  };

  const kindOf = (v: unknown) => (v === "investments" ? "investments" : "bank");

  switch (body.action) {
    case "link_token": {
      const base = { client_name: "Coastwise", language: "en", country_codes: ["US"], user: { client_user_id: userId } };
      if (body.itemId) {
        // update mode: sign in to the bank again (same connection)
        const it = await itemOf(body.itemId);
        const r = await plaid<{ link_token: string }>("/link/token/create", { ...base, access_token: await accessToken(it.id) });
        return { linkToken: r.link_token };
      }
      const r = await plaid<{ link_token: string }>("/link/token/create", { ...base, ...PRODUCTS(kindOf(body.kind)) });
      return { linkToken: r.link_token };
    }
    case "exchange":
      if (typeof body.publicToken !== "string") throw new PlaidHttpError(400, "Missing the bank's token.");
      return saveItem(body.publicToken, kindOf(body.kind), body.institution as { id?: string; name?: string } | undefined);
    case "reconnected": {
      const it = await itemOf(body.itemId);
      await syncItem(it.id);
      return { ok: true };
    }
    case "sync": {
      // each connection at most every few hours unless forced (banks update about daily)
      const list = await store.items(planId);
      const stale = Date.now() - 4 * 3600_000;
      for (const it of list) {
        if (body.force !== true && it.last_synced_at && Date.parse(it.last_synced_at) > stale) continue;
        await syncItem(it.id);
      }
      return { items: list.length };
    }
    case "remove": {
      const it = await itemOf(body.itemId);
      try {
        await plaid("/item/remove", { access_token: await accessToken(it.id) });
      } catch {
        // already gone at Plaid: still remove it here
      }
      await store.deleteItem(it.id);
      return { ok: true };
    }
    case "remove_all": {
      // before deleting your account: disconnect every bank on your own plan at Plaid, so access (and billing) ends
      if (planId !== userId) throw new PlaidHttpError(403, "Only the plan's owner can do that.");
      const list = await store.items(planId);
      for (const it of list) {
        try {
          await plaid("/item/remove", { access_token: await accessToken(it.id) });
        } catch (e) {
          // already gone at Plaid is fine; anything else (Plaid down, keys missing) stops so the account isn't deleted with banks still connected
          const code = e instanceof PlaidHttpError ? e.code : undefined;
          if (code !== "ITEM_NOT_FOUND" && code !== "INVALID_ACCESS_TOKEN") throw new PlaidHttpError(502, "Couldn't disconnect your banks. Try again in a moment.");
        }
        await store.deleteItem(it.id);
      }
      return { removed: list.length };
    }
    case "sandbox_connect": {
      if ((env.env ?? "sandbox") !== "sandbox") throw new PlaidHttpError(400, "Sandbox only.");
      const kind = kindOf(body.kind);
      const p = await plaid<{ public_token: string }>("/sandbox/public_token/create", {
        institution_id: SANDBOX_INSTITUTION,
        initial_products: kind === "investments" ? ["investments"] : ["transactions", "liabilities"],
      });
      return saveItem(p.public_token, kind);
    }
    default:
      throw new PlaidHttpError(400, "Unknown action.");
  }
}
