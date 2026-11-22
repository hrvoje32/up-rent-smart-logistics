-- One private, versioned JSONB workspace per authenticated demo user.
create table public.planning_workspaces (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 1 check (version > 0),
  workspace jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.planning_workspaces enable row level security;

revoke all on table public.planning_workspaces from anon;
revoke all on table public.planning_workspaces from authenticated;
grant select, insert, update, delete on table public.planning_workspaces to authenticated;

create policy "workspace_select_own"
on public.planning_workspaces for select to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "workspace_insert_own"
on public.planning_workspaces for insert to authenticated
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "workspace_update_own"
on public.planning_workspaces for update to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()))
with check ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create policy "workspace_delete_own"
on public.planning_workspaces for delete to authenticated
using ((select auth.uid()) is not null and owner_id = (select auth.uid()));

create or replace function public.set_planning_workspace_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger planning_workspaces_updated_at
before update on public.planning_workspaces
for each row execute function public.set_planning_workspace_updated_at();
