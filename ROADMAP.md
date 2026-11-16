# Coastwise roadmap

What's next, what it's waiting on, and who does it. Tick items off as they land.
The build spec lives in [PLAN.md](PLAN.md); security practices in [SECURITY.md](SECURITY.md).

**Who:** _Owner_ = done in a dashboard or account by the owner (security settings, keys, billing, attestations).
_Code_ = a change in this repo.

## 1. Plaid Compliance Center (attestations due May 16, 2027)

- [ ] **Owner:** Attest #2, vulnerability scanning (CodeQL on every push and weekly, plus Dependabot).
- [ ] **Owner:** Attest #3, MFA for consumers (two-step sign-in with an authenticator app).
- [ ] **Owner:** Attest #1, MFA on internal systems, after confirming Vercel, GitHub, Plaid, Cloudflare and Resend all use an authenticator app (not text messages).
- [ ] **Owner:** Send a support case (Get Help → Create case, available once Production is approved) asking for #4, #5 and #6 to be marked not applicable for a one-person company: access removal for departing employees, zero-trust access, centralized identity and access management.

## 2. Bank linking goes live (waiting on Plaid Production approval)

The database changes are already applied to hosted Supabase.

- [ ] **Owner:** Set the Supabase function secrets `PLAID_ENV=production`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, and a new `PLAID_TOKEN_KEY` (`openssl rand -base64 32`).
- [ ] **Code:** Deploy the `plaid` function to hosted Supabase. It includes disconnecting banks on account deletion and the two-step sign-in check.
- [ ] **Owner:** Set `EXPO_PUBLIC_FF_BANKS=on` in Vercel and redeploy.
- [ ] **Owner:** Add the Coastwise logo in Plaid's Link customization.
- [ ] **Owner:** Try two-step sign-in on a real account on getcoastwise.com.

## 3. Supabase Pro (upgrade when banks go live, about $25/month)

Daily backups, and the project isn't paused for inactivity.

- [ ] **Owner:** Upgrade the project to Pro.
- [ ] **Owner:** Authentication → Sessions: inactivity timeout of 30 days, which matches the app's own 30-day sign-out but also covers a sign-in copied off a device.
- [ ] **Owner:** Authentication → Passwords: turn on leaked password protection.
- [ ] **Owner:** Authentication → Passwords: minimum length 10, which matches what the app asks for.

## 4. Charging for Coastwise

Proposed: a free plan plus one paid plan. Bank linking is the main paid feature because Plaid charges for every linked bank every month.

- [ ] **Owner:** Look up what Plaid charges for each linked bank each month and confirm the price covers it.
- [ ] **Free:** the Coast FI planner, the envelope budget with manual entries, YNAB import.
- [ ] **Plus, about $6/month or $50/year:** linked banks that update automatically, and sharing a plan with a partner. 14-day free trial when someone first links a bank.
- [ ] **Code:** Paywall behind a feature flag (`EXPO_PUBLIC_FF_…`).
- [ ] **Code:** Stripe checkout on the web.
- [ ] **Code:** App Store and Google Play subscriptions when the phone apps ship. RevenueCat can handle all three; it's a new dependency, so it needs a go-ahead first.
- Not planned: ads, selling data, lifetime deals (Plaid costs keep coming every month).

## 5. Phone apps (App Store and Google Play)

- [ ] **Code:** Face ID / fingerprint lock when the app opens. Needs the `expo-local-authentication` package, so it needs a go-ahead first.
- [ ] **Code:** Sign in with Apple and Google. Needs an Apple developer account. Apple requires Sign in with Apple once other social sign-ins are offered.
- [ ] **Code:** In-app subscriptions (see section 4).

## 6. Security housekeeping

- [ ] **Owner:** Replace the Resend API key with a sending-only key.
- [ ] **Owner:** Add a backup authenticator device to the Supabase account.
- [ ] Dependabot: the two moderate `glob` / `minimatch` alerts come from Expo's command-line tools. Dependabot can't fix them on its own; they clear when Expo updates those tools.

## Done

- 2026-11-16: Devices unused for 30 days are signed out; Sign out ends only this device's sign-in.
- 2026-11-16: Password sign-in (the emailed code stays for new accounts and forgotten passwords); Sign out other devices.
- 2026-11-15: Two-step sign-in with an authenticator app, enforced by the database and the Plaid function.
- 2026-11-15: CodeQL code scanning (on every push and weekly); Dependabot groups Expo updates; CI checks Expo's pinned versions.
