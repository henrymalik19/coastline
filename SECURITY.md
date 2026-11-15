# Coastwise security policy

How Coastwise protects the people who use it and the financial data they trust it with. It covers the
app, its servers and the accounts that run them. Last reviewed **November 14, 2026**.

## Who's responsible

The owner of Coastwise is responsible for information security: keeping this policy, making sure it's
followed, and handling security reports and incidents. Contact: **security@getcoastwise.com**.

## Reporting a security problem

Email security@getcoastwise.com with what you found and how to reproduce it. Please don't test against
other people's data. You'll get a reply within 3 business days.

## Access control

- **Least access.** Only the owner has admin access to production systems: GitHub, Vercel, Supabase,
  Plaid, Cloudflare, Resend and the email account they use. Anyone added later gets only the access their
  role needs.
- **Two-step sign-in (MFA) is required** on every one of those accounts. Passkeys or security keys are
  preferred; an authenticator app is the minimum. SMS is not used where anything better is offered.
- **Access reviews.** Every 6 months, and whenever someone's role changes or they leave, the list of people
  and API keys with access is checked and anything no longer needed is removed the same day.
- **Users only see their own data.** The database enforces this with row-level security on every table: a
  person can read and change only their own plan and the plans shared with them. Server functions check the
  signed-in user's session before every action.
- **Keys and secrets.** Plaid keys, the token-encryption key and the database service key live only in the
  server's secret store, never in the app or the code repository. Keys are rotated if they may have been
  exposed, and at least once a year.

## Encryption

- **In transit:** all traffic uses HTTPS with TLS 1.2 or newer (app, database, server functions, Plaid).
- **At rest:** the database and its backups are encrypted on disk (AES-256) by the hosting provider. Bank
  access tokens are also encrypted by the app (AES-256-GCM) with a key kept only on the server, so a copy of
  the database alone doesn't reveal them.

## Secure development and patching

- All code changes go through version control, and automated checks (types, linting, tests) run on every
  change before it's deployed.
- Dependabot watches the app's dependencies and GitHub Actions for known vulnerabilities and opens fixes.
- **Patch timelines** from when a vulnerability is known: critical within 7 days, high within 30 days,
  others within 90 days.
- Hosting, database and operating-system patching is handled by the managed providers (Vercel, Supabase).
  Software that reaches end of life (for example a Node.js or Postgres version) is upgraded before its
  end-of-life date.
- The owner's computers run a supported operating system with automatic updates, disk encryption, a screen
  lock and built-in malware protection.

## Consumer data

- **Collected only with consent.** Bank data comes in only after a person chooses to connect a bank and
  approves it in Plaid's window. The privacy policy (getcoastwise.com/privacy) is linked in the app.
- **Used only for the person's own plan.** It's never sold, rented or used for advertising.
- **Retention:** data is kept while the account exists.
- **Deletion:** deleting an account first disconnects every bank at Plaid (ending Plaid's access and the
  connection), then permanently deletes the account and all its data. Disconnecting a single bank removes it
  at Plaid and deletes its stored data. Provider backups age out within 30 days.
- **Requests** to see, correct or delete data (privacy@getcoastwise.com) are answered within 30 days.

## Incidents

If data may have been accessed without permission: contain it (revoke keys, disconnect access), find out
what happened and who's affected, then notify affected people and Plaid promptly, within 72 hours of
confirming it, and as the law requires. Afterwards, fix the cause and update this policy.

## Review

This policy is reviewed at least once a year and whenever the app's handling of data changes significantly.
