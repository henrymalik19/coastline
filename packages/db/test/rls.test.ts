/**
 * Row-level security tests against the local Supabase stack (`pnpm db:start`).
 * Proves each user can only see and change their own rows (PLAN.md Phase 3 acceptance).
 * Skipped automatically when the local stack isn't running.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

function localEnv(): Record<string, string> | null {
  try {
    const out = execSync("npx supabase status -o env", { cwd: new URL("../../..", import.meta.url), stdio: ["ignore", "pipe", "ignore"] }).toString();
    const env: Record<string, string> = {};
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
      if (m) env[m[1]!] = m[2]!;
    }
    return env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY ? env : null;
  } catch {
    return null;
  }
}

const env = localEnv();
const plan = (marker: string) => ({ version: 2, marker });

describe.skipIf(!env)("row-level security (local Supabase)", () => {
  const url = env?.API_URL ?? "";
  const anonKey = env?.ANON_KEY ?? "";
  const admin = createClient(url, env?.SERVICE_ROLE_KEY ?? "", { auth: { persistSession: false } });
  const users: { id: string; client: SupabaseClient }[] = [];

  async function newUser() {
    const email = `rls-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    const u = { id: data.user.id, client };
    users.push(u);
    return u;
  }

  let a: Awaited<ReturnType<typeof newUser>>;
  let b: Awaited<ReturnType<typeof newUser>>;

  beforeAll(async () => {
    a = await newUser();
    b = await newUser();
    const { error } = await a.client.from("plans").insert({ state: plan("A"), client_updated_at: 100 });
    if (error) throw error;
    const ci = await a.client.from("checkins").insert({ month: "2026-11-01", invested: 1, cash: 2, debt: 3, net_worth: 0, expected_next_invested: 1 });
    if (ci.error) throw ci.error;
  });

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  });

  it("a profile is created on sign-up, and only its owner can see it", async () => {
    const own = await a.client.from("profiles").select("id");
    expect(own.data?.map((r) => r.id)).toEqual([a.id]);
  });

  it("user B can't read user A's plan or check-ins", async () => {
    const plans = await b.client.from("plans").select("*").eq("user_id", a.id);
    expect(plans.error).toBeNull();
    expect(plans.data).toEqual([]);
    const checkins = await b.client.from("checkins").select("*").eq("user_id", a.id);
    expect(checkins.data).toEqual([]);
    const profiles = await b.client.from("profiles").select("*").eq("id", a.id);
    expect(profiles.data).toEqual([]);
  });

  it("user B can't change or delete user A's data", async () => {
    await b.client.from("plans").update({ state: plan("hacked"), client_updated_at: 999 }).eq("user_id", a.id);
    await b.client.from("checkins").update({ cash: 999 }).eq("user_id", a.id);
    await b.client.from("plans").delete().eq("user_id", a.id);
    const mine = await a.client.from("plans").select("state").single();
    expect(mine.data?.state).toEqual(plan("A"));
    const ci = await a.client.from("checkins").select("cash").single();
    expect(Number(ci.data?.cash)).toBe(2);
  });

  it("user B can't create rows in user A's name", async () => {
    const p = await b.client.from("plans").insert({ user_id: a.id, state: plan("fake") });
    expect(p.error).not.toBeNull();
    const c = await b.client.from("checkins").insert({ user_id: a.id, month: "2026-12-01", invested: 0, cash: 0, debt: 0, net_worth: 0, expected_next_invested: 0 });
    expect(c.error).not.toBeNull();
  });

  it("signed-out visitors can't read anything", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const table of ["plans", "checkins", "profiles"] as const) {
      const r = await anon.from(table).select("*");
      expect(r.data ?? []).toEqual([]);
    }
  });

  it("last write wins: an older client edit can't overwrite a newer one", async () => {
    await a.client.from("plans").update({ state: plan("newer"), client_updated_at: 300 }).eq("user_id", a.id);
    await a.client.from("plans").update({ state: plan("stale"), client_updated_at: 200 }).eq("user_id", a.id);
    const r = await a.client.from("plans").select("state, client_updated_at").single();
    expect(r.data?.state).toEqual(plan("newer"));
    expect(r.data?.client_updated_at).toBe(300);
  });

  it("rejects plan documents that aren't version 2, and one check-in per month", async () => {
    const bad = await b.client.from("plans").insert({ state: { version: 3 } });
    expect(bad.error).not.toBeNull();
    const dup = await a.client.from("checkins").insert({ month: "2026-11-01", invested: 0, cash: 0, debt: 0, net_worth: 0, expected_next_invested: 0 });
    expect(dup.error).not.toBeNull();
  });
});

describe.skipIf(!env)("delete my account (local Supabase)", () => {
  it("removes only the caller's account and all their rows", async () => {
    const url = env!.API_URL!;
    const admin = createClient(url, env!.SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    const make = async () => {
      const email = `del-${randomUUID()}@example.test`;
      const password = `pw-${randomUUID()}`;
      const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      const c = createClient(url, env!.ANON_KEY!, { auth: { persistSession: false } });
      await c.auth.signInWithPassword({ email, password });
      await c.from("plans").insert({ state: { version: 2 } });
      return { id: data.user!.id, c };
    };
    const keep = await make();
    const gone = await make();
    const { error } = await gone.c.rpc("delete_my_account");
    expect(error).toBeNull();
    expect((await admin.auth.admin.getUserById(gone.id)).data.user).toBeNull();
    expect((await admin.from("plans").select("user_id").eq("user_id", gone.id)).data).toEqual([]);
    // the other user is untouched
    expect((await keep.c.from("plans").select("user_id")).data?.length).toBe(1);
    // signed-out visitors can't call it
    const anon = createClient(url, env!.ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.rpc("delete_my_account")).error).not.toBeNull();
    await admin.auth.admin.deleteUser(keep.id);
  });
});
