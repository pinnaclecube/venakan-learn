-- ============================================================================
-- Venakan Learn — Code Execution, Grading & Review (Prompt 6)
-- ----------------------------------------------------------------------------
-- Closes the self-advance bypass from Prompt 5 and introduces real grading.
--
-- Depends on:
--   * 0001_init.sql — public.profile, public.candidate helpers.
--   * 0002_generation.sql — public.program / module (gate_type, "order") /
--     exercise (type, prompt, rubric, sandbox_config).
--   * 0003_reporting.sql — public.enrollment / submission, enums
--     enrollment_status / gate_status.
--   * 0004_publish_assignment.sql — public.program_trainer.
--   * 0005_learner_runtime.sql — submit_exercise / review_submission (this file
--     REPLACES submit_exercise so it can never auto-advance).
--
-- AUTO-GRADE BOUNDARY: AUTO_GRADE_ENABLED is now TRUE (client + server). Real
-- grading runs server-side in /api/submit-and-grade via service-role-only RPCs.
--
-- GATE SEMANTICS (authoritative reference):
--   * auto_pass      -> may advance on the AI grade alone (graded + passed).
--   * trainer_review -> AI grade is ADVISORY only; a trainer's review_submission
--                       decision is authoritative; enrollment -> awaiting_review.
--   * cross_track    -> AI grade is ADVISORY only; always routes to a trainer;
--                       enrollment -> awaiting_review.
--   * error / needs_manual_review (any gate) -> route to manual review; never
--                       auto pass/fail.
--
-- Advancement happens ONLY via the service-role apply_grading_result (auto_pass)
-- or via review_submission (human). submit_exercise / start_grading_submission
-- only QUEUE. Submissions are insert-only — re-grades / resubmissions append.
-- ============================================================================

-- ============================================================================
-- RPC: submit_exercise(p_exercise_id, p_artifact) — REPLACES the Prompt 5
-- version. It NEVER auto-advances now: every submission is queued with
-- gate_status='pending' and ai_grade={"status":"queued"}, enrollment in_progress
-- (or awaiting_review for trainer_review). Real advancement is done elsewhere.
-- Kept `grant execute to authenticated` (harmless — it only queues).
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
  v_candidate     uuid;
  v_tenant        uuid;
  v_module_id     uuid;
  v_module_order  int;
  v_gate_type     public.gate_type;
  v_program_id    uuid;
  v_enrollment    public.enrollment%rowtype;
  v_submission_id uuid;
  v_new_status    public.enrollment_status;
begin
  select id into v_candidate
  from public.candidate
  where profile_id = auth.uid();
  if v_candidate is null then
    raise exception 'Not enrolled in this program.';
  end if;

  -- Resolve the exercise's module + program + gate type.
  select e.module_id, m."order", m.gate_type, m.program_id, m.tenant_id
    into v_module_id, v_module_order, v_gate_type, v_program_id, v_tenant
  from public.exercise e
  join public.module m on m.id = e.module_id
  where e.id = p_exercise_id;

  if v_module_id is null then
    raise exception 'Exercise not found.';
  end if;

  select * into v_enrollment
  from public.enrollment
  where candidate_id = v_candidate and program_id = v_program_id;
  if v_enrollment.id is null then
    raise exception 'Not enrolled in this program.';
  end if;

  -- Same guards as before: module must be current; not awaiting/completed.
  if v_module_order <> v_enrollment.current_module_order then
    raise exception 'This module is locked.';
  end if;
  if v_enrollment.status = 'awaiting_review' then
    raise exception 'This module is awaiting review.';
  elsif v_enrollment.status = 'completed' then
    raise exception 'This program is already completed.';
  elsif v_enrollment.status not in ('not_started', 'in_progress') then
    raise exception 'This module is locked.';
  end if;

  -- Stamp started_at + bump not_started -> in_progress.
  if v_enrollment.started_at is null then
    update public.enrollment set started_at = now() where id = v_enrollment.id;
  end if;
  if v_enrollment.status = 'not_started' then
    update public.enrollment set status = 'in_progress' where id = v_enrollment.id;
  end if;

  -- Queue ONLY. Never advance. ai_grade marks the submission as queued.
  insert into public.submission
    (tenant_id, enrollment_id, exercise_id, module_id, artifact, ai_grade, gate_status)
  values
    (v_tenant, v_enrollment.id, p_exercise_id, v_module_id, p_artifact,
     jsonb_build_object('status', 'queued'), 'pending')
  returning id into v_submission_id;

  -- trainer_review goes straight to awaiting_review; everything else stays
  -- in_progress until graded.
  if v_gate_type = 'trainer_review' then
    update public.enrollment set status = 'awaiting_review'
      where id = v_enrollment.id
      returning status into v_new_status;
  else
    update public.enrollment set status = 'in_progress'
      where id = v_enrollment.id
      returning status into v_new_status;
  end if;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'gate_status', 'pending',
    'advanced', false,
    'enrollment_status', v_new_status,
    'note', 'queued'
  );
