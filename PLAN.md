# Coast FI app: build plan

A personal-finance app that shows how close you are to Coast FI / FIRE, turns your budget and paychecks into a month-by-month "where the next dollar goes" plan, and keeps you engaged with check-ins, streaks and milestones. Built for one user first, designed so it can become a multi-user product.

**Reference implementation:** `reference/engine.js` (all the math, no UI) and `reference/index.html` (working single-page prototype). Port the engine's behavior exactly, and use the prototype as the source of truth for features and wording. Where this plan and the prototype disagree, this plan wins.

---

## 1. Principles (do not compromise these)

1. **Honest, not hopeful.** Everything is in today's dollars with real (after-inflation) returns. Show ranges, not one line. Show the assumptions next to every result. Conservative defaults: 5% real return, 15% volatility, 3.5% withdrawal rate, 0% real raises.
2. **The engine is pure and tested.** No I/O, no dates from the system clock inside it (pass `startDate` in), deterministic Monte Carlo (seeded RNG). Every number on screen comes from it.
3. **Today's cash flow comes first.** Coasting only works if current income covers current life. Flag budget shortfalls before anything else.
4. **Privacy.** Financial data is sensitive: row-level security on every table, no secrets in the client, Plaid access tokens encrypted server-side only.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App | **Expo (React Native + Expo Router), TypeScript** | One codebase for iOS, Android and web |
| UI | Tamagui *or* NativeWind (pick one at setup), `victory-native` or `react-native-svg` for charts | Cross-platform styling and charts |
| State | Zustand for local UI state, TanStack Query for server data | Simple and cache-friendly |
| Validation | Zod schemas shared by app and server | One definition of the data model |
| Backend | **Supabase**: Postgres + Auth + Row Level Security + Edge Functions | Accounts, sync and the Plaid server in one place |
| Bank sync | **Plaid** (Link + Balance/Investments/Liabilities), called only from Edge Functions | Keys never ship in the app |
| Notifications | Expo Notifications | Monthly check-in reminders |
| Tests | Vitest (engine + server), React Native Testing Library (UI), Playwright for web smoke tests | |
| Monorepo | pnpm workspaces + Turborepo | Engine shared by app and server |

---

## 3. Repo layout

```
coastfi/
├─ apps/
│  └─ mobile/                 # Expo app (iOS, Android, web)
│     ├─ app/                 # Expo Router screens
│     │  ├─ (onboarding)/     # step-by-step setup
│     │  ├─ (tabs)/home.tsx   # dashboard: progress + this month's to-dos
│     │  ├─ (tabs)/plan.tsx
│     │  ├─ (tabs)/monthly.tsx
│     │  ├─ (tabs)/progress.tsx
│     │  └─ settings/...      # incomes, budget, accounts, debts, goals, limits, assumptions
│     ├─ components/          # charts, cards, inputs
│     └─ lib/                 # supabase client, queries, store
├─ packages/
│  ├─ engine/                 # ← port of reference/engine.js (pure TS, no deps)
│  │  ├─ src/{types,paychecks,match,limits,plan,project,montecarlo,run}.ts
│  │  └─ test/*.test.ts
│  └─ schema/                 # Zod schemas + inferred TS types (shared)
├─ supabase/
│  ├─ migrations/*.sql
│  └─ functions/              # plaid-link-token, plaid-exchange, plaid-sync, plaid-webhook
├─ reference/                 # engine.js + index.html from the prototype (read-only)
└─ PLAN.md
```

---

## 4. Data model

### 4.1 Plan state (Zod, `packages/schema`)

This mirrors the prototype's `state` object (version 2). Store percentages as decimals (0.05 = 5%).

