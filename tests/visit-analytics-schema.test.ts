import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

const db = new PGlite();
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const sessionA = "33333333-3333-4333-8333-333333333333";
const sessionB = "44444444-4444-4444-8444-444444444444";
const sessionA2 = "55555555-5555-4555-8555-555555555555";
const migration = readFileSync(new URL("../supabase/migrations/202610190002_visit_analytics.sql", import.meta.url), "utf8");
const reports = readFileSync(new URL("../supabase/queries/visit_analytics.sql", import.meta.url), "utf8");

async function asUser(userId: string, sessionId: string) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: userId, session_id: sessionId })]);
  await db.exec("set role authenticated");
}
const record = () => db.query("select public.great100_record_visit()");

beforeAll(async () => {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create table auth.users (id uuid primary key, email text);
    create table auth.sessions (id uuid primary key, user_id uuid references auth.users(id), created_at timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('request.jwt.claims', true), '')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated, anon;
    insert into auth.users values ('${alice}', 'alice@example.com'), ('${bob}', 'bob@example.com');
  `);
  await db.exec(migration); await db.exec(migration);
}, 30_000);
beforeEach(async () => {
  await db.exec("reset role; delete from public.great100_daily_visits; delete from public.great100_login_history; delete from auth.sessions");
  await db.query("insert into auth.sessions values ($1,$2,now()),($3,$4,now()),($5,$2,now())", [sessionA, alice, sessionB, bob, sessionA2]);
});
afterAll(async () => { await db.close(); });

it("counts refreshes, tabs and multiple devices as one daily visitor per account", async () => {
  await asUser(alice, sessionA); await record(); await record();
  await asUser(alice, sessionA2); await record();
  await asUser(bob, sessionB); await record();
  await db.exec("reset role");
  expect((await db.query("select * from public.great100_daily_visits")).rows).toHaveLength(2);
  expect((await db.query("select * from public.great100_login_history")).rows).toHaveLength(3);
  expect((await db.query("select daily_users,login_count,login_users from public.great100_daily_stats")).rows).toEqual([{ daily_users: 2, login_count: 3, login_users: 2 }]);
});

it("records today's visit separately from the original sign-in date", async () => {
  await db.query("update auth.sessions set created_at='2026-01-02T15:00:00Z' where id=$1", [sessionA]);
  await asUser(alice, sessionA); await record();
  const result = await db.query<{ today: string; recorded: string; signedIn: string }>(`select
    (now() at time zone 'Asia/Seoul')::date::text as today,
    visits.visit_date::text as recorded,
    (history.signed_in_at at time zone 'Asia/Seoul')::date::text as "signedIn"
    from public.great100_daily_visits visits join public.great100_login_history history using (user_id)`);
  expect(result.rows[0].recorded).toBe(result.rows[0].today);
  expect(result.rows[0].signedIn).toBe("2026-01-03");
  await db.exec("reset role");
  await db.exec(migration); // Existing rows must also survive re-installation.
  expect((await db.query("select * from public.great100_daily_visits")).rows).toHaveLength(1);
});

it("keeps login history after sign-out but rejects a terminated session", async () => {
  await asUser(alice, sessionA); await record();
  await db.exec("reset role"); await db.query("delete from auth.sessions where id=$1", [sessionA]);
  await asUser(alice, sessionA);
  await expect(record()).rejects.toThrow("ACTIVE_SESSION_REQUIRED");
  expect((await db.query("select * from public.great100_login_history")).rows).toHaveLength(1);
});

it("uses server identity and denies fabricated sessions and direct history edits", async () => {
  await asUser(alice, sessionB);
  await expect(record()).rejects.toThrow("ACTIVE_SESSION_REQUIRED");
  await asUser(alice, sessionA); await record();
  await expect(db.query("update public.great100_daily_visits set visit_date='2000-01-01'")).rejects.toThrow();
  await expect(db.query("delete from public.great100_login_history")).rejects.toThrow();
  await asUser(bob, sessionB);
  expect((await db.query("select * from public.great100_daily_visits")).rows).toEqual([]);
  expect((await db.query("select * from public.great100_login_history")).rows).toEqual([]);
  await expect(db.query("select * from public.great100_daily_stats")).rejects.toThrow();
  await db.exec("reset role; set role anon");
  await expect(record()).rejects.toThrow();
  await expect(db.query("select * from public.great100_daily_visits")).rejects.toThrow();
});

it("groups sign-ins across the Korean midnight boundary and executes all admin reports", async () => {
  await db.query(`insert into public.great100_login_history values
    ($1,$2,'2026-01-02T14:59:59Z',now()), ($3,$4,'2026-01-02T15:00:00Z',now())`, [sessionA, alice, sessionB, bob]);
  expect((await db.query("select visit_date::text,login_count from public.great100_daily_stats order by visit_date")).rows).toEqual([
    { visit_date: "2026-01-02", login_count: 1 }, { visit_date: "2026-01-03", login_count: 1 },
  ]);
  const result = await db.exec(reports);
  expect(result[0].rows).toHaveLength(30); expect(result[1].rows).toHaveLength(2); expect(result[2].rows).toHaveLength(0);
});
