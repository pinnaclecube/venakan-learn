-- ============================================================================
-- Venakan Learn — Reporting (Prompt 3)
-- Candidates, enrollments, submissions + the anonymized cohort-standing RPC.
-- Multi-tenant: every row carries tenant_id; RLS enabled. Staff (admin +
-- trainer) get full access within their tenant; trainees get SELECT on their
-- OWN rows only.
-- Depends on:
--   * 0001_init.sql — table public.profile, and the SECURITY DEFINER helpers
--     public.current_tenant_id() / public.current_app_role().
--   * 0002_generation.sql — tables public.program / public.module /
--     public.exercise (referenced by enrollment + submission).
-- ============================================================================

-- --- Enums -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'enrollment_status') then
    create type public.enrollment_status as enum (
      'not_started', 'in_progress', 'awaiting_review', 'completed'
    );
  end if;
  if not exists (select 1 from pg_type where typname = 'gate_status') then
    create type public.gate_status as enum ('pending', 'passed', 'failed');
  end if;
end$$;

-- --- Tables ------------------------------------------------------------------
create table if not exists public.candidate (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenant (id),
  profile_id  uuid not null references public.profile (id) on delete cascade,
  track       text,
  created_at  timestamptz default now(),
  unique (profile_id)
);
create index if not exists candidate_tenant_id_idx on public.candidate (tenant_id);
create index if not exists candidate_profile_id_idx on public.candidate (profile_id);

create table if not exists public.enrollment (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenant (id),
  candidate_id         uuid not null references public.candidate (id) on delete cascade,
  program_id           uuid not null references public.program (id) on delete cascade,
  current_module_order int not null default 0,
  status               public.enrollment_status not null default 'not_started',
  started_at           timestamptz,
  completed_at         timestamptz,
  created_at           timestamptz default now()
);
create index if not exists enrollment_tenant_id_idx on public.enrollment (tenant_id);
create index if not exists enrollment_candidate_id_idx on public.enrollment (candidate_id);
create index if not exists enrollment_program_id_idx on public.enrollment (program_id);

create table if not exists public.submission (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenant (id),
  enrollment_id uuid not null references public.enrollment (id) on delete cascade,
  exercise_id   uuid references public.exercise (id) on delete set null,
  module_id     uuid references public.module (id) on delete set null,
  artifact      text,
  ai_grade      jsonb not null default '{}',
  trainer_grade jsonb not null default '{}',
  gate_status   public.gate_status not null default 'pending',
  submitted_at  timestamptz default now(),
  reviewed_at   timestamptz
);
create index if not exists submission_tenant_id_idx on public.submission (tenant_id);
create index if not exists submission_enrollment_id_idx on public.submission (enrollment_id);
create index if not exists submission_exercise_id_idx on public.submission (exercise_id);
create index if not exists submission_module_id_idx on public.submission (module_id);

-- --- Row-Level Security -------------------------------------------------------
alter table public.candidate  enable row level security;
alter table public.enrollment enable row level security;
alter table public.submission enable row level security;

-- candidate: staff full access in tenant; trainee SELECT own.
drop policy if exists candidate_staff_all on public.candidate;
create policy candidate_staff_all on public.candidate
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists candidate_select_own on public.candidate;
create policy candidate_select_own on public.candidate
  for select to authenticated
  using (profile_id = auth.uid());

-- enrollment: staff read+write in tenant; trainee SELECT own.
drop policy if exists enrollment_staff_all on public.enrollment;
create policy enrollment_staff_all on public.enrollment
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists enrollment_select_own on public.enrollment;
create policy enrollment_select_own on public.enrollment
  for select to authenticated
  using (
    candidate_id in (select id from public.candidate where profile_id = auth.uid())
  );

-- submission: staff read+write in tenant; trainee SELECT own.
drop policy if exists submission_staff_all on public.submission;
create policy submission_staff_all on public.submission
  for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'))
  with check (tenant_id = public.current_tenant_id() and public.current_app_role() in ('admin', 'trainer'));

drop policy if exists submission_select_own on public.submission;
create policy submission_select_own on public.submission
  for select to authenticated
  using (
    enrollment_id in (
      select e.id
      from public.enrollment e
      join public.candidate c on c.id = e.candidate_id
      where c.profile_id = auth.uid()
    )
  );

