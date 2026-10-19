-- Run this file once in this project's Supabase SQL Editor.
begin;

create table if not exists public.great100_projects (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  episode integer not null check (episode > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_at timestamptz not null default now(),
  unique (owner_id, episode)
);

create table if not exists public.great100_episode_counters (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  last_episode integer not null default 0 check (last_episode >= 0)
);

create table if not exists public.great100_exports (
  project_id uuid primary key references public.great100_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  storage_key text not null,
  project_updated_at text not null,
  render_version integer not null
);

alter table public.great100_projects enable row level security;
alter table public.great100_episode_counters enable row level security;
alter table public.great100_exports enable row level security;

drop policy if exists "own projects" on public.great100_projects;
create policy "own projects" on public.great100_projects for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "own episode counter" on public.great100_episode_counters;
create policy "own episode counter" on public.great100_episode_counters for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists "own exports" on public.great100_exports;
create policy "own exports" on public.great100_exports for all to authenticated
  using (owner_id = (select auth.uid())) with check (
    owner_id = (select auth.uid()) and exists (
      select 1 from public.great100_projects where id = project_id and owner_id = (select auth.uid())
    )
  );

revoke all on public.great100_projects, public.great100_episode_counters from anon;
revoke all on public.great100_exports from anon;
grant select, insert, update, delete on public.great100_projects, public.great100_episode_counters to authenticated;
grant select, insert, update, delete on public.great100_exports to authenticated;

-- The atomic counter also accounts for projects imported from older browsers.
create or replace function public.great100_reserve_episode()
returns integer language plpgsql security invoker set search_path = '' as $$
declare result integer;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  insert into public.great100_episode_counters as counter (owner_id, last_episode)
    values (auth.uid(), coalesce((select max(episode) from public.great100_projects where owner_id = auth.uid()), 0) + 1)
    on conflict (owner_id) do update set last_episode = greatest(
      counter.last_episode,
      coalesce((select max(episode) from public.great100_projects where owner_id = auth.uid()), 0)
    ) + 1 returning last_episode into result;
  return result;
end;
$$;

-- A stale browser cannot overwrite a newer edit made on another PC.
create or replace function public.great100_save_project(p_id uuid, p_data jsonb, p_expected_version bigint)
returns setof public.great100_projects language plpgsql security invoker set search_path = '' as $$
declare saved public.great100_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_data->>'id' is distinct from p_id::text then
    raise exception 'PROJECT_ID_MISMATCH' using errcode = '22023';
  end if;
  if p_expected_version = 0 then
    insert into public.great100_projects (id, owner_id, episode, data)
      values (p_id, auth.uid(), (p_data->>'episode')::integer, p_data)
      on conflict (id) do nothing returning * into saved;
  else
    update public.great100_projects set data = p_data, version = version + 1, updated_at = now()
      where id = p_id and owner_id = auth.uid() and version = p_expected_version
        and episode = (p_data->>'episode')::integer
      returning * into saved;
  end if;
  if saved.id is null then raise exception 'PROJECT_CONFLICT' using errcode = '40001'; end if;
  return next saved;
end;
$$;

revoke all on function public.great100_reserve_episode() from public, anon;
revoke all on function public.great100_save_project(uuid, jsonb, bigint) from public, anon;
grant execute on function public.great100_reserve_episode() to authenticated;
grant execute on function public.great100_save_project(uuid, jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
