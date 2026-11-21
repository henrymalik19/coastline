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

- [x] **Owner:** Plaid Production approved (2026-11-21).
- [ ] **Owner:** Plaid's "Complete your account setup" (company and app profile).
- [ ] **Owner:** Set the Supabase function secrets `PLAID_ENV=production`, `PLAID_CLIENT_ID`, `PLAID_SECRET`, a new `PLAID_TOKEN_KEY` (`openssl rand -base64 32`), and `PLAID_REDIRECT_URI=https://getcoastwise.com/plaid-oauth`.
- [ ] **Owner:** Add `https://getcoastwise.com/plaid-oauth` to Plaid → Developers → API → Allowed redirect URIs (banks like Chase sign you in on their own site, then send you back there).
- [ ] **Owner:** Until Plus exists, only admins and `PLAID_ALLOWED_USERS` (comma-separated user ids) can connect new banks. `PLAID_OPEN_TO_ALL=true` opens it to everyone.
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

## 4. Coastwise Plus (the paid plan)

**Free:** the Coast FI planner, the envelope budget with manual entries, YNAB import.
**Plus, about $6/month or $50/year:** linked banks that update automatically, and sharing a plan with a partner.
A 14-day free trial starts when someone first tries to link a bank or invite someone.
The plan's owner pays; people they share with get Plus features on that plan.
Not planned: ads, selling data, lifetime deals (Plaid costs keep coming every month).

**Rules**
- The server decides who has Plus, never the app. Stripe tells the server through a webhook, and the database and the `plaid` function check it.
- When Plus ends, nothing is deleted. Linked banks stop updating and turn into manual accounts, and shared people keep viewing but no one new can be invited. After 30 days, banks are disconnected at Plaid so they stop costing money.
- Everything ships behind `EXPO_PUBLIC_FF_PLUS` and goes live together with bank linking (section 2).

**Build steps**
1. [ ] **Code: who has Plus.** A `subscription` table (one row per account: status, renewal date, trial end, Stripe ids). Only the server writes it, and people can read only their own row. A `has_plus(plan)` database function, with `comp` status for you and early users. Tests for the security rules.
2. [ ] **Code: enforce it.** The `plaid` function refuses new links and updates without Plus. The database refuses new invites without Plus. Tests for both.
3. [ ] **Owner: Stripe in test mode.** Create the Plus product with monthly and yearly prices, and turn on the customer portal (cancel, change card, invoices). Set the Supabase secrets `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`.
4. [ ] **Code: a `billing` function.** It starts Stripe Checkout (with the 14-day trial) and opens the customer portal. It calls Stripe directly, with no new package.
5. [ ] **Code: a `stripe-webhook` function.** It checks Stripe's signature and keeps the `subscription` row up to date: started, renewed, payment failed, cancelled, ended.
6. [ ] **Code: in the app.** A Plus screen shown when someone taps Connect bank or Invite without Plus. Account → Plan & billing shows the status, the trial days left, and Manage billing. Sharing and bank screens explain what happens when Plus ends.
7. [ ] **Code: a nightly clean-up.** Disconnects banks at Plaid 30 days after Plus ends.
8. [ ] **Code + Owner: legal pages.** Terms of service and a cancellation and refund policy, plus an update to the privacy page to mention Stripe. Stripe requires these before taking real payments.
9. [ ] **Test end to end in Stripe test mode:** trial, pay, card declined, cancel, resubscribe, a shared plan, and the clean-up.
10. [ ] **Owner: go live.** Switch Stripe to live keys and turn on `EXPO_PUBLIC_FF_PLUS` together with `EXPO_PUBLIC_FF_BANKS`.
11. [ ] Later: App Store and Google Play subscriptions when the phone apps ship. RevenueCat can handle all three; it's a new dependency, so it needs a go-ahead first.

**Decisions before building**
- [ ] Ask for a card up front for the trial? Recommended: yes. Each bank link costs money, and trials with a card convert better.
- [ ] Final price, after checking what Plaid charges for each linked bank each month.
- [ ] Give the first users free Plus (for example, the first 50 users for a year) in exchange for feedback?

## 5. Phone apps (App Store and Google Play)

- [ ] **Code:** Face ID / fingerprint lock when the app opens. Needs the `expo-local-authentication` package, so it needs a go-ahead first.
- [ ] **Code:** Sign in with Apple and Google. Needs an Apple developer account. Apple requires Sign in with Apple once other social sign-ins are offered.
- [ ] **Code:** In-app subscriptions (section 4, step 11).

## 6. Security housekeeping

