import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const migration = readFileSync(new URL("../supabase/migrations/202610190001_cloud_projects.sql", import.meta.url), "utf8");
const editorMigration = readFileSync(new URL("../supabase/migrations/202610200001_editor_compatibility.sql", import.meta.url), "utf8");

async function asUser(id: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec("set role authenticated");
}

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    grant execute on function auth.uid() to authenticated, anon;
    insert into auth.users values ('${alice}'), ('${bob}');
  `);
  await db.exec(migration);
  await db.exec(migration); // Re-running installation must preserve tables and policies.
  await db.exec(editorMigration);
  await db.exec(editorMigration);
}, 30_000);
afterAll(async () => { await db.close(); });

it("reserves consecutive episode numbers and creates a versioned project", async () => {
  await asUser(alice);
  expect((await db.query<{ episode: number }>("select public.great100_reserve_episode() as episode")).rows[0].episode).toBe(1);
  expect((await db.query<{ episode: number }>("select public.great100_reserve_episode() as episode")).rows[0].episode).toBe(2);
  const result = await db.query<{ version: number }>("select * from public.great100_save_project($1, $2::jsonb, 0)", [project, JSON.stringify({ id: project, episode: 2, person: "세종" })]);
  expect(result.rows[0].version).toBe(1);
});

it("rejects stale edits without overwriting the current project", async () => {
  await asUser(alice);
  await db.query("select * from public.great100_save_project($1, $2::jsonb, 1)", [project, JSON.stringify({ id: project, episode: 2, person: "최신 편집" })]);
  await expect(db.query("select * from public.great100_save_project($1, $2::jsonb, 1)", [project, JSON.stringify({ id: project, episode: 2, person: "오래된 PC" })])).rejects.toThrow("PROJECT_CONFLICT");
  const result = await db.query<{ person: string }>("select data->>'person' as person from public.great100_projects");
  expect(result.rows).toEqual([{ person: "최신 편집" }]);
});

it("isolates project data, export metadata, and episode counters between accounts", async () => {
  await asUser(alice);
  await db.query("insert into public.great100_exports values ($1,$2,'private-key','now',8)", [project, alice]);
  await asUser(bob);
  expect((await db.query("select * from public.great100_projects")).rows).toEqual([]);
  expect((await db.query("select * from public.great100_exports")).rows).toEqual([]);
  expect((await db.query<{ episode: number }>("select public.great100_reserve_episode() as episode")).rows[0].episode).toBe(1);
  await expect(db.query("select * from public.great100_save_project($1, $2::jsonb, 2)", [project, JSON.stringify({ id: project, episode: 2, person: "타인" })])).rejects.toThrow("PROJECT_CONFLICT");
  await expect(db.query("insert into public.great100_exports values ($1,$2,'other-key','now',8)", [project, bob])).rejects.toThrow();
});

it("denies anonymous project access", async () => {
  await db.exec("reset role; set role anon");
  await expect(db.query("select * from public.great100_projects")).rejects.toThrow();
  await expect(db.query("select public.great100_reserve_episode()")).rejects.toThrow();
});

it("backs up legacy data once and blocks old RPCs, including clients echoing the new format field", async () => {
  await asUser(alice);
  const id = "44444444-4444-4444-8444-444444444444";
  const original = { id, episode: 3, person: "세종", source_text: "원본", source: { raw: "원본" }, extra: { retained: true } };
  await db.query("select * from public.great100_save_project($1,$2::jsonb,0)", [id, JSON.stringify(original)]);
  const edited = { ...original, editor_version: 1, editor: { core_scene_ids: ["stable-id"] }, person: "편집" };
  await db.query("select * from public.great100_save_editor_project($1,$2::jsonb,1)", [id, JSON.stringify(edited)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_project_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_project($1,$2::jsonb,2)", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  await expect(db.query("select * from public.great100_save_project($1,$2::jsonb,2)", [id, JSON.stringify(edited)])).rejects.toThrow("PROJECT_EDITOR_VERSION_LEGACY_CLIENT");
  await expect(db.query("update public.great100_projects set data=$2::jsonb where id=$1", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  await expect(db.query("select * from public.great100_save_editor_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, source_text: "원문 교체" })])).rejects.toThrow("PROJECT_SOURCE_IMMUTABLE");
  await expect(db.query("select * from public.great100_save_editor_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, editor_version: 2 })])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  await db.query("select * from public.great100_save_editor_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, person: "재편집" })]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_project_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_editor_project($1,$2::jsonb,2)", [id, JSON.stringify(edited)])).rejects.toThrow("PROJECT_CONFLICT");
  await asUser(bob);
  expect((await db.query("select * from public.great100_project_backups")).rows).toEqual([]);
  await expect(db.query("delete from public.great100_project_backups")).rejects.toThrow();
});
