-- ============================================================================
-- Venakan Learn — Learner Runtime + Rich Content (Prompt 5)
-- ----------------------------------------------------------------------------
-- Adds the rich-lesson column to public.module and the SECURITY DEFINER RPCs
-- that are the trainee's ONLY read/write path into the generation tables
-- (module / exercise / program). RLS on those tables stays STAFF-ONLY (0002) —
-- trainees never read them directly; every trainee read/write is funneled
-- through the tightly-scoped functions below.
--
-- Depends on:
--   * 0001_init.sql — public.profile, public.tenant, and the SECURITY DEFINER
--     helpers public.current_tenant_id() / public.current_app_role().
--   * 0002_generation.sql — public.program (status), public.module
--     ("order", objectives, lesson, gate_type), public.exercise (type, prompt,
--     rubric), public.role_definition (title).
--   * 0003_reporting.sql — public.candidate (profile_id unique),
--     public.enrollment, public.submission, enums enrollment_status / gate_status.
--   * 0004_publish_assignment.sql — public.program_trainer (assignment check).
--
-- AUTO-GRADE BOUNDARY: AUTO_GRADE_ENABLED is hardcoded FALSE in this prompt.
-- Prompt 6 flips it on (real code/RAG/agent/judge auto-grading). Until then the
-- gate logic below is conservative: only non-code auto_pass exercises advance.
-- ============================================================================

-- --- A1. Rich lesson content column -----------------------------------------
alter table public.module
  add column if not exists lesson jsonb not null default '[]'::jsonb;

-- ============================================================================
-- RPC: my_enrolled_programs() — list the caller's published enrollments.
-- ============================================================================
create or replace function public.my_enrolled_programs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate uuid;
  v_result    jsonb;
begin
  select id into v_candidate
  from public.candidate
  where profile_id = auth.uid();

  if v_candidate is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'program_id', e.program_id,
        'title', coalesce(rd.title, 'Program'),
        'week_count', p.week_count,
        'status', e.status,
        'current_module_order', e.current_module_order,
        'total_modules', coalesce(mc.cnt, 0)
      )
      order by e.created_at desc
    ),
    '[]'::jsonb
  )
  into v_result
  from public.enrollment e
  join public.program p on p.id = e.program_id
  left join public.role_definition rd on rd.id = p.role_definition_id
  left join (
    select program_id, count(*)::int as cnt
    from public.module
    group by program_id
  ) mc on mc.program_id = e.program_id
  where e.candidate_id = v_candidate
    and p.status = 'published';

  return v_result;
end;
$$;

revoke all on function public.my_enrolled_programs() from public;
grant execute on function public.my_enrolled_programs() to authenticated;

-- ============================================================================
-- RPC: get_trainee_program(p_program_id) — full runtime payload for ONE
-- program the caller is enrolled in. Returns { enrolled:false } otherwise.
-- Submissions are scoped to the caller's own enrollment (full history).
-- ============================================================================
create or replace function public.get_trainee_program(p_program_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate    uuid;
  v_enrollment   public.enrollment%rowtype;
  v_program      jsonb;
  v_modules      jsonb;
  v_submissions  jsonb;
begin
  select id into v_candidate
  from public.candidate
  where profile_id = auth.uid();

  if v_candidate is null then
    return jsonb_build_object('enrolled', false);
  end if;

  -- Caller MUST be enrolled in this exact program.
  select * into v_enrollment
  from public.enrollment
  where candidate_id = v_candidate and program_id = p_program_id;

  if v_enrollment.id is null then
    return jsonb_build_object('enrolled', false);
  end if;

  -- Program header.
  select jsonb_build_object(
           'id', p.id,
           'title', coalesce(rd.title, 'Program'),
           'week_count', p.week_count,
           'status', p.status
         )
  into v_program
  from public.program p
  left join public.role_definition rd on rd.id = p.role_definition_id
  where p.id = p_program_id;

  -- Modules (ordered) with their exercises.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'order', m."order",
        'title', m.title,
        'objectives', m.objectives,
        'lesson', m.lesson,
        'gate_type', m.gate_type,
        'exercises', coalesce(ex.exercises, '[]'::jsonb)
      )
      order by m."order"
    ),
    '[]'::jsonb
  )
  into v_modules
  from public.module m
  left join (
    select e.module_id,
           jsonb_agg(
             jsonb_build_object(
               'id', e.id,
               'type', e.type,
               'prompt', e.prompt,
               'rubric', e.rubric
             )
             order by e.created_at
           ) as exercises
    from public.exercise e
    group by e.module_id
  ) ex on ex.module_id = m.id
  where m.program_id = p_program_id;

  -- Caller's own submissions for this enrollment (full history).
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'exercise_id', s.exercise_id,
        'module_id', s.module_id,
        'gate_status', s.gate_status,
        'trainer_grade', s.trainer_grade,
        'ai_grade', s.ai_grade,
        'artifact', s.artifact,
        'submitted_at', s.submitted_at,
        'reviewed_at', s.reviewed_at
      )
      order by s.submitted_at
    ),
    '[]'::jsonb
  )
  into v_submissions
  from public.submission s
  where s.enrollment_id = v_enrollment.id;

  return jsonb_build_object(
    'enrolled', true,
    'program', v_program,
    'enrollment', jsonb_build_object(
      'current_module_order', v_enrollment.current_module_order,
      'status', v_enrollment.status,
      'started_at', v_enrollment.started_at,
      'completed_at', v_enrollment.completed_at
    ),
    'modules', v_modules,
    'my_submissions', v_submissions
  );
