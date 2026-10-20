-- Apply before deploying the editor-version-aware client. Existing clients may
-- continue saving legacy projects until their first editor-format upgrade.
begin;

create table if not exists public.great100_project_backups (
  project_id uuid primary key references public.great100_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.great100_project_backups enable row level security;
drop policy if exists "own project backups" on public.great100_project_backups;
create policy "own project backups" on public.great100_project_backups for select to authenticated
  using (owner_id = (select auth.uid()));
revoke all on public.great100_project_backups from public, anon, authenticated;
grant select on public.great100_project_backups to authenticated;

-- A table trigger protects upgraded data even from older RPC clients or direct
-- table writes. The first conversion retains the exact previous JSONB snapshot.
create or replace function public.great100_guard_editor_format()
returns trigger language plpgsql security definer set search_path = '' as $$
declare next_version numeric := 0; previous_version numeric := 0;
begin
  if new.data ? 'editor_version' then
    if jsonb_typeof(new.data->'editor_version') <> 'number' then
      raise exception 'PROJECT_EDITOR_VERSION_INVALID' using errcode = '22023';
    end if;
    next_version := (new.data->>'editor_version')::numeric;
    if next_version < 0 or trunc(next_version) <> next_version then
      raise exception 'PROJECT_EDITOR_VERSION_INVALID' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    previous_version := coalesce((old.data->>'editor_version')::numeric, 0);
    if next_version < previous_version then
      raise exception 'PROJECT_EDITOR_VERSION_DOWNGRADE' using errcode = '22023';
    end if;
    if next_version >= 1 and (old.data->'source' is distinct from new.data->'source'
      or old.data->'source_text' is distinct from new.data->'source_text') then
      raise exception 'PROJECT_SOURCE_IMMUTABLE' using errcode = '22023';
    end if;
    if previous_version = 0 and next_version >= 1 then
      insert into public.great100_project_backups (project_id, owner_id, data)
        values (old.id, old.owner_id, old.data) on conflict (project_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.great100_guard_editor_format() from public, anon, authenticated;
drop trigger if exists great100_editor_format_guard on public.great100_projects;
create trigger great100_editor_format_guard before insert or update on public.great100_projects
  for each row execute function public.great100_guard_editor_format();

-- Separate RPC name makes a missing migration fail before claiming a new-format
-- save succeeded. No fallback to the unguarded legacy installation is allowed.
-- Old clients can carry unknown top-level fields through a spread. Reject their
-- legacy RPC even if they happen to echo editor_version back unchanged.
create or replace function public.great100_save_project(p_id uuid, p_data jsonb, p_expected_version bigint)
returns setof public.great100_projects language plpgsql security invoker set search_path = '' as $$
declare saved public.great100_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_data ? 'editor_version' and p_data->'editor_version' is distinct from '0'::jsonb then
    raise exception 'PROJECT_EDITOR_VERSION_LEGACY_CLIENT' using errcode = '22023';
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

create or replace function public.great100_save_editor_project(p_id uuid, p_data jsonb, p_expected_version bigint)
returns setof public.great100_projects language plpgsql security invoker set search_path = '' as $$
declare saved public.great100_projects;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if p_data->'editor_version' is distinct from '1'::jsonb then
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
revoke all on function public.great100_save_editor_project(uuid, jsonb, bigint) from public, anon;
grant execute on function public.great100_save_editor_project(uuid, jsonb, bigint) to authenticated;
notify pgrst, 'reload schema';
commit;
