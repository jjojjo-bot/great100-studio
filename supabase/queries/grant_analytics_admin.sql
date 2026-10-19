-- Replace the email below with the Google account used to sign in to Great100.
-- Run as postgres in Supabase SQL Editor, after the visitor-chart migration.
do $$
declare
  admin_email text := 'YOUR_GOOGLE_EMAIL';
  admin_id uuid;
begin
  select id into admin_id from auth.users where lower(email) = lower(trim(admin_email));
  if admin_id is null then
    raise exception '로그인한 Google 이메일로 YOUR_GOOGLE_EMAIL을 바꿔 주세요. 해당 계정으로 먼저 한 번 로그인해야 합니다.';
  end if;
  insert into public.great100_analytics_admins (user_id) values (admin_id)
    on conflict (user_id) do nothing;
end;
$$;
