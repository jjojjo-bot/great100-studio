-- Apply after 202610200002_timeline_editing.sql and before deploying media compositions.
begin;

create table if not exists public.great100_media_backups (
  project_id uuid primary key references public.great100_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.great100_media_backups enable row level security;
drop policy if exists "own media backups" on public.great100_media_backups;
create policy "own media backups" on public.great100_media_backups for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.great100_media_backups from public, anon, authenticated;
grant select on public.great100_media_backups to authenticated;

create or replace function public.great100_backup_media_upgrade()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((old.data->>'editor_version')::numeric, 0) < 3 and coalesce((new.data->>'editor_version')::numeric, 0) >= 3 then
    insert into public.great100_media_backups (project_id, owner_id, data)
      values (old.id, old.owner_id, old.data) on conflict (project_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function public.great100_backup_media_upgrade() from public, anon, authenticated;
drop trigger if exists great100_media_upgrade_backup on public.great100_projects;
create trigger great100_media_upgrade_backup before update on public.great100_projects
  for each row execute function public.great100_backup_media_upgrade();

-- Enforce original retention even for direct table writes. Presentation fields
-- (signed URLs, selections, scene order) are not original identities.
create or replace function public.great100_guard_media_assets()
returns trigger language plpgsql security definer set search_path = '' as $$
declare previous jsonb; current_asset jsonb; identity_field text;
begin
  if coalesce((new.data->>'editor_version')::numeric, 0) >= 3 then
    if jsonb_typeof(new.data->'media'->'assets') is distinct from 'array' then
      raise exception 'PROJECT_MEDIA_INVALID' using errcode = '22023';
    end if;
    if exists (select 1 from jsonb_array_elements(new.data->'media'->'assets') a
      where jsonb_typeof(a) <> 'object' or coalesce(a->>'id','') = '' or coalesce(a->>'path','') = ''
        or coalesce(a->>'kind','') not in ('image','video','audio'))
      or exists (select 1 from jsonb_array_elements(new.data->'media'->'assets') a group by a->>'id' having count(*) > 1) then
      raise exception 'PROJECT_MEDIA_INVALID' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.data->'media'->'assets') = 'array' then
    for previous in select value from jsonb_array_elements(old.data->'media'->'assets') loop
      select a into current_asset from jsonb_array_elements(new.data->'media'->'assets') a where a->>'id' = previous->>'id';
      if current_asset is null then raise exception 'PROJECT_MEDIA_IMMUTABLE' using errcode = '22023'; end if;
      foreach identity_field in array array['kind','path','mime_type','duration_sec','local_store','local_key'] loop
        if previous->identity_field is distinct from current_asset->identity_field then
          raise exception 'PROJECT_MEDIA_IMMUTABLE' using errcode = '22023';
        end if;
      end loop;
      foreach identity_field in array array['storage_key','preview_storage_key'] loop
        if previous ? identity_field and previous->identity_field is distinct from current_asset->identity_field then
          raise exception 'PROJECT_MEDIA_IMMUTABLE' using errcode = '22023';
        end if;
      end loop;
    end loop;
  end if;
  return new;
end;
$$;
revoke all on function public.great100_guard_media_assets() from public, anon, authenticated;
drop trigger if exists great100_media_assets_guard on public.great100_projects;
create trigger great100_media_assets_guard before insert or update on public.great100_projects
  for each row execute function public.great100_guard_media_assets();

-- New clients use this RPC only for project-wide originals and scene compositions.
-- Older editor RPCs retain their existing version contracts.
create or replace function public.great100_save_media_project(p_id uuid, p_data jsonb, p_expected_version bigint)
returns setof public.great100_projects language plpgsql security invoker set search_path = '' as $$
declare saved public.great100_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_data->'editor_version' is distinct from '3'::jsonb then
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
revoke all on function public.great100_save_media_project(uuid, jsonb, bigint) from public, anon;
grant execute on function public.great100_save_media_project(uuid, jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