- [ ] **Owner:** Replace the Resend API key with a sending-only key.
- [ ] **Owner:** Add a backup authenticator device to the Supabase account.
- [ ] Dependabot: the two moderate `glob` / `minimatch` alerts come from Expo's command-line tools. Dependabot can't fix them on its own; they clear when Expo updates those tools.

## 7. First users

Don't wait for bank linking. The free plan is useful today, so launch it as a free beta now and add Plus when banks are ready.

**Ready for users when**
- [ ] Five people who have never seen the app set up a plan and a budget on their phone without help. Watch them, or ask for a screen recording, and fix whatever they get stuck on. The step-by-step plan, messages to send and session script are in [docs/first-five-users.md](docs/first-five-users.md).
- [ ] Nothing gets lost: a plan survives signing out and back in, a second device, and a day offline.
- [ ] Errors reach you: add error reporting so a crash on someone's phone shows up for you. It's a new dependency, so it needs a go-ahead first.
- [ ] A simple way to count users: sign-ups and weekly active accounts, counted from the database, with no tracking scripts.
- [ ] A way to reach you: a Feedback link in Settings and a support email.
- [ ] Privacy page done; terms of service done (also needed for Plus).
- [ ] Supabase backups on (Pro, section 3) once real people's data is in it.

**Goals**
- [ ] First 10 real users (not friends doing you a favor) who still open the app every week a month later.
- [ ] 100 sign-ups, with 25 using it every week.
- [ ] First paying Plus user.
- The number that matters most: of the people who sign up, how many are still using it 4 weeks later.

**Getting users**
- [ ] A free Coast FI calculator page that works without signing up (for example getcoastwise.com/coast-fi-calculator). People search for "coast fi calculator", and it's the best way in.
  - Five inputs (age, retirement age, invested today, yearly spending, expected return) and an instant answer ("you can coast at 41"), using the engine's math.
  - Under the answer: "Save this plan and track it", which starts setup with those numbers filled in.
  - **Code:** the page must be plain HTML that search engines can read. The site is currently one page that builds itself in the browser (`web.output: "single"`), so this page needs static rendering. It's a moderate build change with no new dependencies.
  - **When:** after the first five tester sessions, so it can be the simple way in that avoids whatever slows people down in setup.
- [ ] Communities: r/coastFIRE, r/financialindependence, r/Fire, the Bogleheads forum. Share it as "I built this, what's missing?", follow each community's self-promotion rules, and reply to every comment.
- [ ] People leaving YNAB over its price: the YNAB import is the hook (r/ynab, r/budget).
- [ ] Build in public: short weekly posts on X, Threads or Bluesky showing what shipped and the numbers.
- [ ] Later, once there are steady weekly users: Product Hunt, FIRE podcasts and newsletters, and a few how-to articles ("What is Coast FI?", "How much do I need to coast?").

## 8. AI features (later)

Not yet. Build for where testers actually struggle, not a guess.

**Rules**
- AI never works out money numbers. The engine does all the math, and AI only fills in or explains.
- People see and confirm anything AI fills in before it's saved.
- Sending someone's financial details to an AI provider must be on the privacy page first. Bank data from Plaid also has to follow Plaid's rules on sharing with other services.
- It costs money per use, so these belong in Plus. If built, use Claude.

**Ideas, best first**
- [ ] **Quick setup from a sentence:** "I'm 32, make $85k, have $60k in my 401(k), rent is $1,800" fills in the setup steps for the person to check. Aimed at the 8-step setup.
- [ ] **Sort bank transactions into budget categories**, once bank linking is live: simple rules first, AI for the rest.
- [ ] **Explain my plan:** plain-language answers like "Why can I coast at 41?", using only the app's own numbers.
- Not planned: reading paystubs. They're too sensitive, and copying three numbers off one is quick.

## 9. Plan accuracy

- [ ] **Code: automatic retirement tax estimate.** Today "Tax on pre-tax withdrawals" is a flat 10% you can change. Instead, estimate it the way the app already estimates your current tax bracket:
  - From retirement spending, filing status, Social Security (part of it is taxed) and a state rate.
  - It's the *average* tax on money taken out of pre-tax accounts, not your bracket. For example, about 8.5% federal single or 4% married on $60k a year (2025 rules), plus state.
  - Show it as "Estimated: 9.2%", with a way to set your own, like the current-bracket field.
  - Engine work with tests (tax brackets live in the engine, never the app). Update the brackets each year with the contribution limits.
  - **When:** after the first testers, unless they question the 10%.

## 9b. Scheduled and repeating transactions (later)

