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
