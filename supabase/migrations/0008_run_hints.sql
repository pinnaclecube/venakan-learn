-- ============================================================================
-- 0008_run_hints.sql — Coding playground (Option B) support.
--
-- Re-creates get_trainee_program to surface TWO derived, non-sensitive hints
-- per exercise so the trainee UI can render a syntax-highlighted editor and a
-- "Run" button WITHOUT ever receiving the (server-only) sandbox_config:
--
--   * language     — 'python' | 'javascript' | 'text' (editor highlighting)
--   * run_enabled  — true when the exercise has a runnable command
--                    (run_command / eval_command / test_command)
--
-- NOTE: sandbox_config (hidden tests/commands) is NOT exposed — only these two
-- derived scalars. Everything else about this function is unchanged from
-- 0005_learner_runtime.sql.
--
-- Depends on: 0002 (exercise.sandbox_config), 0005 (get_trainee_program).
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

  -- Modules (ordered) with their exercises. Each exercise carries the derived
  -- language + run_enabled hints (NOT the raw sandbox_config).
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
               'rubric', e.rubric,
               'language',
                 case
                   when e.sandbox_config->>'runtime' = 'python' then 'python'
                   when e.type in ('code', 'rag', 'agent') then 'javascript'
                   else 'text'
                 end,
               'run_enabled',
                 (
                   (jsonb_typeof(e.sandbox_config->'run_command') = 'array'
                     and jsonb_array_length(e.sandbox_config->'run_command') > 0)
                   or (jsonb_typeof(e.sandbox_config->'eval_command') = 'array'
                     and jsonb_array_length(e.sandbox_config->'eval_command') > 0)
                   or (jsonb_typeof(e.sandbox_config->'test_command') = 'array'
                     and jsonb_array_length(e.sandbox_config->'test_command') > 0)
                 )
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
-- RPC: get_run_context(p_profile_id, p_exercise_id) — validates that the caller
-- may run this exercise (enrolled + module is current + status open) and
-- returns the SERVER-ONLY sandbox_config for a sandbox dry run.
--
-- READ-ONLY: unlike start_grading_submission it inserts NOTHING and mutates no
-- enrollment state — the playground "Run" is not a submission. Mirrors the
-- access guards of start_grading_submission.
--
-- SERVICE-ROLE ONLY (revoked from authenticated): sandbox_config holds hidden
-- tests/commands and must never reach the browser. The /api/run-exercise
-- endpoint calls this with the service-role client after verifying the caller.
-- ============================================================================
create or replace function public.get_run_context(
  p_profile_id  uuid,
  p_exercise_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_candidate     uuid;
  v_module_id     uuid;
  v_module_order  int;
  v_program_id    uuid;
  v_sandbox       jsonb;
  v_enrollment    public.enrollment%rowtype;
begin
  select id into v_candidate
  from public.candidate
  where profile_id = p_profile_id;
  if v_candidate is null then
    raise exception 'Not enrolled in this program.';
  end if;

  select e.module_id, m."order", m.program_id, e.sandbox_config
    into v_module_id, v_module_order, v_program_id, v_sandbox
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

  if v_module_order <> v_enrollment.current_module_order then
    raise exception 'This module is locked.';
  end if;
  if v_enrollment.status not in ('not_started', 'in_progress') then
    raise exception 'This module is not open for runs.';
  end if;

  return jsonb_build_object(
    'sandbox_config', coalesce(v_sandbox, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.get_run_context(uuid, uuid) from public;
revoke all on function public.get_run_context(uuid, uuid) from authenticated;
grant execute on function public.get_run_context(uuid, uuid) to service_role;
