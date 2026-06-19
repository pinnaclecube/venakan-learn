-- ============================================================================
-- Venakan Learn — Publish & Assignment (Prompt 4)
-- ----------------------------------------------------------------------------
-- public.publish_and_assign() is the SINGLE transactional surface for going
-- live: it assigns trainers, enrols trainees, optionally unenrols explicitly
-- named trainees, and flips the program to 'published' — all in ONE
-- transaction. Any raise exception rolls EVERYTHING back, including the status
-- flip, so a program is never left published with a half-applied roster.
--
-- IDEMPOTENT on re-publish: program_trainer and enrollment both insert with
-- ON CONFLICT DO NOTHING, and the status update is itself idempotent — calling
-- it again with the same roster is a no-op (enrolled_new = 0).
--
-- DESTRUCTIVE deletes happen ONLY for profile ids explicitly passed in
-- p_unenroll_profile_ids. Removing an enrollment cascades to that enrollment's
-- submissions (ON DELETE CASCADE from 0003). Nothing is ever silently deleted —
-- the UI gates this list behind an explicit confirmation checkbox.
--
-- Multi-tenant: every row carries tenant_id; RLS enabled. Staff (admin +
-- trainer) get full access within their tenant.
--
-- Depends on:
--   * 0001_init.sql — public.profile, and the SECURITY DEFINER helpers
--     public.current_tenant_id() / public.current_app_role().
--   * 0002_generation.sql — public.program / public.module /
--     public.role_definition (role_definition.family => candidate.track).
--   * 0003_reporting.sql — public.candidate / public.enrollment /
--     public.submission.
-- ============================================================================

-- --- Table: program_trainer --------------------------------------------------
-- ANY assigned trainer can review ANY trainee for the program. This is a flat
-- many-to-many between programs and trainer/admin profiles — there is NO
-- per-trainee ownership and NO routing.
create table if not exists public.program_trainer (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenant (id),
  program_id         uuid not null references public.program (id) on delete cascade,
  trainer_profile_id uuid not null references public.profile (id) on delete cascade,
  assigned_by        uuid references public.profile (id),
  created_at         timestamptz default now(),
  unique (program_id, trainer_profile_id)
);
create index if not exists program_trainer_program_id_idx
  on public.program_trainer (program_id);
create index if not exists program_trainer_trainer_profile_id_idx
  on public.program_trainer (trainer_profile_id);

alter table public.program_trainer enable row level security;

drop policy if exists program_trainer_staff_all on public.program_trainer;
create policy program_trainer_staff_all on public.program_trainer
  for all to authenticated
  using (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() in ('admin', 'trainer')
  )
  with check (
    tenant_id = public.current_tenant_id()
    and public.current_app_role() in ('admin', 'trainer')
  );

-- --- Idempotency constraint on enrollment (guarded) --------------------------
-- Enables the ON CONFLICT (candidate_id, program_id) DO NOTHING upsert below so
-- re-publishing never double-enrols a trainee.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'enrollment_candidate_program_uniq'
  ) then
    alter table public.enrollment
      add constraint enrollment_candidate_program_uniq unique (candidate_id, program_id);
  end if;
end $$;

