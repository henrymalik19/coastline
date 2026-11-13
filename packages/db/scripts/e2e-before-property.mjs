// Local testing only: data shaped like plans had it before 20261113180000 (property accounts linked to
// rental incomes, a rental flag on a mortgage, typed-in spending and income, a register, a tracked
// transfer), to check that migration converts it. Run between the two migrations. Prints the plan id.
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const out = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
const env = Object.fromEntries(out.split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!/^http:\/\/127\.0\.0\.1/.test(env.API_URL ?? "")) throw new Error("Not the local stack");
const db = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const must = (r) => { if (r.error) throw r.error; return r; };

const { data } = await db.auth.admin.createUser({ email: `before-${Date.now()}@example.test`, email_confirm: true });
const id = data.user.id;
must(await db.from("plan").insert({ id, owner_id: id, onboarded: true, client_updated_at: 1, version: 2, age: 34, retire_age: 60, budget_start: "2026-10", budget_start_cash: 1000 }));
must(await db.from("income").insert([
  { plan_id: id, id: "i710", sort: 0, name: "710 Dillon Way", kind: "rental", freq: "monthly", net: 900, match_mode: "usd" },
  { plan_id: id, id: "i840", sort: 1, name: "840 Madison View Lane", kind: "rental", freq: "monthly", net: 400, match_mode: "usd" },
]));
must(await db.from("account").insert([
  { plan_id: id, id: "chk", sort: 0, name: "Checking", type: "cash", balance: 5000 },
  { plan_id: id, id: "ira", sort: 1, name: "Roth IRA", type: "roth", balance: 10000 },
  { plan_id: id, id: "prop-i840", sort: 2, name: "840 Madison View Lane", type: "property", balance: 520000, upkeep: 0.01 },
  { plan_id: id, id: "prop-i710", sort: 3, name: "710 Dillon Way", type: "property", balance: 310000, home_costs: 4000 },
]));
must(await db.from("debt").insert([
  { plan_id: id, id: "d710", sort: 0, name: "710 Dillon Way", kind: "mortgage", balance: 175000, apr: 0.033, min_payment: 1147, rental: true },
  { plan_id: id, id: "d840", sort: 1, name: "840 Madison View Lane", kind: "mortgage", balance: 366000, apr: 0.061, min_payment: 3572, escrow: 1235 },
  { plan_id: id, id: "visa", sort: 2, name: "Visa", kind: "credit_card", balance: 300, apr: 0.24, min_payment: 30 },
]));
must(await db.from("budget_month").insert([{ plan_id: id, month: "2026-10", income: 6000 }, { plan_id: id, month: "2026-11" }]));
must(await db.from("budget_amount").insert([
  { plan_id: id, month: "2026-10", key: "food", assigned: 900, spent: 850 },
  { plan_id: id, month: "2026-11", key: "food", assigned: 950 },
]));
must(await db.from("register").insert([
  { plan_id: id, account_id: "chk", opening: 4200, since: "2026-10-03" },
  { plan_id: id, account_id: "visa", opening: -300, since: "2026-10-03" },
]));
must(await db.from("transaction").insert({ plan_id: id, id: "x1", account_id: "chk", date: "2026-10-05", amount: -500, transfer_account_id: "ira", category_id: "ready", cleared: "cleared", source: "manual", client_updated_at: 1 }));
must(await db.from("tracked_transfer").insert({ plan_id: id, transaction_id: "x1", to_account: "ira", amount: 500 }));
console.log(id);