```ts
type PayFreq = "weekly" | "biweekly" | "semimonthly" | "monthly";

type Income = {
  id: string; name: string; freq: PayFreq;
  net: number;                 // take-home per check
  nextPayday?: string;         // ISO date; lets the engine find 3-/5-check months
  matchMode: "pct" | "usd";
  // pct mode
  gross?: number; contribPct?: number;
  matchRate1?: number; matchUpTo1?: number;   // e.g. 1.0 of first 0.03
  matchRate2?: number; matchUpTo2?: number;   // e.g. 0.5 of next 0.02
  // usd mode
  pretax?: number; match?: number; fullMatch?: boolean;
};
type BudgetItem = { id: string; name: string; amount: number; inRetirement: boolean };
type Account = { id: string; name: string; type: "pretax"|"roth"|"taxable"|"hsa"|"cash"; balance: number; plaidAccountId?: string };
type Debt = { id: string; name: string; balance: number; apr: number; minPayment: number; plaidAccountId?: string };
type Goal = { id: string; name: string; target: number; saved: number };
type LimitsRow = { year: number; k401: number; k401Catch: number; ira: number; iraCatch: number; hsaSelf: number; hsaFamily: number; hsaCatch: number };
type StepKey = "starterEF"|"match"|"highDebt"|"fullEF"|"hsa"|"ira"|"k401"|"lowDebt"|"taxable"|`goal:${string}`;

type PlanState = {
  version: 2;
  age: number; retireAge: number; healthcare: number; currentInvestMonthly: number;
  incomes: Income[]; budget: BudgetItem[]; accounts: Account[]; debts: Debt[]; goals: Goal[];
  limits: LimitsRow[];
  plan: { steps: StepKey[]; starterEF: number; efMonths: number; highApr: number; marginalTax: number;
          hsaEligible: boolean; hsaFamily: boolean; projectWith: "plan"|"current" };
  ret: number; vol: number; fee: number; swr: number; taxRate: number; contribGrowth: number;
  whatif: { extra: number; retDelta: number; spendDelta: number };
};
```

### 4.2 Postgres (Supabase)

Start pragmatic: the plan lives in one validated JSONB document per user, and the things that grow over time get their own tables.

| Table | Columns (key ones) | Notes |
|---|---|---|
| `profiles` | `id (= auth.uid)`, `created_at`, `timezone` | |
| `plans` | `user_id`, `state jsonb`, `schema_version`, `updated_at` | Validate with Zod on write (Edge Function or check constraint via `pg_jsonschema`) |
| `checkins` | `id`, `user_id`, `month (date, first of month)`, `invested`, `cash`, `debt`, `net_worth`, `expected_next_invested`, `source ('manual'|'plaid')` | Unique `(user_id, month)` |
| `plaid_items` | `id`, `user_id`, `item_id`, `access_token_encrypted`, `institution`, `cursor`, `status` | **Never readable by the client.** Service role only |
| `plaid_accounts` | `id`, `user_id`, `plaid_item_id`, `plaid_account_id`, `name`, `mask`, `type`, `subtype`, `current_balance`, `updated_at`, `mapped_to (account/debt id in plan)` | |

RLS: every table is `user_id = auth.uid()` for select/insert/update/delete, except `plaid_items`, which has no client policies at all.

Seed the 2026 contribution limits as defaults in the app (not the DB): 401(k) $24,500 (+$8,000 at 50+), IRA $7,500 (+$1,100 at 50+), HSA $4,400 self / $8,750 family (+$1,000 at 55+). 2027 row: HSA $4,500 / $9,000; 401(k)/IRA copy 2026 until the IRS announces them. Users can edit per year. Years after the last row reuse it.

---

## 5. Engine spec (`packages/engine`)

Port `reference/engine.js` to strict TypeScript, splitting it into modules. Public API:

```ts
run(state: PlanState, startDate: Date): RunResult
// plus exported building blocks: checksInMonth, resolveIncome, matchFor, limitsFor,
// derive, simulatePlan, project, fireNumber, coastNumberAt, coastCrossing, monteCarlo
```

Behavior to preserve:

- **Paychecks**: `checksInMonth(income, year, month)` counts real paydays from `nextPayday` stepping 7/14 days. Semi-monthly = 2, monthly = 1. No date → average (P/12). "Normal month" = 4 weekly / 2 biweekly / 2 semi-monthly / 1 monthly checks.
- **Match**: `matchFor(gross, pct) = gross × (r1·min(pct,u1) + r2·min(max(pct−u1,0),u2))`. `resolveIncome` returns per-check `pretax`, `match`, `fullMatch`, `gapPre`, `gapMatch`, `maxPct`.
- **Plan simulation** (month by month from `startDate`): income by real paydays × (1+raises)^year → debts accrue APR/12, then minimums → `avail = income − budget − minimums + whatif.extra` → poured down `plan.steps`:
  - `starterEF` / `fullEF` fill cash to target (full = `efMonths × (budget + debt minimums)`).
  - `match` raises payroll 401(k) to the full-match % (take-home cost = pre-tax × (1 − marginalTax)) and adds the extra match.
  - `highDebt` / `lowDebt`: avalanche (highest APR first), split at `highApr`.
  - `hsa` / `ira` / `k401`: capped per **calendar year** by the limits table; the first partial year is prorated by months remaining; catch-ups by age; payroll 401(k) counts toward the 401(k) cap; $1 of extra pre-tax 401(k) costs (1 − marginalTax) of take-home.
  - `goal:<id>`: fill to target. `taxable`: everything left.
  - Leftover → cash. A negative month draws from cash and records `shortfall`.
  - `projectWith: "current"` skips the waterfall: invests `currentInvestMonthly` (IRA up to cap, then taxable), and the rest goes to cash.
  - Emits `events` (starter EF done, EF full, each debt paid, debt-free, goal reached, full match captured), `firstFund` per bucket, and `maxedYears`.
