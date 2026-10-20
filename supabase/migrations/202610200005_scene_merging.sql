-- Apply after 202610200004_scene_splitting.sql and before deploying scene merging.
begin;

create table if not exists public.great100_merge_backups (
  project_id uuid primary key references public.great100_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.great100_merge_backups enable row level security;
drop policy if exists "own merge backups" on public.great100_merge_backups;
create policy "own merge backups" on public.great100_merge_backups for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.great100_merge_backups from public, anon, authenticated;
grant select on public.great100_merge_backups to authenticated;

create or replace function public.great100_backup_merge_upgrade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((old.data->>'editor_version')::numeric, 0) < 5 and coalesce((new.data->>'editor_version')::numeric, 0) >= 5 then
    insert into public.great100_merge_backups (project_id, owner_id, data)
      values (old.id, old.owner_id, old.data) on conflict (project_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.great100_backup_merge_upgrade() from public, anon, authenticated;
drop trigger if exists great100_merge_upgrade_backup on public.great100_projects;
create trigger great100_merge_upgrade_backup before update on public.great100_projects
  for each row execute function public.great100_backup_merge_upgrade();

-- Scene merging preserves section-specific presentation and original voice limits.
-- Older editor RPCs retain their existing version contracts.
create or replace function public.great100_save_merged_project(p_id uuid, p_data jsonb, p_expected_version bigint)
returns setof public.great100_projects language plpgsql security invoker set search_path = '' as $$
declare saved public.great100_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_data->'editor_version' is distinct from '5'::jsonb then
    raise exception 'PROJECT_EDITOR_VERSION_UNSUPPORTED' using errcode = '22023';
  end if;
  if p_data->>'id' is distinct from p_id::text then raise exception 'PROJECT_ID_MISMATCH' using errcode = '22023'; end if;
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
revoke all on function public.great100_save_merged_project(uuid, jsonb, bigint) from public, anon;
grant execute on function public.great100_save_merged_project(uuid, jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
