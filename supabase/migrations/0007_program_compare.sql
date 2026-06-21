-- ============================================================================
-- Venakan Learn — Program Compare & Apply (Prompt 7)
-- RPC: apply_program_changes — applies trainer-accepted comparison suggestions
-- to a DRAFT program, logging each as a refinement row and bumping the version.
--
-- Staff-gated and DRAFT-only. Edits modules/exercises ONLY — never touches
-- enrollments or submissions.
--
-- Depends on:
--   * 0001_init.sql — public.profile, app_role/profile_status enums.
--   * 0002_generation.sql — public.program (status, version),
--     public.module ("order", title, objectives, materials, gate_type),
--     public.exercise (type, prompt, rubric), public.refinement
--     (tenant_id, program_id, target_kind, target_id, prompt, diff, author).
--   * 0005_learner_runtime.sql — public.module.lesson jsonb column.
-- ============================================================================

create or replace function public.apply_program_changes(
  p_program_id uuid,
  p_changes    jsonb
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
  v_program_st  public.program_status;
  v_version     int;
  v_applied     int := 0;
  v_change      jsonb;
  v_op          text;
  v_order       int;
  v_ex_index    int;
  v_fields      jsonb;
  v_rationale   text;
  v_module      public.module%rowtype;
  v_exercise    public.exercise%rowtype;
  v_new_order   int;
  v_new_module  uuid;
  v_old         jsonb;
  v_new         jsonb;
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
  select tenant_id, status, version
    into v_program_ten, v_program_st, v_version
  from public.program
  where id = p_program_id;

  if v_program_ten is null or v_program_ten <> v_tenant then
    raise exception 'Program not found in your tenant.';
  end if;

  -- 3) Only DRAFT programs can be edited.
  if v_program_st <> 'draft' then
    raise exception 'Only draft programs can be edited.';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'p_changes must be a JSON array.';
  end if;

  -- 4) Apply each accepted suggestion.
  for v_change in select * from jsonb_array_elements(p_changes)
  loop
    v_op        := v_change ->> 'op';
    v_fields    := coalesce(v_change -> 'fields', '{}'::jsonb);
    v_rationale := coalesce(v_change ->> 'rationale', v_change ->> 'title', '');

    if v_op = 'modify_module' then
      v_order := (v_change ->> 'target_module_order')::int;
      select * into v_module
      from public.module
      where program_id = p_program_id and "order" = v_order
      limit 1;
      if not found then
        continue;
      end if;

      v_old := jsonb_build_object(
        'title', v_module.title,
        'objectives', v_module.objectives,
        'materials', v_module.materials,
        'gate_type', v_module.gate_type,
        'lesson', v_module.lesson
      );

      update public.module set
        title      = coalesce(v_fields ->> 'title', title),
        objectives = case when v_fields ? 'objectives'
                          then v_fields -> 'objectives' else objectives end,
        materials  = case when v_fields ? 'materials'
                          then v_fields ->> 'materials' else materials end,
        gate_type  = case when v_fields ? 'gate_type'
                          then (v_fields ->> 'gate_type')::public.gate_type
                          else gate_type end,
        lesson     = case when v_fields ? 'lesson'
                          then v_fields -> 'lesson' else lesson end
      where id = v_module.id;

      v_new := jsonb_build_object(
        'title', coalesce(v_fields ->> 'title', v_module.title),
        'objectives', case when v_fields ? 'objectives'
                           then v_fields -> 'objectives'
                           else to_jsonb(v_module.objectives) end,
        'materials', case when v_fields ? 'materials'
                          then v_fields ->> 'materials' else v_module.materials end,
        'gate_type', case when v_fields ? 'gate_type'
                          then v_fields ->> 'gate_type'
                          else v_module.gate_type::text end,
        'lesson', case when v_fields ? 'lesson'
                       then v_fields -> 'lesson' else v_module.lesson end
      );

      insert into public.refinement
        (tenant_id, program_id, target_kind, target_id, prompt, diff, author)
      values
        (v_tenant, p_program_id, 'module', v_module.id, v_rationale,
         jsonb_build_object('old', v_old, 'new', v_new), auth.uid());

      v_applied := v_applied + 1;

    elsif v_op = 'add_module' then
      select coalesce(max("order"), 0) + 1 into v_new_order
      from public.module where program_id = p_program_id;

      insert into public.module
        (tenant_id, program_id, "order", title, objectives, materials, lesson, gate_type)
      values (
        v_tenant,
        p_program_id,
        v_new_order,
        coalesce(v_fields ->> 'title', 'New module'),
        coalesce(v_fields -> 'objectives', '[]'::jsonb),
        v_fields ->> 'materials',
        case when v_fields ? 'lesson' and jsonb_array_length(coalesce(v_fields -> 'lesson', '[]'::jsonb)) > 0
             then v_fields -> 'lesson'
             else jsonb_build_array(
               jsonb_build_object('type', 'markdown',
                 'text', coalesce(v_fields ->> 'materials', v_fields ->> 'title', 'New module')))
        end,
        coalesce((v_fields ->> 'gate_type')::public.gate_type, 'trainer_review')
      )
      returning id into v_new_module;

      insert into public.refinement
        (tenant_id, program_id, target_kind, target_id, prompt, diff, author)
      values
        (v_tenant, p_program_id, 'program', p_program_id, v_rationale,
         jsonb_build_object(
           'old', null,
           'new', jsonb_build_object(
             'added_module', coalesce(v_fields ->> 'title', 'New module'),
             'order', v_new_order)), auth.uid());

      v_applied := v_applied + 1;

    elsif v_op = 'remove_module' then
      v_order := (v_change ->> 'target_module_order')::int;
      select * into v_module
      from public.module
      where program_id = p_program_id and "order" = v_order
      limit 1;
      if not found then
        continue;
      end if;

      -- Cascade removes the module's exercises (FK on delete cascade).
      delete from public.module where id = v_module.id;

      insert into public.refinement
        (tenant_id, program_id, target_kind, target_id, prompt, diff, author)
      values
        (v_tenant, p_program_id, 'program', p_program_id, v_rationale,
         jsonb_build_object(
           'old', jsonb_build_object('removed_module', v_module.title,
             'order', v_module."order"),
           'new', null), auth.uid());

      v_applied := v_applied + 1;

    elsif v_op = 'modify_exercise' then
      v_order    := (v_change ->> 'target_module_order')::int;
      v_ex_index := (v_change ->> 'target_exercise_index')::int;

      select * into v_module
      from public.module
      where program_id = p_program_id and "order" = v_order
      limit 1;
      if not found then
        continue;
      end if;

      -- Pick the exercise at the given index (stable by created_at, then id).
      select * into v_exercise
      from public.exercise
      where module_id = v_module.id
      order by created_at asc, id asc
      offset v_ex_index limit 1;
      if not found then
        continue;
      end if;

      v_old := jsonb_build_object(
        'prompt', v_exercise.prompt,
        'rubric', v_exercise.rubric
      );

      update public.exercise set
        prompt = coalesce(v_fields ->> 'prompt', prompt),
        rubric = case when v_fields ? 'rubric'
                      then v_fields -> 'rubric' else rubric end
      where id = v_exercise.id;

      v_new := jsonb_build_object(
        'prompt', coalesce(v_fields ->> 'prompt', v_exercise.prompt),
        'rubric', case when v_fields ? 'rubric'
                       then v_fields -> 'rubric' else v_exercise.rubric end
      );

      insert into public.refinement
        (tenant_id, program_id, target_kind, target_id, prompt, diff, author)
      values
        (v_tenant, p_program_id, 'exercise', v_exercise.id, v_rationale,
         jsonb_build_object('old', v_old, 'new', v_new), auth.uid());

      v_applied := v_applied + 1;
    end if;
  end loop;

  -- 5) Bump the program version.
  update public.program
  set version = version + 1
  where id = p_program_id
  returning version into v_version;

  return jsonb_build_object('applied', v_applied, 'new_version', v_version);
end;
$$;

revoke all on function public.apply_program_changes(uuid, jsonb) from public;
grant execute on function public.apply_program_changes(uuid, jsonb) to authenticated;