- **Projection**: monthly, two buckets (pre-tax vs. Roth/taxable/HSA), contributions from the plan's `pre`/`post` per month.
- **FIRE number** = retirement spending ÷ (1 − taxRate × pre-tax share at retirement) ÷ swr. Retirement spending = budget items with `inRetirement` + healthcare, × (1 + whatif.spendDelta). Debt payments excluded.
- **Coast number** at t = FIRE ÷ (1+r)^(years left). Coast date = first month the projected balance ≥ the coast number. Conservative coast date uses r − 1.5 pts.
- **Monte Carlo**: 2,000 paths, annual lognormal returns `G = exp(ln(1+r) + σ·Z)` (so the median = r), contributions added as `c·√G`, seeded mulberry32. Outputs p10/p25/p50/p75/p90 per year, P(reach FIRE by retire age), and P(reach FIRE if you stop contributing today).
- **Extras**: `freedomDays = invested ÷ (retireAnnual/365)`, `coastSoonerMonths` (effect of +$100/mo), `whenBalance(x)`, `whenCoastPct(f)`.

### 5.1 Required tests (these values were verified against the prototype)

| Test | Input | Expected |
|---|---|---|
| Coast ↔ FIRE identity | any state | `coastNow × (1+r)^years === fire` (to 1e-6 relative) |
| Annuity | $12k/yr pre-tax, 0 balance, 10 yrs, 6%, monthly | final = **162,473.44** |
| Biweekly paydays | nextPayday 2026-11-13, year 2027 | per month `[2,2,2,3,2,2,2,2,2,3,2,2]`, total 26; Nov & Dec 2026 = 2 each |
| Match formula | gross 3500, 4%, 100% of 3% + 50% of 2% | pretax 140, match 122.50, maxPct 0.05, gapPre 35, gapMatch 17.50; at 6% match = 140 |
| Cash conservation | every simulated month | `income − expenses === Σ take-home allocations + leftover` (± $0.01) |
| Caps | any year | yearly IRA/HSA/401(k) totals never exceed the (prorated) cap |
| Avalanche | two debts | the higher APR is paid off first |
| Determinism | same state + startDate | identical `run()` output (seeded MC) |
| Migration | prototype v1 and v2 JSON | parses into `PlanState` without loss |

Add property-based tests (fast-check) for conservation and caps over random states.

---

## 6. App: information architecture

The prototype's single long page gets reorganized for a phone first:

1. **Onboarding** (first run, ~6 short steps, skippable, editable later): age & retire age → incomes (with the match helper) → budget (preset categories, "continues in retirement" toggles) → accounts & debts (manual, or "Connect bank" via Plaid) → goals → review the generated plan. Prefill sensible defaults; show the Coast FI result at the end as the payoff.
2. **Home**: Coast FI progress ring, coast date (plus the conservative date), odds of FIRE, freedom days, and **this month's to-do list** (from the plan) with checkboxes. One "Log check-in" button.
3. **Plan**: the ordered steps (drag to reorder), each with status, progress bar and ETA; milestone timeline; the "plan vs. what I do today" comparison.
4. **Monthly**: this month / next month split bars, the 36-month stacked savings chart (▲ = extra-paycheck month), and a table view.
5. **Progress**: projection chart with p10–p90 bands, the coast curve and the FIRE line; what-if sliders; check-in history vs. plan; badges & levels; streak.
6. **Settings**: every input from the prototype's Setup tab, plus the contribution-limits table, assumptions (with explanations), connected banks, notifications, export/import JSON, delete account.

