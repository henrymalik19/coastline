/**
 * Database tests against the local Supabase stack (`pnpm db:start`): row-level security (each person
 * sees and changes only their own plan, or one shared with them) and saving and reading a plan as
 * rows (get_plan / save_plan). Skipped automatically when the local stack isn't running.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { diffRows, planToRows, PLAN_TABLES, rowsToPlan, type PlanRows, type PlanTable } from "@coastfi/schema";
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canon, fullPlan } from "../../schema/test/fullPlan";

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

/** What get_plan returns, as the rows planToRows makes. */
function toRows(snap: Record<string, unknown>): PlanRows {
  const tables = {} as Record<PlanTable, Record<string, unknown>[]>;
  for (const t of Object.keys(PLAN_TABLES) as PlanTable[]) tables[t] = (snap[t] as Record<string, unknown>[]) ?? [];
  return { plan: snap.plan as Record<string, unknown>, tables };
}

describe.skipIf(!env)("plans as rows, and who can see them (local Supabase)", () => {
  const url = env?.API_URL ?? "";
  const anonKey = env?.ANON_KEY ?? "";
  // a skipped describe still runs its body, so only build the client when the stack is up (CI has none)
  const admin = env ? createClient(url, env.SERVICE_ROLE_KEY!, { auth: { persistSession: false } }) : (null as unknown as SupabaseClient);
  const users: { id: string; email: string; client: SupabaseClient }[] = [];

  async function newUser() {
    const email = `rls-${randomUUID()}@example.test`;
    const password = `pw-${randomUUID()}`;
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const client = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) throw signInError;
    const u = { id: data.user.id, email, client };
    users.push(u);
    return u;
  }

  /** Save a plan the way the app does: settings and the rows that changed since `base`. */
  async function save(c: SupabaseClient, id: string, rows: PlanRows, base: { at: number; rows: PlanRows } | undefined, at: number) {
    const { data, error } = await c.rpc("save_plan", { p: id, p_base: base?.at ?? null, p_at: at, p_plan: rows.plan, p_changes: diffRows(base?.rows, rows) });
    if (error) throw error;
    return data as number | null;
  }
  const load = async (c: SupabaseClient, id: string) => {
    const { data, error } = await c.rpc("get_plan", { p: id });
    if (error) throw error;
    return data as Record<string, unknown> | null;
  };

  let a: Awaited<ReturnType<typeof newUser>>;
  let b: Awaited<ReturnType<typeof newUser>>;
  const plan = fullPlan();
  const todo = { "2026-11": ["match"] };

  beforeAll(async () => {
    a = await newUser();
    b = await newUser();
    expect(await save(a.client, a.id, planToRows(plan, todo), undefined, 100)).toBe(100);
    const ci = await a.client.from("checkin").insert({ plan_id: a.id, month: "2026-11-01", invested: 1, cash: 2, debt: 3, net_worth: 0, expected_next_invested: 1 });
    if (ci.error) throw ci.error;
  });

  afterAll(async () => {
    for (const u of users) await admin.auth.admin.deleteUser(u.id);
  });

  it("a whole plan saves as rows and comes back the same", async () => {
    const snap = await load(a.client, a.id);
    const back = rowsToPlan(toRows(snap!));
    expect(canon(back.plan)).toEqual(canon({ ...plan, limits: [] })); // limits are shared, not saved per plan
    expect(back.todoDone).toEqual(todo);
    expect((snap!.plan as { client_updated_at: number }).client_updated_at).toBe(100);
    // one row per thing, in its own table
    const accounts = await a.client.from("account").select("id, balance").eq("plan_id", a.id).order("sort");
    expect(accounts.data?.map((r) => r.id)).toEqual(["ira", "chk"]);
  });

  it("a later save writes only what changed, and only over the copy it started from", async () => {
    const base = { at: 100, rows: toRows((await load(a.client, a.id))!) };
    const next = structuredClone(plan);
    next.accounts[1]!.balance = 15000;
    next.debts = next.debts.filter((d) => d.id !== "cc");
    expect(await save(a.client, a.id, planToRows(next, todo), base, 200)).toBe(200);
    const back = rowsToPlan(toRows((await load(a.client, a.id))!));
    expect(back.plan.accounts[1]!.balance).toBe(15000);
    expect(back.plan.debts.map((d) => d.id)).toEqual(["m", "r", "loan"]);
    expect(canon(back.plan.budgetPlan)).toEqual(canon(plan.budgetPlan));
    // another device still on the copy from save 100: refused, so it takes in this save first
    expect(await save(a.client, a.id, planToRows(plan, todo), base, 300)).toBeNull();
  });

  it("plans saved before the split keep their JSON until the app turns it into rows", async () => {
    const c = await newUser();
    const legacy = { ...fullPlan(), age: 41 };
    const ins = await admin.from("plan").insert({ id: c.id, owner_id: c.id, legacy_state: legacy, onboarded: true, client_updated_at: 50 });
    expect(ins.error).toBeNull();
    const snap = await load(c.client, c.id);
    expect((snap!.plan as { legacy_state: { age: number } }).legacy_state.age).toBe(41);
    expect(await save(c.client, c.id, planToRows(legacy), undefined, 60)).toBe(60);
    const after = await load(c.client, c.id);
    expect((after!.plan as { legacy_state: unknown }).legacy_state).toBeNull();
    expect(rowsToPlan(toRows(after!)).plan.age).toBe(41);
  });

  it("someone else can't read, change or remove your plan", async () => {
    expect(await load(b.client, a.id)).toBeNull();
    for (const t of ["plan", "account", "debt", "category", "property", "budget_assignment", "checkin", "profile"]) {
      const r = await b.client.from(t).select("*").eq(t === "plan" || t === "profile" ? "id" : "plan_id", a.id);
      expect([t, r.data]).toEqual([t, []]);
    }
    // saving over it, adding rows to it, changing or deleting it: nothing happens to A's plan
    await b.client.rpc("save_plan", { p: a.id, p_base: null, p_at: 9e12, p_plan: { age: 99 }, p_changes: {} });
    const add = await b.client.from("account").insert({ plan_id: a.id, id: "x", sort: 9, name: "Fake", type: "cash", balance: 1 });
    expect(add.error).not.toBeNull();
    await b.client.from("account").update({ balance: 0 }).eq("plan_id", a.id);
    await b.client.from("debt").delete().eq("plan_id", a.id);
    await b.client.from("plan").delete().eq("id", a.id);
    const mine = rowsToPlan(toRows((await load(a.client, a.id))!));
    expect(mine.plan.age).toBe(plan.age);
    expect(mine.plan.accounts[1]!.balance).toBe(15000);
    expect(mine.plan.debts).toHaveLength(3);
  });

  it("someone you share the whole plan with reads and saves it like you do", async () => {
    const m = await admin.from("plan_member").insert({ plan_id: a.id, email: b.email, member_id: b.id, role: "full", accounts: [] });
    expect(m.error).toBeNull();
    const snap = await load(b.client, a.id);
    expect(snap).not.toBeNull();
    const at = (snap!.plan as { client_updated_at: number }).client_updated_at;
    const next = rowsToPlan(toRows(snap!)).plan;
    next.age = 35;
    expect(await save(b.client, a.id, planToRows(next, todo), { at, rows: toRows(snap!) }, at + 1)).toBe(at + 1);
    expect(rowsToPlan(toRows((await load(a.client, a.id))!)).plan.age).toBe(35);
    // but can't delete it
    await b.client.from("plan").delete().eq("id", a.id);
    expect(await load(a.client, a.id)).not.toBeNull();
    await admin.from("plan_member").delete().eq("plan_id", a.id);
    expect(await load(b.client, a.id)).toBeNull();
  });

  it("transactions keep their split lines; an older edit from an offline device is ignored", async () => {
    const t = { id: "t1", account_id: "chk", date: "2026-11-02", amount: -100, payee: "Target", category_id: null, cleared: "cleared", source: "manual", client_updated_at: 10, tracked_amount: 12.5, splits: [{ category_id: "food", amount: -70 }, { category_id: "home", amount: -30 }] };
    expect((await a.client.rpc("save_transactions", { p: a.id, p_rows: [t] })).error).toBeNull();
    const read = async () => (await a.client.from("transaction").select("id, amount, transaction_split(sort, category_id, amount)").eq("plan_id", a.id)).data as { transaction_split: { category_id: string; amount: number; sort: number }[] }[];
    expect((await read())[0]!.transaction_split.sort((x, y) => x.sort - y.sort).map((x) => [x.category_id, Number(x.amount)])).toEqual([["food", -70], ["home", -30]]);
    expect(Number((await a.client.from("transaction").select("tracked_amount").eq("id", "t1").single()).data!.tracked_amount)).toBe(12.5);
    // an older copy can't overwrite it or its splits
    await a.client.rpc("save_transactions", { p: a.id, p_rows: [{ ...t, client_updated_at: 5, splits: [] }] });
    expect((await read())[0]!.transaction_split).toHaveLength(2);
    // a newer one without splits clears them
    await a.client.rpc("save_transactions", { p: a.id, p_rows: [{ ...t, client_updated_at: 20, splits: [], category_id: "food" }] });
    expect((await read())[0]!.transaction_split).toHaveLength(0);
    expect((await b.client.from("transaction").select("id").eq("plan_id", a.id)).data).toEqual([]);
  });

  it("contribution limits are one shared table: anyone reads them, nobody changes them from the app", async () => {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    const rows = (await anon.from("contribution_limit").select("year, k401, ira").order("year")).data;
    expect(rows?.map((r) => r.year)).toEqual([2026, 2027]);
    expect(Number(rows![0]!.k401)).toBe(24500);
    await a.client.from("contribution_limit").update({ k401: 1 }).eq("year", 2026);
    const ins = await a.client.from("contribution_limit").insert({ year: 2099, k401: 1, k401_catch: 1, ira: 1, ira_catch: 1, hsa_self: 1, hsa_family: 1, hsa_catch: 1 });
    expect(ins.error).not.toBeNull();
    expect(Number((await anon.from("contribution_limit").select("k401").eq("year", 2026).single()).data!.k401)).toBe(24500);
  });

  it("homes and rentals are their own rows, linked to their mortgage", async () => {
    const props = (await a.client.from("property").select("id, kind, mortgage_id, income_id").eq("plan_id", a.id).order("sort")).data;
    expect(props).toEqual([
      { id: "h", kind: "home", mortgage_id: "m", income_id: null },
      { id: "rp", kind: "rental", mortgage_id: "r", income_id: "j2" },
    ]);
  });

  it("a profile is made on sign-up; one check-in a month; signed-out visitors see nothing", async () => {
    expect((await a.client.from("profile").select("id")).data?.map((r) => r.id)).toEqual([a.id]);
    const dup = await a.client.from("checkin").insert({ plan_id: a.id, month: "2026-11-01", invested: 0, cash: 0, debt: 0, net_worth: 0, expected_next_invested: 0 });
    expect(dup.error).not.toBeNull();
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const table of ["plan", "checkin", "profile", "account", "transaction"]) expect((await anon.from(table).select("*")).data ?? []).toEqual([]);
    expect((await anon.rpc("get_plan", { p: a.id })).data ?? null).toBeNull();
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
      const id = data.user!.id;
      const r = await c.rpc("save_plan", { p: id, p_base: null, p_at: 1, p_plan: planToRows(fullPlan()).plan, p_changes: diffRows(undefined, planToRows(fullPlan())) });
      if (r.error) throw r.error;
      return { id, c };
    };
    const keep = await make();
    const gone = await make();
    const { error } = await gone.c.rpc("delete_my_account");
    expect(error).toBeNull();
    expect((await admin.auth.admin.getUserById(gone.id)).data.user).toBeNull();
    expect((await admin.from("plan").select("id").eq("id", gone.id)).data).toEqual([]);
    expect((await admin.from("account").select("id").eq("plan_id", gone.id)).data).toEqual([]);
    // the other user is untouched
    expect((await keep.c.from("account").select("id")).data?.length).toBe(2);
    // signed-out visitors can't call it
    const anon = createClient(url, env!.ANON_KEY!, { auth: { persistSession: false } });
    expect((await anon.rpc("delete_my_account")).error).not.toBeNull();
    await admin.auth.admin.deleteUser(keep.id);
  });
});
