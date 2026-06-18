-- ============================================================================
-- Venakan Learn — Foundation schema (Prompt 1)
-- Tables: tenant, profile, invitation. Multi-tenant-READY: every row carries
-- tenant_id and RLS is enabled from day one. Seeds exactly one tenant: "Venakan".
-- ============================================================================

create extension if not exists "pgcrypto";

-- --- Enum --------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'trainer', 'trainee');
  end if;
  if not exists (select 1 from pg_type where typname = 'profile_status') then
    create type public.profile_status as enum ('invited', 'active', 'disabled');
  end if;
end$$;

-- --- Tables ------------------------------------------------------------------
create table if not exists public.tenant (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  plan        text not null default 'standard',
  created_at  timestamptz not null default now()
);

create table if not exists public.profile (
  id          uuid primary key references auth.users (id) on delete cascade,
  tenant_id   uuid not null references public.tenant (id) on delete restrict,
  full_name   text,
  email       text not null unique,
  role        public.app_role not null default 'trainee',
  status      public.profile_status not null default 'invited',
  created_at  timestamptz not null default now()
);
create index if not exists profile_tenant_id_idx on public.profile (tenant_id);

create table if not exists public.invitation (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id) on delete cascade,
  email       text not null,
  role        public.app_role not null,
  token       text not null unique,
  invited_by  uuid references public.profile (id) on delete set null,
  accepted_at timestamptz,
  expires_at  timestamptz not null default (now() + interval '7 days'),
  created_at  timestamptz not null default now()
);
create index if not exists invitation_tenant_id_idx on public.invitation (tenant_id);
create index if not exists invitation_email_idx on public.invitation (email);

-- --- Helper functions (SECURITY DEFINER to avoid RLS recursion) --------------
-- These read the caller's own profile bypassing RLS, so policies can reference
-- the caller's tenant/role without recursing into the profile policies.
create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profile where id = auth.uid();
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profile where id = auth.uid();
$$;

revoke all on function public.current_tenant_id() from public;
revoke all on function public.current_app_role() from public;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.current_app_role() to authenticated;

-- --- Row-Level Security ------------------------------------------------------
alter table public.tenant     enable row level security;
alter table public.profile    enable row level security;
alter table public.invitation enable row level security;

-- tenant: members may read their own tenant. No client writes (no tenant UI).
drop policy if exists tenant_select_member on public.tenant;
create policy tenant_select_member on public.tenant
  for select to authenticated
  using (id = public.current_tenant_id());

-- profile: a user can always read their OWN profile.
drop policy if exists profile_select_self on public.profile;
create policy profile_select_self on public.profile
  for select to authenticated
  using (id = auth.uid());

-- profile: admin + trainer can read all profiles within their tenant.
drop policy if exists profile_select_tenant_staff on public.profile;
create policy profile_select_tenant_staff on public.profile
  for select to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() in ('admin', 'trainer')
  );

-- profile: only admin can write profiles, and only within their tenant.
drop policy if exists profile_admin_insert on public.profile;
create policy profile_admin_insert on public.profile
  for insert to authenticated
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  );

drop policy if exists profile_admin_update on public.profile;
create policy profile_admin_update on public.profile
  for update to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  );

drop policy if exists profile_admin_delete on public.profile;
create policy profile_admin_delete on public.profile
  for delete to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  );

-- invitation: admin-only, scoped to the admin's tenant.
drop policy if exists invitation_admin_all on public.invitation;
create policy invitation_admin_all on public.invitation
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() = 'admin'
  );

-- NOTE: trainee read = "own profile only" (profile_select_self). Trainees match
-- no other SELECT policy, so they cannot see other rows. Trainers get tenant
-- read but no write. Server-side serverless functions use the service-role key
-- and bypass RLS entirely for provisioning.

-- --- Seed: exactly one tenant, "Venakan" -------------------------------------
insert into public.tenant (id, name, plan)
values ('11111111-1111-1111-1111-111111111111', 'Venakan', 'standard')
on conflict (id) do nothing;