-- ============================================================================
-- ANONYMIZED RANKING SURFACE — public.my_cohort_standing
-- ----------------------------------------------------------------------------
-- This is the ONLY surface through which a trainee learns their standing
-- relative to their cohort. It is SECURITY DEFINER so it can read OTHER
-- candidates' submissions in order to compute aggregates, but it MUST NEVER
-- expose any other trainee's identity or individual score. The returned JSON
-- contains ONLY: counts/aggregates (cohort size, score histogram buckets) and
-- the CALLER's OWN numbers (their score, rank, percentile, bucket).
-- NO candidate_id, profile_id, full_name, email, or per-other-trainee score
-- may ever appear in the output. Do not add any column that identifies others.
-- ============================================================================
create or replace function public.my_cohort_standing(p_program_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate   uuid;
  v_program     uuid;
  v_cohort_size int;
  v_my_score    int;
  v_my_rank     int;
  v_max_score   int;
  v_bucket_size numeric;
  v_my_bucket   int;
  v_percentile  numeric;
  v_distribution jsonb;
begin
  -- Resolve caller's candidate row.
  select id into v_candidate
  from public.candidate
  where profile_id = auth.uid();

  if v_candidate is null then
    return jsonb_build_object('enrolled', false);
  end if;

  -- Determine the program: honour p_program_id only if the caller is enrolled
  -- in it; otherwise fall back to the caller's most recent enrollment.
  if p_program_id is not null then
    select e.program_id into v_program
    from public.enrollment e
    where e.candidate_id = v_candidate and e.program_id = p_program_id
    limit 1;
  end if;

  if v_program is null then
    select e.program_id into v_program
    from public.enrollment e
    where e.candidate_id = v_candidate
    order by coalesce(e.started_at, e.created_at) desc
    limit 1;
  end if;

  if v_program is null then
    return jsonb_build_object('enrolled', false);
  end if;

  -- Per-candidate score within the program: count of passed submissions.
  -- Left join so candidates with zero submissions score 0. We materialise the
  -- per-candidate scores in a CTE but NEVER select candidate identities out of
  -- it — only the caller's own score and pure aggregates leave this function.
  with scores as (
    select e.candidate_id,
           count(s.id) filter (where s.gate_status = 'passed') as score
    from public.enrollment e
    left join public.submission s on s.enrollment_id = e.id
    where e.program_id = v_program
    group by e.candidate_id
  )
  select
    (select count(*) from scores),
    (select coalesce(score, 0) from scores where candidate_id = v_candidate),
    (select coalesce(max(score), 0) from scores)
  into v_cohort_size, v_my_score, v_max_score;

  -- Dense rank of the caller (1 = best). Compare on score only; ties share rank.
  select count(distinct score) + 1
  into v_my_rank
  from (
    select e.candidate_id,
           count(s.id) filter (where s.gate_status = 'passed') as score
    from public.enrollment e
    left join public.submission s on s.enrollment_id = e.id
    where e.program_id = v_program
    group by e.candidate_id
  ) ranked
  where score > v_my_score;

  -- Percentile (top X%). 1 = best => smallest percentage.
  if v_cohort_size > 0 then
    v_percentile := round((v_my_rank::numeric / v_cohort_size::numeric) * 100);
  else
    v_percentile := 100;
  end if;

  -- Histogram of scores into up to 10 buckets by score value (counts only).
  -- Bucket index 0..N where N = least(max_score, 9). A score s maps to
  -- bucket least(s, 9) when max_score <= 9, otherwise to a proportional bin.
  if v_max_score <= 0 then
    -- Everyone has score 0: a single bucket.
    v_bucket_size := 1;
  else
    v_bucket_size := greatest(1, ceil((v_max_score + 1)::numeric / 10));
  end if;

  v_my_bucket := least(9, floor(v_my_score / v_bucket_size))::int;

  -- Build the distribution histogram over the full bucket range 0..top_bucket
  -- (extended to include the caller's own bucket if higher). Counts only.
  with scores as (
    select e.candidate_id,
           count(s.id) filter (where s.gate_status = 'passed') as score
    from public.enrollment e
    left join public.submission s on s.enrollment_id = e.id
    where e.program_id = v_program
    group by e.candidate_id
  ),
  bucketed as (
    select least(9, floor(score / v_bucket_size))::int as bucket
    from scores
  ),
  counts as (
    select bucket, count(*)::int as cnt from bucketed group by bucket
  ),
  top as (
    select coalesce(max(bucket), 0) as top_bucket from bucketed
  )
  select jsonb_agg(
           jsonb_build_object(
             'bucket', b.bucket,
             'label',
               case
                 when v_bucket_size = 1 then b.bucket::text
                 else (b.bucket * v_bucket_size)::int::text || '–'
                      || ((b.bucket + 1) * v_bucket_size - 1)::int::text
               end,
             'count', coalesce(c.cnt, 0)
           )
           order by b.bucket
         )
  into v_distribution
  from top, generate_series(0, greatest(top.top_bucket, v_my_bucket)) b(bucket)
  left join counts c on c.bucket = b.bucket;

  return jsonb_build_object(
    'enrolled', true,
    'program_id', v_program,
    'cohort_size', v_cohort_size,
    'my_score', v_my_score,
    'my_rank', v_my_rank,
    'percentile_top', v_percentile,
    'distribution', coalesce(v_distribution, '[]'::jsonb),
    'my_bucket', v_my_bucket
  );
end;
$$;

revoke all on function public.my_cohort_standing(uuid) from public;
grant execute on function public.my_cohort_standing(uuid) to authenticated;
