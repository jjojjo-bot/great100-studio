import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, expect, it } from "vitest";

const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const project = "33333333-3333-4333-8333-333333333333";
const migration = readFileSync(new URL("../supabase/migrations/202610190001_cloud_projects.sql", import.meta.url), "utf8");
const editorMigration = readFileSync(new URL("../supabase/migrations/202610200001_editor_compatibility.sql", import.meta.url), "utf8");
const timingMigration = readFileSync(new URL("../supabase/migrations/202610200002_timeline_editing.sql", import.meta.url), "utf8");
const mediaMigration = readFileSync(new URL("../supabase/migrations/202610200003_media_composition.sql", import.meta.url), "utf8");
const structureMigration = readFileSync(new URL("../supabase/migrations/202610200004_scene_splitting.sql", import.meta.url), "utf8");
const mergeMigration = readFileSync(new URL("../supabase/migrations/202610200005_scene_merging.sql", import.meta.url), "utf8");

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
  await db.exec(timingMigration);
  await db.exec(timingMigration);
  await db.exec(mediaMigration);
  await db.exec(mediaMigration);
  await db.exec(structureMigration);
  await db.exec(structureMigration);
  await db.exec(mergeMigration);
  await db.exec(mergeMigration);
}, 30_000);
afterAll(async () => { await db.close(); });

it("backs up before splitting, enforces the v4 contract and retains source and originals across undo", async () => {
  await asUser(alice);
  const id = "77777777-7777-4777-8777-777777777777";
  const asset = { id: "voice", kind: "audio", path: "voice.wav", storage_key: "original" };
  const original = { id, episode: 7, editor_version: 3, source_text: "원문", source: { original: true }, media: { assets: [asset] }, scenes: [{ id: "parent" }] };
  await db.query("select * from public.great100_save_media_project($1,$2::jsonb,0)", [id, JSON.stringify(original)]);
  const split = { ...original, editor_version: 4, scenes: [{ id: "parent" }, { id: "child" }] };
  await db.query("select * from public.great100_save_structured_project($1,$2::jsonb,1)", [id, JSON.stringify(split)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_structure_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_media_project($1,$2::jsonb,2)", [id, JSON.stringify(split)])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  await expect(db.query("select * from public.great100_save_media_project($1,$2::jsonb,2)", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  for (const changed of [{ ...split, source_text: "교체" }, { ...split, media: { assets: [] } }]) {
    await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,2)", [id, JSON.stringify(changed)])).rejects.toThrow(/PROJECT_(SOURCE|MEDIA)_IMMUTABLE/);
  }
  await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,1)", [id, JSON.stringify(split)])).rejects.toThrow("PROJECT_CONFLICT");
  await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...split, editor_version: 5 })])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  const undone = { ...original, editor_version: 4 };
  await db.query("select * from public.great100_save_structured_project($1,$2::jsonb,2)", [id, JSON.stringify(undone)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_structure_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await asUser(bob);
  expect((await db.query("select * from public.great100_structure_backups")).rows).toEqual([]);
  await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,3)", [id, JSON.stringify(split)])).rejects.toThrow("PROJECT_CONFLICT");
  await expect(db.query("delete from public.great100_structure_backups")).rejects.toThrow();
  await asUser(alice); await db.query("delete from public.great100_projects where id=$1", [id]);
  expect((await db.query("select * from public.great100_structure_backups where project_id=$1", [id])).rows).toEqual([]);
});

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

it("retains the pre-timing snapshot and denies editor-v1 writes after the v2 upgrade", async () => {
  await asUser(alice);
  const id = "55555555-5555-4555-8555-555555555555";
  const original = { id, episode: 4, person: "시간 조정", editor_version: 1, source_text: "원본", source: { raw: true }, scenes: [{ id: "stable", duration: 10 }] };
  await db.query("select * from public.great100_save_editor_project($1,$2::jsonb,0)", [id, JSON.stringify(original)]);
  const edited = { ...original, editor_version: 2, scenes: [{ id: "stable", duration: 14 }] };
  await db.query("select * from public.great100_save_timed_project($1,$2::jsonb,1)", [id, JSON.stringify(edited)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_timing_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_editor_project($1,$2::jsonb,2)", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  await expect(db.query("select * from public.great100_save_timed_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, source_text: "덮어쓰기" })])).rejects.toThrow("PROJECT_SOURCE_IMMUTABLE");
  await expect(db.query("select * from public.great100_save_timed_project($1,$2::jsonb,1)", [id, JSON.stringify(edited)])).rejects.toThrow("PROJECT_CONFLICT");
  await db.query("select * from public.great100_save_timed_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, scenes: [{ id: "stable", duration: 10 }] })]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_timing_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await asUser(bob);
  expect((await db.query("select * from public.great100_timing_backups")).rows).toEqual([]);
  await expect(db.query("delete from public.great100_timing_backups")).rejects.toThrow();
});

