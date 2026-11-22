begin;

-- pgTAP exists only in the isolated local test database. Do not run this file
-- in the hosted SQL editor.
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, auth;
select plan(12);

-- Synthetic users are created locally so the workspace foreign key remains
-- realistic without relying on unavailable tests.create_supabase_user helpers.
insert into auth.users (id, aud, role, email, raw_app_meta_data, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'owner@example.test', '{}'::jsonb, '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'other@example.test', '{}'::jsonb, '{}'::jsonb);

set local role anon;
select throws_ok($$ select * from public.planning_workspaces $$, '42501', null, 'anonymous read is denied by grants');
select throws_ok($$ insert into public.planning_workspaces(owner_id, workspace) values ('11111111-1111-1111-1111-111111111111', '{"schema_version":4}'::jsonb) $$, '42501', null, 'anonymous write is denied by grants');

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok($$ insert into public.planning_workspaces(owner_id, workspace) values ('11111111-1111-1111-1111-111111111111', '{"schema_version":4}'::jsonb) $$, 'owner may insert own workspace');
select results_eq($$ select count(*)::integer from public.planning_workspaces $$, array[1], 'owner reads own workspace');
select lives_ok($$ update public.planning_workspaces set version = 2 where owner_id = '11111111-1111-1111-1111-111111111111' $$, 'owner may update own workspace');
select throws_ok($$ update public.planning_workspaces set owner_id = '22222222-2222-2222-2222-222222222222' where owner_id = '11111111-1111-1111-1111-111111111111' $$, '42501', null, 'owner cannot reassign workspace ownership');

select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);
select throws_ok($$ insert into public.planning_workspaces(owner_id, workspace) values ('11111111-1111-1111-1111-111111111111', '{"schema_version":4}'::jsonb) $$, '42501', null, 'other user cannot insert owner workspace');
select results_eq($$ select count(*)::integer from public.planning_workspaces $$, array[0], 'other user cannot read owner workspace');
select results_eq($$ update public.planning_workspaces set version = 3 where owner_id = '11111111-1111-1111-1111-111111111111' returning version $$, array[]::integer[], 'other user cannot update owner workspace');
select results_eq($$ delete from public.planning_workspaces where owner_id = '11111111-1111-1111-1111-111111111111' returning 1 $$, array[]::integer[], 'other user cannot delete owner workspace');

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
select lives_ok($$ delete from public.planning_workspaces where owner_id = '11111111-1111-1111-1111-111111111111' $$, 'owner may delete own workspace');
select results_eq($$ select count(*)::integer from public.planning_workspaces $$, array[0], 'owner deletion is visible to owner');

select * from finish();
rollback;
