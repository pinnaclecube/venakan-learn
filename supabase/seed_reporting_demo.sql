-- ============================================================================
-- OPTIONAL demo data for the reporting dashboards — safe to skip; run only to
-- see populated charts. Idempotent: re-running does nothing harmful. Guards on
-- the existence of trainee profiles and a published program; if either is
-- missing, this script inserts nothing.
-- Scoped to the seeded Venakan tenant 11111111-1111-1111-1111-111111111111.
-- ============================================================================

-- 1) Make every Venakan trainee profile a candidate (track assigned by hash).
insert into public.candidate (tenant_id, profile_id, track)
select p.tenant_id,
       p.id,
       (array['backend', 'frontend', 'ml'])[1 + (abs(hashtext(p.id::text)) % 3)]
from public.profile p
where p.tenant_id = '11111111-1111-1111-1111-111111111111'
  and p.role = 'trainee'
  and not exists (select 1 from public.candidate c where c.profile_id = p.id)
on conflict (profile_id) do nothing;

-- 2) Enroll each candidate into the first published program (if any), with a
--    pseudo-random current_module_order / status.
insert into public.enrollment
  (tenant_id, candidate_id, program_id, current_module_order, status, started_at)
select c.tenant_id,
       c.id,
       prog.id,
       least(prog.module_count - 1,
             (abs(hashtext(c.id::text)) % greatest(prog.module_count, 1))),
       (array['in_progress', 'in_progress', 'awaiting_review', 'completed', 'not_started']
         )[1 + (abs(hashtext(c.id::text || 'st')) % 5)]::public.enrollment_status,
       now() - ((abs(hashtext(c.id::text)) % 14) || ' days')::interval
from public.candidate c
cross join lateral (
  select pr.id,
         greatest(1, (select count(*) from public.module m where m.program_id = pr.id)) as module_count
  from public.program pr
  where pr.tenant_id = c.tenant_id
    and pr.status = 'published'
  order by pr.created_at asc
  limit 1
) prog
where c.tenant_id = '11111111-1111-1111-1111-111111111111'
  and not exists (
    select 1 from public.enrollment e
    where e.candidate_id = c.id and e.program_id = prog.id
  );

-- 3) Insert a handful of submissions per enrollment with mixed gate_status,
--    one per module up to (and including) the current module order.
insert into public.submission
  (tenant_id, enrollment_id, module_id, exercise_id, gate_status, ai_grade, submitted_at)
select e.tenant_id,
       e.id,
       m.id,
       (select ex.id from public.exercise ex where ex.module_id = m.id order by ex.created_at limit 1),
       (array['passed', 'passed', 'passed', 'failed', 'pending']
         )[1 + (abs(hashtext(e.id::text || m.id::text)) % 5)]::public.gate_status,
       jsonb_build_object('score', 50 + (abs(hashtext(e.id::text || m.id::text)) % 50)),
       now() - ((abs(hashtext(e.id::text || m.id::text)) % 10) || ' days')::interval
from public.enrollment e
join public.module m
  on m.program_id = e.program_id
 and m."order" <= e.current_module_order
where e.tenant_id = '11111111-1111-1111-1111-111111111111'
  and not exists (
    select 1 from public.submission s
    where s.enrollment_id = e.id and s.module_id = m.id
  );
