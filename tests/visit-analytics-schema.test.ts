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
const chartMigration = readFileSync(new URL("../supabase/migrations/202610190003_visitor_chart.sql", import.meta.url), "utf8");
const grantAdmin = readFileSync(new URL("../supabase/queries/grant_analytics_admin.sql", import.meta.url), "utf8");
const grantAdminFor = (email: string) => grantAdmin.replace(
  /admin_email\s+text\s*:=\s*'(?:[^']|'')*'/,
  `admin_email text := '${email.replaceAll("'", "''")}'`,
);

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
  await db.exec(chartMigration); await db.exec(chartMigration);
}, 30_000);
beforeEach(async () => {
  await db.exec("reset role; delete from public.great100_daily_visits; delete from public.great100_login_history; delete from auth.sessions");
  await db.exec("delete from public.great100_analytics_admins");
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

interface ChartData {
  today: string; today_visitors: number; week_visitors: number;
  daily: { period_start: string; period_end: string; visitors: number }[];
  weekly: { period_start: string; period_end: string; visitors: number }[];
}
const trends = async () => (await db.query<{ chart: ChartData }>("select public.great100_visitor_trends() as chart")).rows[0].chart;

it("denies non-admin totals and self-promotion, including direct RPC calls", async () => {
  await asUser(alice, sessionA);
  expect((await db.query<{ allowed: boolean }>("select public.great100_is_analytics_admin() as allowed")).rows[0].allowed).toBe(false);
  await expect(trends()).rejects.toThrow("ANALYTICS_ADMIN_REQUIRED");
  await expect(db.query("insert into public.great100_analytics_admins (user_id) values ($1)", [alice])).rejects.toThrow();
  await expect(db.query("select * from public.great100_analytics_admins")).rejects.toThrow();
  await db.exec("reset role; set role anon"); await expect(trends()).rejects.toThrow();
});

it("returns 14 days and 8 Monday-based weeks with zeros for missing dates", async () => {
  await db.exec(grantAdminFor("ALICE@EXAMPLE.COM"));
  await asUser(alice, sessionA);
  const chart = await trends();
  expect(chart.daily).toHaveLength(14); expect(chart.weekly).toHaveLength(8);
  expect(chart.daily.every(point => point.visitors === 0)).toBe(true);
  expect(chart.weekly.every(point => new Date(`${point.period_start}T00:00:00Z`).getUTCDay() === 1)).toBe(true);
  expect(chart.weekly.at(-1)!.period_end).toBe(chart.today);
  expect(chart.daily.at(-1)!.period_end).toBe(chart.today);
  expect(chart.today_visitors).toBe(0); expect(chart.week_visitors).toBe(0);
});

it("counts distinct people per week across multiple days instead of summing daily counts", async () => {
  await asUser(alice, sessionA); await record();
  await asUser(bob, sessionB); await record();
  await db.exec("reset role");
  await db.query(`insert into public.great100_daily_visits values
    ($1, date_trunc('week', now() at time zone 'Asia/Seoul')::date - 7, now(), now()),
    ($1, date_trunc('week', now() at time zone 'Asia/Seoul')::date - 6, now(), now()),
    ($2, date_trunc('week', now() at time zone 'Asia/Seoul')::date - 6, now(), now())`, [alice, bob]);
  await db.exec(grantAdminFor("alice@example.com"));
  await asUser(alice, sessionA);
  const chart = await trends();
  expect(chart.today_visitors).toBe(2); expect(chart.week_visitors).toBe(2);
  expect(chart.weekly.at(-2)!.visitors).toBe(2);
  expect(JSON.stringify(chart)).not.toContain(alice); expect(JSON.stringify(chart)).not.toContain("@example.com");
  await db.exec("reset role"); await db.exec(chartMigration);
  await asUser(alice, sessionA); expect((await trends()).week_visitors).toBe(2);
  await db.exec("reset role"); await db.query("delete from public.great100_analytics_admins where user_id=$1", [alice]);
  await asUser(alice, sessionA); await expect(trends()).rejects.toThrow("ANALYTICS_ADMIN_REQUIRED");
});