Upcoming transactions already work: anything dated after today shows under "Upcoming" and counts on its day.

- [ ] **Code: repeating transactions:** "rent, $1,500, every month on the 1st" creates the next one as upcoming each time, like YNAB's scheduled transactions. Edit or skip one, or stop the series.
- [ ] **Code: transfers to an IRA or loan dated in the future** move that account's balance on their day, not when they're entered (today they move it right away).
- **When:** if testers ask. For regular bills, repeating bills in Savings goals already set money aside each month.

## 9c. Update transactions from YNAB (done 2026-11-17)

A budget gets one YNAB import (undo it within 30 days, on any device, to redo it). After that, Import from YNAB → "Update transactions from YNAB" takes a newer export: new and changed transactions come in, ones gone from YNAB are removed (a switch, on by default) unless you changed them here, and new YNAB categories come in hidden. Categories, amounts, groups and accounts are left alone.

- [ ] Maybe later: YNAB's API (a token) instead of export files, if someone uses both apps for months.

## 9d. Approve new transactions (before banks go live)

Transactions that arrive on their own (a connected bank, an update from YNAB) are "new" until you look at them, so nothing changes your budget without you seeing it. Entered by hand: already approved.

- [ ] **Code: a "New" mark and an Approve button** on each row, plus "Approve all" on the list. A new transaction counts in balances and the budget right away (like YNAB), only marked until you approve it.
- [ ] **Code: Home shows "N new transactions · Review"**, folded together with "Needs a category" into one list: categorize and approve in one pass.
- [ ] Ways to make it ours: approve a payee's group at once ("6 from Amazon → Shopping ✓"), and say why it's flagged (a new payee, an unusual amount, a possible duplicate).
- YNAB's export has no "approved" column, so an import can't tell which of yours were still unapproved in YNAB: everything from an import comes in approved (you're bringing in history you've already seen). Only what arrives after the import is new.
- **When:** with bank linking (section 2), when transactions start arriving without you entering them.

## 10. Reports (later)

- [ ] **Code: spending by category over the months.** A chart on the Budget tab of what you really spent in each category, month by month, from your transactions.
  - With a long YNAB import it starts with years of history instead of empty.
  - Hidden categories (done 2026-11-17) mean old YNAB spending already sits in its real category.
- [ ] **Code: merge categories.** "Merge into…" on a category moves all its transactions (and split lines) into another category, hidden or not, and removes the old one. Asks first; can't be undone.
- [ ] **Code: AI clean-up of hidden categories.** A "Clean up" screen asks Claude to group similar hidden categories ("Birthday gifts", "Christmas", "Xmas 2023" → "Gifts"). Each suggestion is approved or skipped one at a time, and approving runs the merge above. Sends only category names and a few payees, says so before sending, and the API key stays on the server (an edge function). Needs merge first.
  - Lighter option if rewriting feels risky: let a report group hidden categories under a heading without changing any transactions.
- [ ] **Code (only if testers ask): choose how overspending works.** A plan setting "When a category goes over": take it from next month's Unassigned (today, like YNAB) or keep it red in the category until covered. One rule for every month: switching recalculates all months (warn first). With "keep it red", add a "Cover all overspending" button so a YNAB import doesn't start as a wall of red. Today's "over last month" line and Unassigned note already make overspending hard to miss.
- [ ] **Code: net worth over time** from your monthly check-ins.
- **When:** once testers have a few months of real data, or ask how they're doing over time.

## Done

- 2026-11-17: YNAB import: only this month's and last month's transactions need a category; transfers to accounts left out stay transfers; a note on long imports. Priority order: custom splits, grouped steps, turn steps off, reasons, kept-as-cash row. What-ifs marked in orange everywhere.
- 2026-11-17: Retirement spending can be a set yearly amount (compared with the budget); returns and the FIRE number shown before inflation too; Back returns where you came from; Money → Your plan.
- 2026-11-17: Ready for testers: Send feedback, visit counting (Vercel Web Analytics), `pnpm stats`, Forgot password, a BETA tag and welcome line, and an empty plan that asks for a budget instead of showing nonsense.
- 2026-11-16: Devices unused for 30 days are signed out; Sign out ends only this device's sign-in.
- 2026-11-16: Password sign-in (the emailed code stays for new accounts and forgotten passwords); Sign out other devices.
- 2026-11-15: Two-step sign-in with an authenticator app, enforced by the database and the Plaid function.
- 2026-11-15: CodeQL code scanning (on every push and weekly); Dependabot groups Expo updates; CI checks Expo's pinned versions.
