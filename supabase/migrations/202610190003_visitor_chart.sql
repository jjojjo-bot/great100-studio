-- Install after 202610190002_visit_analytics.sql in Supabase SQL Editor.
begin;

create table if not exists public.great100_analytics_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.great100_analytics_admins enable row level security;
-- Only the Supabase project administrator can assign analytics access.
revoke all on public.great100_analytics_admins from public, anon, authenticated;

create or replace function public.great100_is_analytics_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.great100_analytics_admins where user_id = auth.uid());
$$;

create or replace function public.great100_visitor_trends()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Seoul')::date;
  week_start date := date_trunc('week', today::timestamp)::date;
  result jsonb;
begin
  if not public.great100_is_analytics_admin() then
    raise exception 'ANALYTICS_ADMIN_REQUIRED' using errcode = '42501';
  end if;

  with daily_counts as (
    select visits.visit_date, count(*) as visitors from public.great100_daily_visits visits
    where visits.visit_date between today - 13 and today group by visits.visit_date
  ), weekly_counts as (
    select date_trunc('week', visits.visit_date::timestamp)::date as period_start,
      count(distinct visits.user_id) as visitors
    from public.great100_daily_visits visits
    where visits.visit_date between week_start - 49 and today group by 1
  ), daily as (
    select today - offset_days as period_start, today - offset_days as period_end,
      coalesce(counts.visitors, 0) as visitors
    from generate_series(0, 13) as offset_days
    left join daily_counts counts on counts.visit_date = today - offset_days
  ), weekly as (
    select week_start - offset_weeks * 7 as period_start,
      least(week_start - offset_weeks * 7 + 6, today) as period_end,
      coalesce(counts.visitors, 0) as visitors
    from generate_series(0, 7) as offset_weeks
    left join weekly_counts counts on counts.period_start = week_start - offset_weeks * 7
  )
  select jsonb_build_object(
    'today', today,
    'today_visitors', (select visitors from daily where period_start = today),
    'week_visitors', (select visitors from weekly where period_start = week_start),
    'daily', (select jsonb_agg(to_jsonb(daily) order by period_start) from daily),
    'weekly', (select jsonb_agg(to_jsonb(weekly) order by period_start) from weekly)
  ) into result;
  return result;
end;
$$;

revoke all on function public.great100_is_analytics_admin() from public, anon;
revoke all on function public.great100_visitor_trends() from public, anon;
grant execute on function public.great100_is_analytics_admin() to authenticated;
grant execute on function public.great100_visitor_trends() to authenticated;
notify pgrst, 'reload schema';
commit;