-- --- RPC: publish_and_assign -------------------------------------------------
create or replace function public.publish_and_assign(
  p_program_id          uuid,
  p_trainer_profile_ids uuid[],
  p_trainee_profile_ids uuid[],
  p_unenroll_profile_ids uuid[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.app_role;
  v_status      public.profile_status;
  v_tenant      uuid;
  v_program_ten uuid;
  v_first_order int;
  v_track       text;
  v_bad_count   int;
  v_trainers    int;
  v_enrolled    int := 0;
  v_skipped     int := 0;
  v_unenrolled  int := 0;
  v_inserted    int;
  pid           uuid;
begin
  -- 1) Resolve the caller and gate on active staff.
  select role, status, tenant_id
    into v_role, v_status, v_tenant
  from public.profile
  where id = auth.uid();

  if v_role is null or v_role not in ('admin', 'trainer') or v_status <> 'active' then
    raise exception 'Staff access required.';
  end if;

  -- 2) Load the program and confirm it is in the caller's tenant.
  select tenant_id into v_program_ten
  from public.program
  where id = p_program_id;

  if v_program_ten is null or v_program_ten <> v_tenant then
    raise exception 'Program not found in your tenant.';
  end if;

  -- 3) First module order (default 0 when the program has no modules yet).
  v_first_order := coalesce(
    (select min("order") from public.module where program_id = p_program_id),
    0
  );

  -- 4) Track = the role family driving this program.
  v_track := (
    select rd.family
    from public.program p
    join public.role_definition rd on rd.id = p.role_definition_id
    where p.id = p_program_id
  );

  -- 5) At least one trainer must end up assigned.
  if cardinality(coalesce(p_trainer_profile_ids, '{}')) = 0
     and not exists (
       select 1 from public.program_trainer where program_id = p_program_id
     ) then
    raise exception 'At least one trainer must be assigned.';
  end if;

  -- 6) Validate + insert trainers. Every provided id must be an active
  --    admin/trainer in this tenant.
  if cardinality(coalesce(p_trainer_profile_ids, '{}')) > 0 then
    select count(*) into v_bad_count
    from unnest(p_trainer_profile_ids) t
    where not exists (
      select 1 from public.profile pr
      where pr.id = t
        and pr.tenant_id = v_tenant
        and pr.status = 'active'
        and pr.role in ('admin', 'trainer')
    );
    if v_bad_count > 0 then
      raise exception 'One or more trainers are not active staff in your tenant.';
    end if;

    insert into public.program_trainer (tenant_id, program_id, trainer_profile_id, assigned_by)
    select v_tenant, p_program_id, t, auth.uid()
    from unnest(p_trainer_profile_ids) t
    on conflict (program_id, trainer_profile_id) do nothing;
  end if;

  -- 7) Validate + enrol trainees. Every provided id must be an active trainee
  --    in this tenant.
  if cardinality(coalesce(p_trainee_profile_ids, '{}')) > 0 then
    select count(*) into v_bad_count
    from unnest(p_trainee_profile_ids) t
    where not exists (
      select 1 from public.profile pr
      where pr.id = t
        and pr.tenant_id = v_tenant
        and pr.status = 'active'
        and pr.role = 'trainee'
    );
    if v_bad_count > 0 then
      raise exception 'One or more trainees are not active trainees in your tenant.';
    end if;

    foreach pid in array p_trainee_profile_ids loop
      -- Ensure a candidate row exists (idempotent on profile_id).
      insert into public.candidate (tenant_id, profile_id, track)
      values (v_tenant, pid, v_track)
      on conflict (profile_id) do nothing;

      -- Enrol (idempotent on candidate_id, program_id). Count new vs existing.
      with ins as (
        insert into public.enrollment
          (tenant_id, candidate_id, program_id, current_module_order, status)
        select v_tenant, c.id, p_program_id, v_first_order, 'not_started'
        from public.candidate c
        where c.profile_id = pid
        on conflict (candidate_id, program_id) do nothing
        returning 1
      )
      select count(*) into v_inserted from ins;

      if v_inserted > 0 then
        v_enrolled := v_enrolled + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
    end loop;
  end if;

  -- 8) Explicit unenroll — ONLY for ids in p_unenroll_profile_ids. Cascade
  --    removes those enrollments' submissions; this is intentional and never
  --    happens for any id not explicitly listed here.
  if cardinality(coalesce(p_unenroll_profile_ids, '{}')) > 0 then
    foreach pid in array p_unenroll_profile_ids loop
      with del as (
        delete from public.enrollment
        where program_id = p_program_id
          and candidate_id in (
            select id from public.candidate where profile_id = pid
          )
        returning 1
      )
      select count(*) into v_inserted from del;
      v_unenrolled := v_unenrolled + v_inserted;
    end loop;
  end if;

  -- 9) Flip to published (idempotent).
  update public.program set status = 'published' where id = p_program_id;

  -- 10) Report.
  select count(*) into v_trainers
  from public.program_trainer
  where program_id = p_program_id;

  return jsonb_build_object(
    'published', true,
    'trainers_assigned', v_trainers,
    'enrolled_new', v_enrolled,
    'skipped_existing', v_skipped,
    'unenrolled', v_unenrolled
  );
end;
$$;

revoke all on function public.publish_and_assign(uuid, uuid[], uuid[], uuid[]) from public;
grant execute on function public.publish_and_assign(uuid, uuid[], uuid[], uuid[]) to authenticated;
