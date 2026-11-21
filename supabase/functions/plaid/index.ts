// The Supabase host for the Plaid core (../_shared/plaid-core.ts): checks the session, reads secrets,
// and stores connections in this project's tables. To run Plaid somewhere else (a Vercel or Node
// function), write the same small wrapper there: an env, a PlaidStore, and the signed-in user's id.
//
// POST { action, planId, ... } with the user's Supabase session (Authorization: Bearer <jwt>).
// Secrets: PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV, PLAID_TOKEN_KEY. Optional: PLAID_REDIRECT_URI
// (where OAuth banks send people back), PLAID_OPEN_TO_ALL=true (anyone may connect banks; otherwise
// admins and PLAID_ALLOWED_USERS, a comma-separated list of user ids).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the runtime.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { handle, needsSecondStep, PlaidHttpError, type PlaidEnv, type PlaidStore } from "../_shared/plaid-core.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const env: PlaidEnv = {
  clientId: Deno.env.get("PLAID_CLIENT_ID"),
  secret: Deno.env.get("PLAID_SECRET"),
  env: Deno.env.get("PLAID_ENV") ?? "sandbox",
  tokenKey: Deno.env.get("PLAID_TOKEN_KEY"),
  redirectUri: Deno.env.get("PLAID_REDIRECT_URI") || undefined,
  openToAll: Deno.env.get("PLAID_OPEN_TO_ALL") === "true",
  allowedUsers: (Deno.env.get("PLAID_ALLOWED_USERS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
};

/** The Plaid tables, through the service role (server only). */
function supabaseStore(db: SupabaseClient): PlaidStore {
  const ok = <T>(r: { data: T; error: unknown }): T => {
    if (r.error) throw new PlaidHttpError(500, "Couldn't save the bank connection.");
    return r.data;
  };
  return {
    async access(planId, userId) {
      if (planId === userId) return "owner";
      const r = await db.from("plan_members").select("role").eq("owner_id", planId).eq("member_id", userId).maybeSingle();
      return r.data?.role === "full" ? "full" : null;
    },
    async item(planId, id) {
      return ok(await db.from("plaid_items").select("id, item_id, kind, last_synced_at").eq("id", id).eq("plan_id", planId).maybeSingle());
    },
    async items(planId) {
      return ok(await db.from("plaid_items").select("id, last_synced_at").eq("plan_id", planId)) ?? [];
    },
    async addItem(row) {
      return ok(await db.from("plaid_items").insert(row).select("id").single()).id as string;
    },
    async updateItem(id, patch) {
      ok(await db.from("plaid_items").update(patch).eq("id", id));
    },
    async deleteItem(id) {
      ok(await db.from("plaid_items").delete().eq("id", id));
    },
    async secret(item) {
      return ok(await db.from("plaid_item_secrets").select("access_token_enc").eq("item", item).maybeSingle())?.access_token_enc ?? null;
    },
    async addSecret(item, accessTokenEnc) {
      ok(await db.from("plaid_item_secrets").insert({ item, access_token_enc: accessTokenEnc }));
    },
    async upsertAccounts(rows) {
      ok(await db.from("plaid_accounts").upsert(rows, { onConflict: "account_id" }));
    },
    async accountIds(item) {
      return (ok(await db.from("plaid_accounts").select("account_id").eq("item", item)) ?? []).map((r: { account_id: string }) => r.account_id);
    },
    async deleteAccounts(accountIds) {
      ok(await db.from("plaid_accounts").delete().in("account_id", accountIds));
    },
    async canLink(userId) {
      // admins: the app_admin table (added by hand on the server)
      const r = await db.from("app_admin").select("user_id").eq("user_id", userId).maybeSingle();
      return !r.error && !!r.data;
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const jwt = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    const user = jwt ? (await db.auth.getUser(jwt)).data.user : null;
    if (!user) throw new PlaidHttpError(401, "Sign in first.");
    if (needsSecondStep(jwt!, user.factors)) throw new PlaidHttpError(401, "Enter the code from your authenticator app first.");
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return json(await handle(body, user.id, env, supabaseStore(db)));
  } catch (e) {
    if (e instanceof PlaidHttpError) return json({ error: e.message, code: e.code }, e.status);
    console.error(e);
    return json({ error: "Something went wrong talking to the bank." }, 500);
  }
});