end;
$$;

revoke all on function public.submit_exercise(uuid, text) from public;
grant execute on function public.submit_exercise(uuid, text) to authenticated;

-- ============================================================================
-- RPC: start_grading_submission(p_profile_id, p_exercise_id, p_artifact)
-- SERVICE-ROLE ONLY. Called by /api/submit-and-grade after it has verified the
-- caller. Resolves the candidate from p_profile_id (NOT auth.uid()), applies the
-- same submit guards, inserts a NEW (insert-only) submission marked
-- ai_grade={"status":"grading"}, and returns the grading context as jsonb.
-- ============================================================================
create or replace function public.start_grading_submission(
  p_profile_id  uuid,
  p_exercise_id uuid,
  p_artifact    text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate      uuid;
  v_tenant         uuid;
  v_module_id      uuid;
  v_module_order   int;
  v_gate_type      public.gate_type;
  v_program_id     uuid;
  v_ex_type        public.exercise_type;
  v_ex_prompt      text;
  v_ex_rubric      jsonb;
  v_ex_sandbox     jsonb;
  v_ex_id          uuid;
  v_enrollment     public.enrollment%rowtype;
  v_submission_id  uuid;
begin
  -- Resolve the candidate from the PROFILE id (service role calls this; there
  -- is no auth.uid() to trust here).
  select id into v_candidate
  from public.candidate
  where profile_id = p_profile_id;
  if v_candidate is null then
    raise exception 'Not enrolled in this program.';
  end if;

  select e.id, e.module_id, e.type, e.prompt, e.rubric, e.sandbox_config,
         m."order", m.gate_type, m.program_id, m.tenant_id
    into v_ex_id, v_module_id, v_ex_type, v_ex_prompt, v_ex_rubric, v_ex_sandbox,
         v_module_order, v_gate_type, v_program_id, v_tenant
  from public.exercise e
  join public.module m on m.id = e.module_id
  where e.id = p_exercise_id;

  if v_module_id is null then
    raise exception 'Exercise not found.';
  end if;

  select * into v_enrollment
  from public.enrollment
  where candidate_id = v_candidate and program_id = v_program_id;
  if v_enrollment.id is null then
    raise exception 'Not enrolled in this program.';
  end if;

  -- Same guards as submit: module is current; status in not_started/in_progress.
  if v_module_order <> v_enrollment.current_module_order then
    raise exception 'This module is locked.';
  end if;
  if v_enrollment.status not in ('not_started', 'in_progress') then
    raise exception 'This module is not open for submission.';
  end if;

  -- Stamp started_at + bump not_started -> in_progress.
  if v_enrollment.started_at is null then
    update public.enrollment set started_at = now() where id = v_enrollment.id;
  end if;
  if v_enrollment.status = 'not_started' then
    update public.enrollment set status = 'in_progress' where id = v_enrollment.id;
  end if;

  -- Insert-only: a NEW submission row marked "grading".
  insert into public.submission
    (tenant_id, enrollment_id, exercise_id, module_id, artifact, ai_grade, gate_status)
  values
    (v_tenant, v_enrollment.id, p_exercise_id, v_module_id, p_artifact,
     jsonb_build_object('status', 'grading'), 'pending')
  returning id into v_submission_id;

  return jsonb_build_object(
    'submission_id', v_submission_id,
    'tenant_id', v_tenant,
    'program_id', v_program_id,
    'module_id', v_module_id,
    'module_order', v_module_order,
    'gate_type', v_gate_type,
    'exercise', jsonb_build_object(
      'id', v_ex_id,
      'type', v_ex_type,
      'prompt', v_ex_prompt,
      'rubric', coalesce(v_ex_rubric, '{}'::jsonb),
      'sandbox_config', coalesce(v_ex_sandbox, '{}'::jsonb)
    )
  );
end;
$$;

revoke all on function public.start_grading_submission(uuid, uuid, text) from public;
revoke all on function public.start_grading_submission(uuid, uuid, text) from authenticated;
grant execute on function public.start_grading_submission(uuid, uuid, text) to service_role;

-- ============================================================================
-- RPC: apply_grading_result(p_submission_id, p_ai_grade, p_passed)
-- SERVICE-ROLE ONLY. Writes ai_grade, then gates by the submission's module
-- gate_type. ONLY auto_pass advances on the AI grade alone. trainer_review /
-- cross_track route to a trainer (AI grade ADVISORY). error / needs_manual_review
-- always route to manual review regardless of gate.
-- ============================================================================
create or replace function public.apply_grading_result(
  p_submission_id uuid,
  p_ai_grade      jsonb,
  p_passed        boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_submission   public.submission%rowtype;
  v_enrollment   public.enrollment%rowtype;
  v_program_id   uuid;
  v_gate_type    public.gate_type;
  v_module_order int;
  v_max_order    int;
  v_status       text;
  v_gate_status  public.gate_status;
  v_advanced     boolean := false;
  v_new_status   public.enrollment_status;
begin
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

  select m."order", m.gate_type
    into v_module_order, v_gate_type
  from public.module m
  where m.id = v_submission.module_id;

  v_status := coalesce(p_ai_grade->>'status', 'error');

  -- Always persist the AI grade on this submission (advisory or applied).
  update public.submission
    set ai_grade = coalesce(p_ai_grade, '{}'::jsonb)
    where id = p_submission_id;

  v_max_order := (
    select max("order") from public.module where program_id = v_program_id
  );

  -- Route by gate + grade status.
  if v_status in ('error', 'needs_manual_review') then
    -- Never auto pass/fail: send to a human regardless of gate.
    v_gate_status := 'pending';
    update public.submission set gate_status = v_gate_status where id = p_submission_id;
    update public.enrollment set status = 'awaiting_review'
      where id = v_enrollment.id
      returning status into v_new_status;

  elsif v_gate_type = 'auto_pass' and v_status = 'graded' and p_passed then
    -- The only path that advances on the AI grade alone.
    v_gate_status := 'passed';
    update public.submission set gate_status = v_gate_status, reviewed_at = now()
      where id = p_submission_id;
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

  elsif v_gate_type = 'auto_pass' and v_status = 'graded' and not p_passed then
    -- Graded fail on an auto_pass gate: resubmission allowed.
    v_gate_status := 'failed';
    update public.submission set gate_status = v_gate_status, reviewed_at = now()
      where id = p_submission_id;
    update public.enrollment set status = 'in_progress'
      where id = v_enrollment.id
      returning status into v_new_status;

  else
    -- trainer_review / cross_track (or any auto_pass not-graded fallthrough):
    -- AI grade is ADVISORY only; a trainer decides.
    v_gate_status := 'pending';
    update public.submission set gate_status = v_gate_status where id = p_submission_id;
    update public.enrollment set status = 'awaiting_review'
      where id = v_enrollment.id
      returning status into v_new_status;
  end if;

  return jsonb_build_object(
    'gate_status', v_gate_status,
    'advanced', v_advanced,
    'enrollment_status', v_new_status
  );
end;
$$;

revoke all on function public.apply_grading_result(uuid, jsonb, boolean) from public;
revoke all on function public.apply_grading_result(uuid, jsonb, boolean) from authenticated;
grant execute on function public.apply_grading_result(uuid, jsonb, boolean) to service_role;
