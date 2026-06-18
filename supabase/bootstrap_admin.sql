-- ============================================================================
-- Bootstrap the FIRST admin (run ONCE, manually, after migrations).
--
-- There is no public sign-up and the invite flow requires an existing admin,
-- so the very first admin must be created by hand:
--
--   1. In the Supabase Dashboard -> Authentication -> Users -> "Add user",
--      create a user with the admin's email and a password (confirm email).
--      Copy that user's UUID.
--   2. Replace the placeholders below and run this in the SQL editor.
--
-- The Venakan tenant id is seeded by 0001_init.sql.
-- ============================================================================

insert into public.profile (id, tenant_id, full_name, email, role, status)
values (
  '00000000-0000-0000-0000-000000000000',          -- <-- paste the auth user UUID
  '11111111-1111-1111-1111-111111111111',          -- Venakan tenant (seeded)
  'First Admin',                                     -- <-- full name
  'admin@venakaninfo.com',                           -- <-- must match the auth user's email
  'admin',
  'active'
)
on conflict (id) do update
  set role = excluded.role,
      status = excluded.status;