end;
$$;

revoke all on function public.get_trainee_program(uuid) from public;
grant execute on function public.get_trainee_program(uuid) to authenticated;

-- ============================================================================
-- RPC: submit_exercise(p_exercise_id, p_artifact) — the trainee's only write
-- path. Insert-only (NEVER updates a prior submission — history is preserved;
-- resubmission appends a new row). Enforces module lock + gate progression.
-- ============================================================================
create or replace function public.submit_exercise(
  p_exercise_id uuid,
  p_artifact    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- AUTO_GRADE_ENABLED: false for Prompt 5. Prompt 6 flips this to true and
  -- wires in real auto-grading for code/rag/agent/judge exercises.
  c_auto_grade_enabled constant boolean := false;

  v_candidate     uuid;
  v_tenant        uuid;
  v_module_id     uuid;
  v_module_order  int;
  v_gate_type     public.gate_type;
  v_program_id    uuid;
  v_ex_type       public.exercise_type;
  v_enrollment    public.enrollment%rowtype;
  v_max_order     int;
  v_submission_id uuid;
  v_gate_status   public.gate_status;
  v_new_status    public.enrollment_status;
  v_advanced      boolean := false;
  v_ai_grade      jsonb := '{}'::jsonb;
  v_note          text := null;
begin
  select id into v_candidate
  from public.candidate
  where profile_id = auth.uid();
  if v_candidate is null then
    raise exception 'Not enrolled in this program.';
  end if;

  -- Resolve the exercise's module + program + gate type + type.
  select e.module_id, e.type, m."order", m.gate_type, m.program_id, m.tenant_id
    into v_module_id, v_ex_type, v_module_order, v_gate_type, v_program_id, v_tenant
  from public.exercise e
  join public.module m on m.id = e.module_id
  where e.id = p_exercise_id;

  if v_module_id is null then
    raise exception 'Exercise not found.';
  end if;

  -- Find the caller's enrollment for that program.
  select * into v_enrollment
  from public.enrollment
  where candidate_id = v_candidate and program_id = v_program_id;

  if v_enrollment.id is null then
    raise exception 'Not enrolled in this program.';
  end if;

  -- Module-lock guard: only the current module may be submitted to.
  if v_module_order <> v_enrollment.current_module_order then
    raise exception 'This module is locked.';
  end if;

  -- Status guard.
  if v_enrollment.status = 'awaiting_review' then
    raise exception 'This module is awaiting review.';
  elsif v_enrollment.status = 'completed' then
    raise exception 'This program is already completed.';
  elsif v_enrollment.status not in ('not_started', 'in_progress') then
    raise exception 'This module is locked.';
  end if;

  -- Stamp started_at + bump not_started -> in_progress.
  if v_enrollment.started_at is null then
    update public.enrollment
      set started_at = now()
      where id = v_enrollment.id;
  end if;
  if v_enrollment.status = 'not_started' then
    update public.enrollment
      set status = 'in_progress'
      where id = v_enrollment.id;
    v_enrollment.status := 'in_progress';
  end if;

  -- Determine the gate outcome (AUTO_GRADE_ENABLED is false here).
  v_max_order := (
    select max("order") from public.module where program_id = v_program_id
  );

  if v_gate_type = 'trainer_review' then
    v_gate_status := 'pending';
    v_new_status  := 'awaiting_review';
    v_note := 'awaiting trainer review';
  elsif v_gate_type = 'cross_track' then
    v_gate_status := 'pending';
    v_ai_grade := jsonb_build_object('note', 'awaiting cross-track evaluation (Prompt 6)');
    v_new_status := 'in_progress';
    v_note := 'awaiting cross-track evaluation (Prompt 6)';
  else
    -- auto_pass
    if v_ex_type = 'code' then
      -- Real grading lands in Prompt 6; for now do not advance.
      v_gate_status := 'pending';
      v_ai_grade := jsonb_build_object('note', 'awaiting auto-grade (Prompt 6)');
      v_new_status := 'in_progress';
      v_note := 'awaiting auto-grade (Prompt 6)';
    else
      -- Non-code auto_pass (rag/agent/judge): provisional pass + advance.
      v_gate_status := 'passed';
      v_advanced := true;
    end if;
  end if;

  -- Insert a NEW submission row (insert-only; never mutate prior rows).
  insert into public.submission
    (tenant_id, enrollment_id, exercise_id, module_id, artifact, ai_grade, gate_status)
  values
    (v_tenant, v_enrollment.id, p_exercise_id, v_module_id, p_artifact, v_ai_grade, v_gate_status)
  returning id into v_submission_id;

  -- Apply enrollment transition.
  if v_advanced then
    if v_module_order >= v_max_order then
      update public.enrollment
        set current_module_order = current_module_order + 1,
            status = 'completed',
            completed_at = now()
        where id = v_enrollment.id
        returning status into v_new_status;
    else
      update public.enrollment
        set current_module_order = current_module_order + 1,
            status = 'in_progress'
        where id = v_enrollment.id
        returning status into v_new_status;
    end if;
  else
    update public.enrollment
      set status = v_new_status
      where id = v_enrollment.id;
  end if;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'gate_status', v_gate_status,
    'advanced', v_advanced,
    'enrollment_status', v_new_status,
    'note', v_note
  );
