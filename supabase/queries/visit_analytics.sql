-- Run these read-only queries as the default postgres role in Supabase SQL Editor.

-- 1. Last 30 days, including dates with no visitors. All dates use Korea time.
with days as (
  select (now() at time zone 'Asia/Seoul')::date - offset_days as visit_date
  from generate_series(0, 29) as offset_days
)
select days.visit_date as "날짜",
  coalesce(stats.daily_users, 0) as "방문자 수",
  coalesce(stats.login_count, 0) as "로그인 횟수",
  coalesce(stats.login_users, 0) as "로그인한 사용자 수"
from days left join public.great100_daily_stats stats using (visit_date)
order by days.visit_date desc;

-- 2. Recent login sessions. Refreshing a tab or a token does not add a login.
select users.email as "이메일",
  history.signed_in_at at time zone 'Asia/Seoul' as "로그인 시각",
  history.first_seen_at at time zone 'Asia/Seoul' as "최초 기록 시각"
from public.great100_login_history history
join auth.users users on users.id = history.user_id
order by history.signed_in_at desc limit 100;

-- 3. Today's visitors: each account appears only once across all its devices.
select users.email as "이메일",
  visits.first_seen_at at time zone 'Asia/Seoul' as "첫 방문 기록",
  visits.last_seen_at at time zone 'Asia/Seoul' as "최근 방문 기록"
from public.great100_daily_visits visits
join auth.users users on users.id = visits.user_id
where visits.visit_date = (now() at time zone 'Asia/Seoul')::date
order by visits.first_seen_at desc;