Chart rules carried over from the prototype: one y-axis, colorblind-validated categorical order (401(k) blue, IRA orange, Brokerage aqua, Emergency fund yellow, Debt magenta, HSA green, Goals violet), 2px gaps between stacked segments, hover/press tooltips, a table view for every chart, and light and dark themes.

---

## 7. Plaid integration (phase 4)

- Edge Functions: `plaid-link-token` (create a link token for the user), `plaid-exchange` (public_token → access_token, encrypt with a key stored in Supabase secrets, insert `plaid_items`), `plaid-sync` (pull balances, investment holdings and liabilities; upsert `plaid_accounts`), `plaid-webhook` (verify the webhook signature, trigger a sync).
- Mapping UI: each Plaid account maps to a plan account (with a type) or a debt (APR and minimum payment come from Liabilities when available). Unmapped accounts are ignored.
- The check-in becomes one tap: a sync fills the balances and the user confirms. Keep manual entry as a fallback.
- Start in the Plaid Sandbox and only move to Development/Production after a security review. Handle `ITEM_LOGIN_REQUIRED` with a "reconnect" banner.

---

## 8. Phases & acceptance criteria

**Phase 0: scaffold (½ day)**
- pnpm + Turborepo monorepo, Expo app, `packages/engine`, `packages/schema`, Supabase local dev, CI (lint, typecheck, test).
- ✅ `pnpm test` and `pnpm typecheck` pass in CI; the Expo app boots on iOS simulator, Android emulator and web.

**Phase 1: engine port (1–2 days)**
- Port `reference/engine.js` to TS modules with full types and all tests from §5.1.
- ✅ All tests pass; feeding the prototype's sample state gives the same FIRE number, coast date and plan events as the prototype (snapshot test).

**Phase 2: local-only app (3–5 days)**
- All screens from §6, data in local storage (MMKV/AsyncStorage) via Zustand persist, JSON import/export compatible with the prototype.
- ✅ Can complete onboarding and see a plan on phone and web; import of prototype JSON works; no network required.

**Phase 3: accounts & sync (2–3 days)**
- Supabase Auth (email magic link + Apple/Google), `plans` + `checkins` tables with RLS, conflict rule = last write wins by `updated_at`, offline-first with background sync.
- ✅ The same plan appears on two devices; RLS tests prove user A can't read user B's data.

**Phase 4: Plaid (3–5 days)**
- §7 in Sandbox, mapping UI, one-tap check-in.
- ✅ Sandbox bank connects, balances land in the mapped accounts, reconnect flow works, access tokens are never exposed to the client (verified by test).

**Phase 5: engagement & polish (2–3 days)**
- Monthly check-in reminder (user-chosen day), streaks, badges, level, "+$100/mo pulls Coast FI N months sooner" nudges, haptics, empty states, accessibility pass (labels, contrast, dynamic type).
- ✅ Notification fires in a dev build; every chart has a table view; VoiceOver/TalkBack can read the home screen.

**Later backlog**
- Social Security estimate (benefit at a claiming age, applied as reduced withdrawals from then on)
- Taxes on brokerage gains; Roth IRA income-limit warning/backdoor note; Roth vs. traditional 401(k) choice
- Bridge plan for early retirement (Roth conversion ladder, 72(t)) and sequence-of-returns risk in withdrawals
- Couples / household mode (two people, shared budget)
- Multi-user product: pricing, onboarding analytics, privacy policy, data export/delete, SOC 2-style controls before scaling

---

## 9. Instructions for Claude Code

- Work phase by phase. At the end of each phase, run lint, typecheck and tests, and summarize what changed.
- Treat `reference/` as read-only. When unsure how something should behave, run the prototype logic (`node -e "require('./reference/engine.js')..."`) and match it.
- Never hard-code today's date in the engine; inject it. Use a fixed `startDate` (2026-11-06) in tests.
- Keep all money math in the engine package. UI components only format.
- Ask before adding a new dependency that isn't listed in §2.
- Don't put Plaid secrets or the Supabase service-role key in the app bundle. Use `.env` files for local dev and add them to `.gitignore`.

Suggested first prompt:

> Read PLAN.md and the files in reference/. Do Phase 0 and Phase 1: scaffold the monorepo and port reference/engine.js to packages/engine in strict TypeScript with every test in §5.1. Stop when tests pass and show me the summary.
