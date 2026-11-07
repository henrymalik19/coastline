# Coastline

See [PLAN.md](PLAN.md) for the full build plan.

```
apps/mobile        Expo Router app (iOS, Android, web)
packages/engine    Pure TS port of reference/engine.js + tests
packages/schema    Zod schemas for PlanState (types checked against the engine's)
reference/         Prototype engine (read-only; tests run it for parity)
```

## Commands

```bash
pnpm install
pnpm check        # lint + typecheck + test (Turborepo)
pnpm --filter @coastfi/mobile web
```

## Engine tests

- `test/engine.test.ts`: every case in PLAN.md §5.1, plus behavior tests and a sample-state snapshot.
- `test/properties.test.ts`: fast-check properties for cash conservation, caps and determinism,
  and **parity**: `run()` output from the TS port deep-equals `reference/engine.js` on the
  sample state and on random states.

## Intentional differences from the prototype

**401(k) annual limit.** The prototype let payroll deferrals keep going after the waterfall had
filled the 401(k), so a year's total could pass the IRS limit (e.g. $38,000 vs. $24,500). The port:

- reserves room for the payroll deferrals still scheduled this calendar year before the
  "Max out 401(k)" / match steps add extra, and
- stops payroll deferrals at the limit. The deferral that stops comes back as take-home
  (× (1 − marginal tax)), the employer match on it stops (no true-up assumed), and the month
  reports it as `payCut`.

Parity tests compare against `reference/engine.js` only for states where the prototype stays under
the limit; there the two engines agree exactly.

## Backups

Settings → Backup & restore downloads (web) or shares (phone) a JSON backup of your plan and check-ins, and restores it. Only this app's own backups are accepted.

## Accounts & sync (Supabase)

- **Local:** `pnpm db:start` runs Supabase in Docker on ports 553xx (API 55321, Studio 55323,
  test mailbox 55324). `apps/mobile/.env` points the dev app at it. Sign-in codes land in the
  test mailbox, nothing is really sent. `pnpm db:reset` wipes it.
- **Hosted:** project `Coastline` (`jrhmmybfzwxumpbliycu`). `apps/mobile/.env.production`
  (git-ignored, public values only) is used by production builds;
  `pnpm --filter @coastfi/mobile dev:hosted` runs the web app against it on port 8082.
- Migrations: `npx supabase db push --remote`. Don't `config push` the local `config.toml` to
  the hosted project: it carries local-only values (1s email interval, MFA off, no SMTP) and
  would overwrite the hosted settings. Change hosted auth settings in the dashboard.
- Hosted auth settings (set in the dashboard): email OTP length 6; the "Magic Link" and
  "Confirm signup" templates use `supabase/templates/code.html` (subject "Your Coastline
  sign-in code"); custom SMTP via Resend (`smtp.resend.com:465`, user `resend`).

> **TODO before opening to other users:** sign-in emails are sent from
> `noreply@send.jobrx.ai`, borrowed from the JobRx Resend domain. Verify a Coastline domain
> in Resend and change the sender in Supabase → Authentication → Emails → SMTP Settings.
> Also set the auth Site URL to the real app URL.

## Web deploy (Vercel)

Live at https://coastline-flax.vercel.app (Vercel project `coastline`). `vercel.json` builds the
static web export (`pnpm --filter @coastfi/mobile build:web` → `apps/mobile/dist`) and sends every
path to `index.html` so links like `/settings/account` work. The two public Supabase values are
set as Vercel environment variables (Production and Preview). Data lives in Supabase; Vercel
only serves the files.

- Deploy by hand: `npx vercel deploy --prod`
- Auto-deploy on push needs the Vercel GitHub app to have access to this repo, then
  `npx vercel git connect`.
- Supabase → Authentication → URL Configuration → Site URL is set to the Vercel address;
  update it if you add a custom domain.
