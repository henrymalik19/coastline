-- Weekly numbers for the live site. Counts only, no personal details.
-- Run from the repo root:  pnpm stats
-- "Active" = the app refreshed its sign-in that week, which happens while it's open (hourly).
-- People using Coastwise without an account don't show up here; the Vercel Analytics visitor count covers them.
select
  (select count(*) from auth.users) as accounts,
  (select count(*) from auth.users where created_at > now() - interval '7 days') as new_this_week,
  (select count(distinct user_id) from auth.sessions
    where coalesce(refreshed_at, updated_at, created_at) > now() - interval '7 days') as active_this_week,
  (select count(*) from public.plan where onboarded) as plans_set_up,
  -- of the people who signed up 4-5 weeks ago, how many used it this week
  (select count(*) from auth.users u where u.created_at between now() - interval '35 days' and now() - interval '28 days') as signed_up_4_weeks_ago,
  (select count(*) from auth.users u where u.created_at between now() - interval '35 days' and now() - interval '28 days'
    and exists (select 1 from auth.sessions s where s.user_id = u.id
      and coalesce(s.refreshed_at, s.updated_at, s.created_at) > now() - interval '7 days')) as still_active_4_weeks_later;
