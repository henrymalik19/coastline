// Local testing only: makes a test user on the LOCAL Supabase stack whose plan is still stored the
// old way (one JSON document), to check the app turns it into rows. Prints the email.
// Usage: node packages/db/scripts/e2e-legacy-user.mjs
import { createClient } from "@supabase/supabase-js";
import { execSync } from "node:child_process";

const out = execSync("npx supabase status -o env", { stdio: ["ignore", "pipe", "ignore"] }).toString();
const env = Object.fromEntries(out.split(/\r?\n/).map((l) => l.match(/^([A-Z_]+)="?(.*?)"?$/)).filter(Boolean).map((m) => [m[1], m[2]]));
if (!/^http:\/\/127\.0\.0\.1/.test(env.API_URL ?? "")) throw new Error("Not the local stack");
const admin = createClient(env.API_URL, env.SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const email = `legacy-${Date.now()}@example.test`;
const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
if (error) throw error;
const id = data.user.id;
const state = {
  version: 2, age: 41, retireAge: 60, healthcare: 1200, currentInvestMonthly: 0,
  incomes: [{ id: "j", name: "Legacy job", freq: "monthly", net: 7000, matchMode: "usd" }],
  budget: [{ id: "food", name: "Groceries (legacy)", amount: 700, inRetirement: true, group: "Food" }],
  accounts: [{ id: "chk", name: "Legacy checking", type: "cash", balance: 9000 }, { id: "brk", name: "Brokerage", type: "taxable", balance: 120000 }],
  debts: [{ id: "m", name: "Legacy mortgage", kind: "mortgage", balance: 150000, apr: 0.05, minPayment: 1500, escrow: 300, minimumOnly: true }],
  goals: [], limits: [],
  plan: { steps: ["starterEF", "fullEF", "taxable"], starterEF: 2000, efMonths: 3, highApr: 0.07, marginalTax: 0.22, hsaEligible: false, hsaFamily: false, projectWith: "plan", shares: { fullEF: 0.5 } },
  ret: 0.05, vol: 0.15, fee: 0, swr: 0.035, taxRate: 0.1, contribGrowth: 0,
  whatif: { extra: 0, retDelta: 0, spendDelta: 0 },
  budgetPlan: { start: "2026-10", startCash: 9000, months: { "2026-11": { assigned: { food: 700 } } } },
};
// newer than any device copy, so the app takes it
const ins = await admin.from("plan").insert({ id, owner_id: id, legacy_state: state, legacy_todo_done: { "2026-11": ["ef"] }, onboarded: true, client_updated_at: Date.now() + 86_400_000 });
if (ins.error) throw ins.error;
console.log(email);
