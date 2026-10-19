-- Run once in this project's Supabase SQL Editor. Safe to run again.
-- Records authenticated visits only. Calendar days use Asia/Seoul (UTC+09:00).
begin;

create table if not exists public.great100_daily_visits (
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_date date not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  primary key (user_id, visit_date)
);
create index if not exists great100_daily_visits_date_idx on public.great100_daily_visits (visit_date);

create table if not exists public.great100_login_history (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signed_in_at timestamptz not null,
  first_seen_at timestamptz not null
);
-- No FK to auth.sessions: signing out removes that session but must keep history.
create index if not exists great100_login_history_date_idx on public.great100_login_history (signed_in_at);

alter table public.great100_daily_visits enable row level security;
alter table public.great100_login_history enable row level security;

drop policy if exists "read own visits" on public.great100_daily_visits;
create policy "read own visits" on public.great100_daily_visits for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists "read own login history" on public.great100_login_history;
create policy "read own login history" on public.great100_login_history for select to authenticated
  using (user_id = (select auth.uid()));

-- Clients cannot choose identities, dates, session IDs, or edit recorded history.
revoke all on public.great100_daily_visits, public.great100_login_history from public, anon, authenticated;
grant select on public.great100_daily_visits, public.great100_login_history to authenticated;

create or replace function public.great100_record_visit()
returns void language plpgsql security definer set search_path = '' as $$
declare
  visitor uuid := auth.uid();
  session_uuid uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
  recorded_at timestamptz := now();
  session_started_at timestamptz;
begin
  if visitor is null or session_uuid is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  select coalesce(s.created_at, recorded_at) into session_started_at
    from auth.sessions s where s.id = session_uuid and s.user_id = visitor;
  if session_started_at is null then
    raise exception 'ACTIVE_SESSION_REQUIRED' using errcode = '42501';
  end if;

  insert into public.great100_login_history (session_id, user_id, signed_in_at, first_seen_at)
    values (session_uuid, visitor, session_started_at, recorded_at)
    on conflict (session_id) do nothing;

  insert into public.great100_daily_visits (user_id, visit_date, first_seen_at, last_seen_at)
    values (visitor, (recorded_at at time zone 'Asia/Seoul')::date, recorded_at, recorded_at)
    on conflict (user_id, visit_date) do update set
      first_seen_at = least(public.great100_daily_visits.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(public.great100_daily_visits.last_seen_at, excluded.last_seen_at);
end;
$$;
revoke all on function public.great100_record_visit() from public, anon;
grant execute on function public.great100_record_visit() to authenticated;

-- Admin-only daily totals. Also obey RLS if access is granted in the future.
create or replace view public.great100_daily_stats with (security_invoker = true) as
  select coalesce(visits.visit_date, logins.visit_date) as visit_date,
    coalesce(visits.daily_users, 0) as daily_users,
    coalesce(logins.login_count, 0) as login_count,
    coalesce(logins.login_users, 0) as login_users
  from (
    select visit_date, count(*) as daily_users from public.great100_daily_visits group by visit_date
  ) visits full join (
    select (signed_in_at at time zone 'Asia/Seoul')::date as visit_date,
      count(*) as login_count, count(distinct user_id) as login_users
    from public.great100_login_history group by 1
  ) logins using (visit_date);
revoke all on public.great100_daily_stats from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