it("backs up the media transition, retains originals through unlinks, and rejects old writers and locator replacements", async () => {
  await asUser(alice);
  const id = "66666666-6666-4666-8666-666666666666";
  const original = { id, episode: 5, editor_version: 2, source_text: "원본", source: { keep: true } };
  await db.query("select * from public.great100_save_timed_project($1,$2::jsonb,0)", [id, JSON.stringify(original)]);
  const asset = { id: "voice", kind: "audio", path: "original.wav", mime_type: "audio/wav", duration_sec: 3, storage_key: "private-voice", local_store: "audio", local_key: "original-key", extra: { keep: true } };
  const edited = { ...original, editor_version: 3, media: { assets: [asset] }, scenes: [{ id: "scene", composition: { visuals: [], narrations: [{ asset_id: "voice", source_start_sec: 1, source_end_sec: 2, start_sec: 0, end_sec: 1 }] } }] };
  await db.query("select * from public.great100_save_media_project($1,$2::jsonb,1)", [id, JSON.stringify(edited)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_media_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_timed_project($1,$2::jsonb,2)", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  await expect(db.query("select * from public.great100_save_timed_project($1,$2::jsonb,2)", [id, JSON.stringify(edited)])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  for (const assets of [[], [{ ...asset, path: "replacement.wav" }], [{ ...asset, storage_key: "replacement-key" }], [{ ...asset, local_key: "replacement-local" }]]) {
    await expect(db.query("select * from public.great100_save_media_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...edited, media: { assets } })])).rejects.toThrow("PROJECT_MEDIA_IMMUTABLE");
  }
  await expect(db.query("update public.great100_projects set data=$2::jsonb where id=$1", [id, JSON.stringify({ ...edited, media: { assets: [] } })])).rejects.toThrow("PROJECT_MEDIA_IMMUTABLE");
  const unlinked = { ...edited, scenes: [] };
  await db.query("select * from public.great100_save_media_project($1,$2::jsonb,2)", [id, JSON.stringify(unlinked)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_projects where id=$1", [id])).rows).toEqual([{ data: unlinked }]);
  await expect(db.query("select * from public.great100_save_media_project($1,$2::jsonb,2)", [id, JSON.stringify(unlinked)])).rejects.toThrow("PROJECT_CONFLICT");
  await expect(db.query("select * from public.great100_save_media_project($1,$2::jsonb,3)", [id, JSON.stringify({ ...unlinked, source_text: "교체" })])).rejects.toThrow("PROJECT_SOURCE_IMMUTABLE");
  await asUser(bob);
  expect((await db.query("select * from public.great100_media_backups")).rows).toEqual([]);
  await expect(db.query("delete from public.great100_media_backups")).rejects.toThrow();
  await asUser(alice);
  await db.query("delete from public.great100_projects where id=$1", [id]);
  expect((await db.query("select * from public.great100_media_backups where project_id=$1", [id])).rows).toEqual([]);
});

it("backs up v4 once before merging, preserves presentation and rejects obsolete or foreign writers", async () => {
  await asUser(alice);
  const id = "88888888-8888-4888-8888-888888888888";
  const asset = { id: "voice", kind: "audio", path: "source.wav", storage_key: "original" };
  const original = { id, episode: 8, editor_version: 4, source_text: "원문", source: { keep: true }, media: { assets: [asset] }, scenes: [{ id: "a" }, { id: "b" }] };
  await db.query("select * from public.great100_save_structured_project($1,$2::jsonb,0)", [id, JSON.stringify(original)]);
  const merged = { ...original, editor_version: 5, scenes: [{ id: "a", composition: { visuals: [{ presentation: { subtitle: "앞", music_volume: 10 } }, { presentation: { subtitle: "뒤", music_volume: 90 } }] } }] };
  await db.query("select * from public.great100_save_merged_project($1,$2::jsonb,1)", [id, JSON.stringify(merged)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_merge_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,2)", [id, JSON.stringify(merged)])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  await expect(db.query("select * from public.great100_save_structured_project($1,$2::jsonb,2)", [id, JSON.stringify(original)])).rejects.toThrow("PROJECT_EDITOR_VERSION_DOWNGRADE");
  await expect(db.query("select * from public.great100_save_merged_project($1,$2::jsonb,1)", [id, JSON.stringify(merged)])).rejects.toThrow("PROJECT_CONFLICT");
  for (const changed of [{ ...merged, source_text: "변경" }, { ...merged, media: { assets: [] } }, { ...merged, media: { assets: [{ ...asset, path: "replacement.wav" }] } }]) await expect(db.query("select * from public.great100_save_merged_project($1,$2::jsonb,2)", [id, JSON.stringify(changed)])).rejects.toThrow(/PROJECT_(SOURCE|MEDIA)_IMMUTABLE/);
  await expect(db.query("select * from public.great100_save_merged_project($1,$2::jsonb,2)", [id, JSON.stringify({ ...merged, editor_version: 6 })])).rejects.toThrow("PROJECT_EDITOR_VERSION_UNSUPPORTED");
  const undo = { ...original, editor_version: 5 };
  await db.query("select * from public.great100_save_merged_project($1,$2::jsonb,2)", [id, JSON.stringify(undo)]);
  expect((await db.query<{ data: unknown }>("select data from public.great100_merge_backups where project_id=$1", [id])).rows).toEqual([{ data: original }]);
  await asUser(bob); expect((await db.query("select * from public.great100_merge_backups")).rows).toEqual([]);
  await expect(db.query("select * from public.great100_save_merged_project($1,$2::jsonb,3)", [id, JSON.stringify(merged)])).rejects.toThrow("PROJECT_CONFLICT");
  await expect(db.query("delete from public.great100_merge_backups")).rejects.toThrow();
  await asUser(alice); await db.query("delete from public.great100_projects where id=$1", [id]);
  expect((await db.query("select * from public.great100_merge_backups where project_id=$1", [id])).rows).toEqual([]);
});
