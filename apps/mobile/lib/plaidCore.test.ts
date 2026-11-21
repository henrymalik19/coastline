// The Plaid core (supabase/functions/_shared/plaid-core.ts) runs here under Node with a fake store and a
// fake Plaid: it doesn't depend on Supabase or Deno, and bank tokens are only ever stored encrypted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handle, MAX_CONNECTIONS, needsSecondStep, PlaidHttpError, type AccountRow, type PlaidStore } from "../../../supabase/functions/_shared/plaid-core";

const KEY = btoa(String.fromCharCode(...new Uint8Array(32).map((_, i) => i)));
const env = { clientId: "id", secret: "sec", env: "sandbox", tokenKey: KEY };
const TOKEN = "access-sandbox-123";

function memStore(owner = "u1") {
  const items: Record<string, { id: string; plan_id: string; item_id: string; kind: string; last_synced_at: string | null; status?: string; error_code?: string | null }> = {};
  const secrets: Record<string, string> = {};
  const accounts: Record<string, AccountRow> = {};
  let n = 0;
  const store: PlaidStore = {
    access: async (planId, userId) => (planId === owner && userId === owner ? "owner" : null),
    item: async (planId, id) => (items[id]?.plan_id === planId ? items[id]! : null),
    items: async (planId) => Object.values(items).filter((i) => i.plan_id === planId),
    addItem: async (row) => {
      const id = `it${++n}`;
      items[id] = { id, plan_id: row.plan_id, item_id: row.item_id, kind: row.kind, last_synced_at: null };
      return id;
    },
    updateItem: async (id, patch) => void Object.assign(items[id]!, patch),
    deleteItem: async (id) => {
      delete items[id];
      delete secrets[id];
      for (const [k, a] of Object.entries(accounts)) if (a.item === id) delete accounts[k];
    },
    secret: async (item) => secrets[item] ?? null,
    addSecret: async (item, enc) => void (secrets[item] = enc),
    upsertAccounts: async (rows) => rows.forEach((r) => (accounts[r.account_id] = r)),
    accountIds: async (item) => Object.values(accounts).filter((a) => a.item === item).map((a) => a.account_id),
    deleteAccounts: async (ids) => ids.forEach((id) => delete accounts[id]),
  };
  return { store, items, secrets, accounts };
}

/** A fake Plaid: answers by path; `fail` makes /accounts/get return that error code. */
function fakePlaid(fail?: string) {
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
    const path = new URL(url).pathname;
    const body = JSON.parse(init.body) as Record<string, unknown>;
    calls.push({ path, body });
    const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200 });
    if (path === "/item/public_token/exchange") return ok({ access_token: TOKEN, item_id: "plaid-item-1" });
    if (path === "/item/get") return ok({ item: { institution_id: "ins_1" } });
    if (path === "/institutions/get_by_id") return ok({ institution: { name: "First Platypus Bank" } });
    if (path === "/accounts/get") {
      if (fail) return new Response(JSON.stringify({ error_code: fail, error_message: "x" }), { status: 400 });
      return ok({
        accounts: [
          { account_id: "chk", name: "Plaid Checking", mask: "0000", type: "depository", subtype: "checking", balances: { current: 110, available: 100 } },
          { account_id: "cc", name: "Plaid Credit Card", mask: "3333", type: "credit", subtype: "credit card", balances: { current: 410, limit: 2000 } },
        ],
      });
    }
    if (path === "/liabilities/get") return ok({ liabilities: { credit: [{ account_id: "cc", aprs: [{ apr_percentage: 15.24, apr_type: "purchase_apr" }], minimum_payment_amount: 20 }] } });
    if (path === "/item/remove") return ok({});
    if (path === "/link/token/create") return ok({ link_token: "link-sandbox-abc" });
    return new Response("{}", { status: 404 });
  });
  return calls;
}

beforeEach(() => vi.useRealTimers());
afterEach(() => vi.unstubAllGlobals());

