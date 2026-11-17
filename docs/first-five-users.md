# Getting the first five users

**Goal:** five people who have never seen Coastwise set up a plan and a budget on their phone, while you watch or they record it.
Fix what trips them up between sessions.
A week later, check how many still use it.

**Why five:** five sessions find most of the problems that block people. More than that mostly repeats what you've already seen.

**Time:** about two weeks. That's an hour of prep, about 45 minutes per person, and fixes in between.

Track progress in [ROADMAP.md](../ROADMAP.md), section 7.

---

## Step 1: Get ready (this week)

- [x] **Run-through as a new user on a phone-sized screen.** Found and fixed:
  - Skipping the setup steps showed "0% to Coast FI", "You're already there", odds of 100% and "∞ days" all at once. Now the result and the Home screen ask for a budget instead.
  - Home said "Now" with "Not before your retirement age" underneath. Now it says "You've already reached Coast FI".
  - The save-your-plan banner still said "No password". Updated.
  - Still worth watching in sessions: setup has 8 steps but says "about 5 minutes", and the income step asks a lot (pay schedule, deductions).
- [x] **Owner:** In Cloudflare Email Routing, `feedback@getcoastwise.com` forwards to your inbox, the same way `privacy@` does.
- [x] **Code:** "Send feedback" in Settings opens an email to `feedback@getcoastwise.com`.
- [x] **Code:** `pnpm stats` shows accounts, new this week, active this week, plans set up, and how many people who signed up 4 weeks ago are still active. Counts only, read-only.
- [x] **Code:** Visit counting with Vercel Web Analytics (no cookies, no personal details) on getcoastwise.com. The privacy page says so.
- [x] **Owner:** Turned on: Vercel → the coastwise project → Analytics. Hobby plan, free: 50,000 events a month, 30 days of history, and it stops counting at the cap instead of charging.
- [ ] Copy the tracking table (step 4) somewhere you'll keep it up to date: a note, a sheet, or this file.

## Step 2: Find 8 people (to end up with 5)

Some people won't reply or won't show up, so ask more than you need.

**Plan A: one Reddit post.** Post on r/coastFIRE (the post is below). Many people from Reddit won't want a video call, so offer two ways to help:
1. A 30-minute video call, or
2. Try it on their own phone and send a screen recording, or answer the six questions in step 3 by email to `feedback@getcoastwise.com`.

If fewer than 8 people volunteer within 3 days, also post in r/financialindependence's daily discussion thread, or ask the people introduced by friends below.

**Counting who comes from the post.** Link to `getcoastwise.com/?utm_source=reddit&utm_campaign=coastfire`.
- **Reddit** shows how many people viewed the post.
- **Vercel Analytics** shows visitors to the site and which site sent them (reddit.com), and with this link, the `utm_` labels too. Visitors from the Reddit app sometimes arrive without a referrer, which is why the link carries its own label.
- **`pnpm stats`** shows how many of them created an account.
Coastwise works without an account, so some people will try it without signing up. Vercel counts them; the database can't.

**Who to ask**
- People who budget or invest, or who have heard of FIRE.
- Not your closest friends or family. They'll be too nice and already know what you meant to build.
- A mix: at least one person who uses YNAB or a spreadsheet budget, and at least one who has never heard of Coast FI.

**Where to find them**
1. **People one step away:** ask friends, coworkers or group chats to introduce you to someone who's into budgeting or FIRE. This is the fastest source.
2. **r/coastFIRE**, and r/financialindependence if its rules allow it: a "looking for testers" post (below). Read each subreddit's self-promotion rules first, and message the mods if you're unsure.
3. **People leaving YNAB:** r/ynab and r/budget threads about YNAB's price. Reply helpfully where it fits, not by spamming links.

**Offer:** free Plus for a year once it exists, so their time is worth something.

### Message to someone you're introduced to

> Hey! I'm building Coastwise, an app that tells you when you can stop saving for retirement and just "coast", plus a simple envelope budget. I'm looking for a few people to try it for the first time while I watch. It takes about 30 minutes on a video call, you use your phone, and you don't have to share real numbers. Testers get the paid version free for a year when it launches. Would you be up for it this week or next?

### Reddit post (r/coastFIRE)

> **Title:** I built a Coast FI planner + envelope budget. Looking for 5 people to try it and tell me what's confusing
>
> I've been working on Coastwise ([getcoastwise.com](https://getcoastwise.com/?utm_source=reddit&utm_campaign=coastfire)), a free app that works out your Coast FI number and when you'll hit it, and pairs that with an envelope budget so the plan stays tied to what you actually spend. It works without an account, and your plan stays on your device unless you choose to sync it.
>
> I'm looking for 5 people who've never seen it to try it for the first time and tell me what's confusing: on a 30-minute video call, or on your own with a screen recording or a few answers by email. Made-up numbers are fine. Testers get the paid version free for a year once it launches.
>
> Comment or DM me if you're up for it. Blunt feedback here is welcome too: what would a Coast FI tool need to have for you to actually use it?

## Step 3: Run each session (about 30 minutes)

**Before:** a video call where they share their phone screen. Or ask them to record their screen and talk while they go (both iPhone and Android have built-in screen recording).

**What to say at the start**
> "I'm testing the app, not you. If something's confusing, that's my fault and exactly what I need to find. Please think out loud: say what you're looking for and what you expect to happen. I'll stay quiet and won't help unless you're completely stuck."

**Tasks.** Read them one at a time, and don't explain how to do them.
1. Open getcoastwise.com on your phone and set up a plan. Use rough or made-up numbers.
2. What's your Coast FI number, and when would you reach it? What does that mean for you?
3. Change something about your plan, like retiring two years later, and see what happens.
4. Set up a budget category for groceries and add a $45 grocery purchase.
5. Save your plan so you'd have it on another phone.

**While they work**
- Stay quiet. Write down the moments they pause, scroll around looking, tap the wrong thing, or say "hmm".
- If they're stuck for over a minute, ask "What are you looking for?" before you help.

**Questions at the end**
1. In one sentence, what is this app for?
2. What was the most confusing part?
3. Was anything missing that you expected to find?
4. Would you open this again next week? Why or why not?
5. What do you use today for this? What would make you switch?
6. Would you pay for automatic bank syncing? How much would feel fair?

**After:** thank them, and ask if you can check in with them in a week.

## Step 4: Track and fix

After each session, fill in a row, then fix the top one to three problems before the next person.
Problems that keep coming back across people matter most.

| # | Who (first name / source) | Date | Finished setup without help? | Where they got stuck | Said they'd use it again? | Still using it a week later? |
|---|---|---|---|---|---|---|
| 1 | | | | | | |
| 2 | | | | | | |
| 3 | | | | | | |
| 4 | | | | | | |
| 5 | | | | | | |

## Done when

- [ ] Five sessions are done.
- [ ] The last two people finished all five tasks without help.
- [ ] At least two people said they'd use it again, and at least one actually did a week later.

Then move on to the next goal in the roadmap: 10 real users who are still using it every week a month later.
