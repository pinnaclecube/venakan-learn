# Venakan Learn — Go-Live Checklist

Short, ordered checklist to take the platform live. Check each box before announcing.

## 1. Database (Supabase)
- [ ] Run migrations in order: `0001` → `0002` → `0003` → `0004` → `0005` → `0006`.
- [ ] Bootstrap the first admin (`supabase/bootstrap_admin.sql` with a real auth user UUID + email).
- [ ] Confirm the `jd-uploads` storage bucket exists and is **private**.
- [ ] Spot-check RLS: as a trainee, you can read only your own enrollment/submissions; cohort ranking returns no other identities.

## 2. Environment variables (Vercel → Production)
- [ ] `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (client).
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_URL=https://learn.venakaninfo.com` (server).
- [ ] `ANTHROPIC_API_KEY` (server-only).
- [ ] Sandbox: rely on Vercel OIDC in prod (no secret), or set `VERCEL_TOKEN` / `VERCEL_TEAM_ID` / `VERCEL_PROJECT_ID` (server-only).
- [ ] Verify NO secret is prefixed `VITE_` and none appears in the client bundle.

## 3. Platform config
- [ ] **Vercel plan supports `maxDuration = 300`** (generation + grading need it; Hobby caps at 60s).
- [ ] **Vercel Sandbox enabled** on the project (required for code/rag/agent/cross_track grading).
- [ ] Custom domain `learn.venakaninfo.com` verified; GoDaddy CNAME `learn → cname.vercel-dns.com`; TLS issued.
- [ ] Supabase Auth → redirect URLs include `https://learn.venakaninfo.com/accept-invite` **and** `https://learn.venakaninfo.com/reset-password` (forgot-password flow).
- [ ] Email/SMTP configured (Resend) so invites actually send; bump the Auth email rate limit if inviting in bulk.

## 4. Smoke test (full loop, on production)
- [ ] Admin signs in → invites a trainer + a trainee → both accept the email and set passwords.
- [ ] Trainer: Intake (paste a JD) → review → save → **Generate program** completes → Refine a module.
- [ ] Trainer: **Publish & Assign** (pick the trainee + at least one trainer).
- [ ] Trainee: **My Learning** → open program → read a rich lesson → submit a `judge` exercise → AI grade shows.
- [ ] Submit a `trainer_review` exercise → trainer **Reports → gate queue → Review** (Pass) → trainee module advances; (Fail) → trainee can resubmit (history preserved).
- [ ] Reports show cohort data; trainee **My Progress** shows anonymized standing (no other names/scores).

## 5. Security & safety re-confirm
- [ ] Candidate code runs only in the sandbox (empty env, timeout/CPU caps, no internal network).
- [ ] Grading RPCs (`start_grading_submission`, `apply_grading_result`) are `service_role`-only.
- [ ] AI grades are advisory at `trainer_review`/`cross_track`; trainer decision is authoritative.
- [ ] Grading errors route to manual review — never a silent pass/fail.

## 6. Content readiness
- [ ] For `code`/`rag`/`agent`/`cross_track` exercises, author real `sandbox_config` (tests/corpus/harness/eval). `judge` works without config.
- [ ] (Optional) Seed a demo cohort so dashboards aren't empty for the launch demo.

## 7. Post-launch
- [ ] Watch Vercel function logs for `/api/generate-program`, `/api/refine`, `/api/submit-and-grade` (timeouts, 500s).
- [ ] Watch Supabase logs/usage and Anthropic API spend.
- [ ] Have a rollback plan: Vercel "Promote previous deployment" + a Supabase backup snapshot before launch.