end;
$$;

revoke all on function public.submit_exercise(uuid, text) from public;
grant execute on function public.submit_exercise(uuid, text) to authenticated;

-- ============================================================================
-- RPC: review_submission(p_submission_id, p_decision, p_trainer_grade) —
-- the HUMAN trainer-review path (no auto-grading). One transaction.
-- ============================================================================
create or replace function public.review_submission(
  p_submission_id uuid,
  p_decision      text,
  p_trainer_grade jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role         public.app_role;
  v_status       public.profile_status;
  v_tenant       uuid;
  v_submission   public.submission%rowtype;
  v_enrollment   public.enrollment%rowtype;
  v_program_id   uuid;
  v_gate_type    public.gate_type;
  v_module_order int;
  v_max_order    int;
  v_advanced     boolean := false;
  v_new_status   public.enrollment_status;
begin
  if p_decision not in ('passed', 'failed') then
    raise exception 'Decision must be passed or failed.';
  end if;

  -- Caller must be active staff in their tenant.
  select role, status, tenant_id
    into v_role, v_status, v_tenant
  from public.profile
  where id = auth.uid();

  if v_role is null or v_status <> 'active' or v_role not in ('admin', 'trainer') then
    raise exception 'Not authorized to review this submission.';
  end if;

  -- Load submission -> enrollment -> module/program.
  select * into v_submission
  from public.submission
  where id = p_submission_id;
  if v_submission.id is null then
    raise exception 'Submission not found.';
  end if;

  select * into v_enrollment
  from public.enrollment
  where id = v_submission.enrollment_id;
  if v_enrollment.id is null then
    raise exception 'Submission not found.';
  end if;

  v_program_id := v_enrollment.program_id;

  -- Authorization: admin in tenant, OR trainer assigned to this program.
  if v_role = 'admin' then
    if v_enrollment.tenant_id <> v_tenant then
      raise exception 'Not authorized to review this submission.';
    end if;
  else
    if not exists (
      select 1 from public.program_trainer pt
      where pt.program_id = v_program_id
        and pt.trainer_profile_id = auth.uid()
    ) then
      raise exception 'Not authorized to review this submission.';
    end if;
  end if;

  -- Module + gate type. Only trainer_review modules go through this path.
  select m."order", m.gate_type
    into v_module_order, v_gate_type
  from public.module m
  where m.id = v_submission.module_id;

  if v_gate_type is distinct from 'trainer_review' then
    raise exception 'This submission is not a trainer-review gate.';
  end if;

  -- Record the decision (history preserved — we update THIS submission only).
  update public.submission
    set trainer_grade = coalesce(p_trainer_grade, '{}'::jsonb),
        gate_status   = p_decision::public.gate_status,
        reviewed_at   = now()
    where id = p_submission_id;

  if p_decision = 'passed' then
    v_max_order := (
      select max("order") from public.module where program_id = v_program_id
    );
    v_advanced := true;
    if v_module_order >= v_max_order then
      update public.enrollment
        set current_module_order = current_module_order + 1,
            status = 'completed',
            completed_at = now()
        where id = v_enrollment.id
        returning status into v_new_status;
    else
      update public.enrollment
        set current_module_order = current_module_order + 1,
            status = 'in_progress'
        where id = v_enrollment.id
        returning status into v_new_status;
    end if;
  else
    -- Failed: allow resubmission. Keep current_module_order; prior submissions
    -- are left intact (insert-only history).
    update public.enrollment
      set status = 'in_progress'
      where id = v_enrollment.id
      returning status into v_new_status;
  end if;

  return jsonb_build_object(
    'submission_id', p_submission_id,
    'decision', p_decision,
    'advanced', v_advanced,
    'enrollment_status', v_new_status
  );
end;
$$;

revoke all on function public.review_submission(uuid, text, jsonb) from public;
grant execute on function public.review_submission(uuid, text, jsonb) to authenticated;