describe("who may connect new banks (production)", () => {
  const prod = { ...env, env: "production" };
  it("refuses new banks to someone not allowed, but they can still refresh and remove ones they have", async () => {
    const { store } = memStore();
    fakePlaid();
    await expect(handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", prod, store)).rejects.toMatchObject({ status: 403, code: "NOT_ALLOWED" });
    await expect(handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", prod, store)).rejects.toMatchObject({ code: "NOT_ALLOWED" });
    expect(await handle({ action: "access", planId: "u1" }, "u1", prod, store)).toEqual({ canLink: false });
    expect(await handle({ action: "sync", planId: "u1", force: true }, "u1", prod, store)).toEqual({ items: 0 });
  });
  it("lets admins, listed people, or everyone (when open) connect", async () => {
    const { store } = memStore();
    fakePlaid();
    expect(await handle({ action: "access", planId: "u1" }, "u1", { ...prod, allowedUsers: ["u1"] }, store)).toEqual({ canLink: true });
    expect(await handle({ action: "access", planId: "u1" }, "u1", { ...prod, openToAll: true }, store)).toEqual({ canLink: true });
    const admin = { ...store, canLink: async (u: string) => u === "u1" };
    expect(await handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", prod, admin)).toEqual({ linkToken: "link-sandbox-abc" });
  });
  it("sends the redirect address for banks that sign in on their own site", async () => {
    const { store } = memStore();
    const calls = fakePlaid();
    await handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", { ...env, redirectUri: "https://getcoastwise.com/plaid-oauth" }, store);
    expect(calls.find((c) => c.path === "/link/token/create")?.body.redirect_uri).toBe("https://getcoastwise.com/plaid-oauth");
    await handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", env, store);
    expect(calls.filter((c) => c.path === "/link/token/create")[1]?.body.redirect_uri).toBeUndefined();
  });
});

describe("plaid core", () => {
  it("refuses a plan you don't have access to", async () => {
    const { store } = memStore();
    fakePlaid();
    await expect(handle({ action: "sync", planId: "someone-else" }, "u1", env, store)).rejects.toBeInstanceOf(PlaidHttpError);
  });

  it("connects: stores the token encrypted, names the bank, and pulls balances and card rates", async () => {
    const { store, items, secrets, accounts } = memStore();
    fakePlaid();
    const r = (await handle({ action: "exchange", planId: "u1", publicToken: "public-1", kind: "bank" }, "u1", env, store)) as { itemId: string };
    expect(items[r.itemId]).toMatchObject({ item_id: "plaid-item-1", status: "ok" });
    const enc = secrets[r.itemId]!;
    expect(enc.startsWith("v1:")).toBe(true);
    expect(enc).not.toContain(TOKEN);
    expect(accounts.chk).toMatchObject({ type: "depository", current: 110, mask: "0000" });
    expect(accounts.cc).toMatchObject({ type: "credit", current: 410, apr: 0.1524, min_payment: 20 });
  });

  it("decrypts the token to call Plaid again, and marks a connection that needs a new sign-in", async () => {
    const { store, items } = memStore();
    fakePlaid();
    const { itemId } = (await handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", env, store)) as { itemId: string };
    items[itemId]!.last_synced_at = new Date(Date.now() - 10 * 60_000).toISOString();
    const calls = fakePlaid("ITEM_LOGIN_REQUIRED");
    await handle({ action: "sync", planId: "u1", force: true }, "u1", env, store);
    expect(calls.find((c) => c.path === "/accounts/get")?.body.access_token).toBe(TOKEN);
    expect(items[itemId]).toMatchObject({ status: "login_required", error_code: "ITEM_LOGIN_REQUIRED" });
  });

  it("skips connections refreshed in the last few hours unless forced, and a forced one in the last few minutes", async () => {
    const { store, items } = memStore();
    fakePlaid();
    const { itemId } = (await handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", env, store)) as { itemId: string };
    const calls = fakePlaid();
    await handle({ action: "sync", planId: "u1", force: true }, "u1", env, store);
    expect(calls.some((c) => c.path === "/accounts/get")).toBe(false);
    items[itemId]!.last_synced_at = new Date(Date.now() - 10 * 60_000).toISOString();
    await handle({ action: "sync", planId: "u1" }, "u1", env, store);
    expect(calls.some((c) => c.path === "/accounts/get")).toBe(false);
    await handle({ action: "sync", planId: "u1", force: true }, "u1", env, store);
    expect(calls.some((c) => c.path === "/accounts/get")).toBe(true);
  });

  it("caps the connections on a plan, and hides Plaid's technical error text", async () => {
    const { store } = memStore();
    fakePlaid();
    for (let i = 0; i < MAX_CONNECTIONS; i++) await handle({ action: "exchange", planId: "u1", publicToken: `p${i}`, kind: "bank" }, "u1", env, store);
    await expect(handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", env, store)).rejects.toMatchObject({ code: "TOO_MANY" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error_code: "INVALID_FIELD", error_message: "client_id 123 is not valid" }), { status: 400 }));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { store: s2 } = memStore();
    const err = await handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", env, s2).catch((e: Error) => e);
    expect((err as Error).message).not.toContain("client_id");
  });

  it("disconnects at Plaid and removes it here", async () => {
    const { store, items, accounts } = memStore();
    fakePlaid();
    const { itemId } = (await handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", env, store)) as { itemId: string };
    const calls = fakePlaid();
    await handle({ action: "remove", planId: "u1", itemId }, "u1", env, store);
    expect(calls.some((c) => c.path === "/item/remove")).toBe(true);
    expect(items[itemId]).toBeUndefined();
    expect(Object.keys(accounts)).toHaveLength(0);
  });

  it("disconnects every bank on your own plan before the account is deleted", async () => {
    const { store, items } = memStore();
    fakePlaid();
    await handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", env, store);
    await handle({ action: "exchange", planId: "u1", publicToken: "p2", kind: "investments" }, "u1", env, store);
    const calls = fakePlaid();
    expect(await handle({ action: "remove_all", planId: "u1" }, "u1", env, store)).toEqual({ removed: 2 });
    expect(calls.filter((c) => c.path === "/item/remove")).toHaveLength(2);
    expect(Object.keys(items)).toHaveLength(0);
  });

  it("keeps the connection (and stops) when Plaid can't disconnect it", async () => {
    const { store, items } = memStore();
    fakePlaid();
    await handle({ action: "exchange", planId: "u1", publicToken: "p", kind: "bank" }, "u1", env, store);
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error_code: "INTERNAL_SERVER_ERROR" }), { status: 500 }));
    await expect(handle({ action: "remove_all", planId: "u1" }, "u1", env, store)).rejects.toBeInstanceOf(PlaidHttpError);
    expect(Object.keys(items)).toHaveLength(1);
  });

  it("asks for investments only on an investment connection", async () => {
    const { store } = memStore();
    const calls = fakePlaid();
    await handle({ action: "link_token", planId: "u1", kind: "investments" }, "u1", env, store);
    expect(calls[0]!.body).toMatchObject({ products: ["investments"] });
    await handle({ action: "link_token", planId: "u1", kind: "bank" }, "u1", env, store);
    expect(calls[1]!.body).toMatchObject({ products: ["transactions"], optional_products: ["liabilities"] });
  });
});

describe("two-step sign-in", () => {
  const tok = (claims: object) => `h.${btoa(JSON.stringify(claims)).replace(/=+$/, "")}.s`;
  it("lets people without a second step through", () => {
    expect(needsSecondStep(tok({ aal: "aal1" }), [])).toBe(false);
    expect(needsSecondStep(tok({ aal: "aal1" }), [{ status: "unverified" }])).toBe(false);
  });
  it("needs aal2 once an authenticator app is set up", () => {
    expect(needsSecondStep(tok({ aal: "aal1" }), [{ status: "verified" }])).toBe(true);
    expect(needsSecondStep(tok({ aal: "aal2" }), [{ status: "verified" }])).toBe(false);
    expect(needsSecondStep("not-a-token", [{ status: "verified" }])).toBe(true);
  });
});
