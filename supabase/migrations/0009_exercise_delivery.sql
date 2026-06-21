-- ============================================================================
-- 0009_exercise_delivery.sql — Two-tier exercises (in-app vs external).
--
-- Adds:
--   * exercise.delivery     — 'in_app' (done in the playground) | 'external'
--                             (done in the trainee's own environment, submitted
--                             by reference). Defaults to 'in_app' so existing
--                             exercises are unchanged.
--   * exercise.starter_code — optional scaffold the editor is seeded with.
--
-- Re-creates get_trainee_program to surface BOTH (plus the language/run_enabled
-- hints from 0008). These are non-sensitive; sandbox_config still never leaves
-- the server.
--
-- Depends on: 0002 (exercise), 0008 (get_trainee_program with hints).
-- ============================================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'exercise_delivery') then
    create type public.exercise_delivery as enum ('in_app', 'external');
  end if;
end$$;

alter table public.exercise
  add column if not exists delivery public.exercise_delivery not null default 'in_app',
  add column if not exists starter_code text;

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

  select * into v_enrollment
  from public.enrollment
  where candidate_id = v_candidate and program_id = p_program_id;

  if v_enrollment.id is null then
    return jsonb_build_object('enrolled', false);
  end if;

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

  -- Modules (ordered) with their exercises + derived, non-sensitive hints.
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
               'delivery', e.delivery,
               'starter_code', coalesce(e.starter_code, ''),
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
