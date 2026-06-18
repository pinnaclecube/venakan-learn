-- ============================================================================
-- Venakan Learn — Generation Core (Prompt 2)
-- Role definitions, generated programs (modules + exercises), refinements.
-- Multi-tenant: every row carries tenant_id; RLS enabled. Staff (admin +
-- trainer) get full access within their tenant; trainees get NONE.
-- Depends on 0001_init.sql: enum app_role, table public.profile, and the
-- SECURITY DEFINER helpers public.current_tenant_id() / public.current_app_role().
-- ============================================================================

-- --- Enums -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'source_type') then
    create type public.source_type as enum ('jd_upload', 'prompt');
  end if;
  if not exists (select 1 from pg_type where typname = 'program_status') then
    create type public.program_status as enum ('draft', 'published');
  end if;
  if not exists (select 1 from pg_type where typname = 'gate_type') then
    create type public.gate_type as enum ('auto_pass', 'trainer_review', 'cross_track');
  end if;
  if not exists (select 1 from pg_type where typname = 'exercise_type') then
    create type public.exercise_type as enum ('code', 'rag', 'agent', 'judge');
  end if;
  if not exists (select 1 from pg_type where typname = 'refinement_target_kind') then
    create type public.refinement_target_kind as enum ('program', 'module', 'exercise', 'rubric');
  end if;
end$$;

-- --- Tables ------------------------------------------------------------------
create table if not exists public.role_definition (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id),
  title         text not null,
  family        text,
  stack         jsonb not null default '[]',
  skill_matrix  jsonb not null default '[]',
  milestones    jsonb not null default '[]',
  source_type   public.source_type not null,
  source_text   text,
  created_by    uuid references public.profile (id),
  created_at    timestamptz default now()
);
create index if not exists role_definition_tenant_id_idx on public.role_definition (tenant_id);

create table if not exists public.program (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant (id),
  role_definition_id uuid not null references public.role_definition (id) on delete cascade,
  week_count         int not null default 0,
  status             public.program_status not null default 'draft',
  version            int not null default 1,
  created_by         uuid references public.profile (id),
  created_at         timestamptz default now()
);
create index if not exists program_tenant_id_idx on public.program (tenant_id);
create index if not exists program_role_definition_id_idx on public.program (role_definition_id);

create table if not exists public.module (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id),
  program_id  uuid not null references public.program (id) on delete cascade,
  "order"     int not null default 0,
  title       text not null,
  objectives  jsonb not null default '[]',
  materials   text,
  gate_type   public.gate_type not null default 'trainer_review',
  created_at  timestamptz default now()
);
create index if not exists module_tenant_id_idx on public.module (tenant_id);
create index if not exists module_program_id_idx on public.module (program_id);

create table if not exists public.exercise (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenant (id),
  module_id      uuid not null references public.module (id) on delete cascade,
  type           public.exercise_type not null,
  prompt         text not null,
  rubric         jsonb not null default '{}',
  sandbox_config jsonb not null default '{}',
  created_at     timestamptz default now()
);
create index if not exists exercise_tenant_id_idx on public.exercise (tenant_id);
create index if not exists exercise_module_id_idx on public.exercise (module_id);

create table if not exists public.refinement (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id),
  program_id  uuid not null references public.program (id) on delete cascade,
  target_kind public.refinement_target_kind not null,
  target_id   uuid not null,
  prompt      text not null,
  diff        jsonb not null default '{}',
  author      uuid references public.profile (id),
  created_at  timestamptz default now()
);
create index if not exists refinement_tenant_id_idx on public.refinement (tenant_id);
create index if not exists refinement_program_id_idx on public.refinement (program_id);

-- --- Row-Level Security -------------------------------------------------------
alter table public.role_definition enable row level security;
alter table public.program         enable row level security;
alter table public.module          enable row level security;
alter table public.exercise        enable row level security;
alter table public.refinement      enable row level security;

-- Staff (admin + trainer) get full access within their tenant; trainees none.
drop policy if exists role_definition_staff_all on public.role_definition;
create policy role_definition_staff_all on public.role_definition
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists program_staff_all on public.program;
create policy program_staff_all on public.program
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists module_staff_all on public.module;
create policy module_staff_all on public.module
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists exercise_staff_all on public.exercise;
create policy exercise_staff_all on public.exercise
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists refinement_staff_all on public.refinement;
create policy refinement_staff_all on public.refinement
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

-- --- Storage: private bucket for JD uploads ----------------------------------
insert into storage.buckets (id, name, public)
values ('jd-uploads', 'jd-uploads', false)
on conflict (id) do nothing;

-- Storage policies: staff of the tenant may insert/select/delete objects in the
-- jd-uploads bucket. (Server functions use the service-role key and bypass RLS.)
drop policy if exists jd_uploads_staff_insert on storage.objects;
create policy jd_uploads_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'jd-uploads' and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists jd_uploads_staff_select on storage.objects;
create policy jd_uploads_staff_select on storage.objects
  for select to authenticated
  using (bucket_id = 'jd-uploads' and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists jd_uploads_staff_delete on storage.objects;
create policy jd_uploads_staff_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'jd-uploads' and public.current_app_role() in ('admin', 'trainer'));
