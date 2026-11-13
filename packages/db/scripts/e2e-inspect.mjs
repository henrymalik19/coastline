// Local testing only: shows how a LOCAL test user's plan is stored (old JSON or rows).
// Usage: node packages/db/scripts/e2e-inspect.mjs <email>
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const out = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
const env = Object.fromEntries(out.split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!/^http:\/\/127\.0\.0\.1/.test(env.API_URL ?? "")) throw new Error("Not the local stack");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const users = await admin.auth.admin.listUsers();
const u = users.data.users.find((x) => x.email === process.argv[2]);
if (!u) throw new Error("No such local user");
const plan = await admin.from("plan").select("age, retire_age, healthcare, onboarded, client_updated_at, legacy_state, legacy_todo_done, budget_start").eq("id", u.id).single();
const count = async (t) => (await admin.from(t).select("*", { count: "exact", head: true }).eq("plan_id", u.id)).count;
const tables = ["account", "debt", "income", "category", "budget_month", "budget_amount", "step_split", "todo_done", "contribution_limit", "transaction"];
const counts = {};
for (const t of tables) counts[t] = await count(t);
const accounts = (await admin.from("account").select("name, balance").eq("plan_id", u.id).order("sort")).data;
console.log(JSON.stringify({ plan: { ...plan.data, legacy_state: plan.data?.legacy_state ? "(still JSON)" : null }, counts, accounts }, null, 1));
