# Venakan Learn

Autonomous AI training delivery platform. **This repository is the foundation
only**: application shell, authentication, role-based access control (RBAC), and
invite-only user provisioning. Course generation, exercises, grading, and
reporting are intentionally **not** built here — they are later prompts.

Multi-tenant-**ready**: every table carries a `tenant_id` and is protected by
row-level security from day one. There is no tenant-management UI; exactly one
tenant ("Venakan") is seeded.

## Stack

- Vite + React 19 + TypeScript
- Tailwind CSS v4 (CSS-first `@theme`, no `tailwind.config`)
- shadcn/ui components (Radix primitives)
- Wouter for routing
- Supabase (Postgres + Auth + Storage)
- Deploy target: Vercel at `learn.venakaninfo.com`

## Roles

`app_role` enum: `admin`, `trainer`, `trainee`.

| Capability                              | admin | trainer | trainee |
| --------------------------------------- | :---: | :-----: | :-----: |
| Provision/invite trainers & admins      |  ✅   |   ❌    |   ❌    |
| Provision/enroll trainees               |  ✅   |   ❌    |   ❌    |
| Upload JD / prompt to generate courses* |  ✅   |   ✅    |   ❌    |
| Refine programs*                        |  ✅   |   ✅    |   ❌    |
| Review gated submissions*               |  ✅   |   ✅    |   ❌    |
| View cohort reports*                    |  ✅   |   ✅    |   ❌    |
| Consume program & submit work*          |  ❌   |   ❌    |   ✅    |

`admin` is a super-admin: everything a trainer can do **plus** provisioning.
Access is invite-only — a user exists only if an admin provisioned them.
\*Capabilities marked with an asterisk are surfaced as placeholder routes in
this foundation; their internals ship in later prompts.

## Local development

```bash
cd venakan-learn
npm install
cp .env.example .env   # then fill in the values (see below)
npm run dev            # Vite dev server on http://localhost:5173
```

> The `/api/*` serverless functions run on Vercel. To exercise the invite /
> disable flows locally, use the Vercel CLI: `vercel dev` (it loads `.env` and
> serves both the Vite app and the `api/` functions).

## Environment variables

Copy `.env.example` → `.env` (local) and set the same values in Vercel.

| Variable                    | Scope        | Notes                                                            |
| --------------------------- | ------------ | ---------------------------------------------------------------- |
| `VITE_SUPABASE_URL`         | client       | Supabase project URL.                                            |
| `VITE_SUPABASE_ANON_KEY`    | client       | Anon/public key. RLS-gated, safe in the browser.                 |
| `SUPABASE_URL`              | server only  | Same project URL, for serverless functions.                      |
| `SUPABASE_SERVICE_ROLE_KEY` | server only  | Bypasses RLS. **Never** expose to the client / never `VITE_`.    |
| `APP_URL`                   | server only  | Public base URL used to build invite links (`…/accept-invite`).  |

**Security:** the service-role key lives only in `api/_supabaseAdmin.ts` (server
side). It is never imported into `src/`. Client code uses the anon key, which is
constrained by row-level security.

## Database / migrations

Migrations live in `supabase/migrations/`.

**`0001_init.sql`** creates the `app_role` enum, the `tenant`, `profile`, and
`invitation` tables (all with `tenant_id` + RLS), the RLS policies, the
`current_tenant_id()` / `current_app_role()` helper functions, and seeds the
`Venakan` tenant.

Run it either way:

- **Supabase CLI:** `supabase db push` (or `supabase migration up`)
- **Dashboard:** paste the file into the SQL editor and run.

### Bootstrap the first admin

The invite flow needs an existing admin, so create the first admin once by hand:

1. Supabase Dashboard → Authentication → Users → **Add user** (set email +
   password, mark email confirmed). Copy the new user's UUID.
2. Edit `supabase/bootstrap_admin.sql` (paste the UUID + email) and run it.

After that, the admin can invite everyone else from `/admin/users`.

## Routes

| Route                | Access            | Purpose                                            |
| -------------------- | ----------------- | -------------------------------------------------- |
| `/login`             | public            | Sign-in (no public sign-up).                       |
| `/accept-invite`     | public (via link) | Invited user sets a password → status `active`.    |
| `/`                  | any active user   | Role-aware redirect (staff → Programs, trainee → My Learning). |
| `/trainer/programs`  | admin, trainer    | Placeholder shell (built later).                   |
| `/trainee/learning`  | trainee           | Placeholder shell (built later).                   |
| `/admin/users`       | admin             | User provisioning: list, invite, disable.          |

## Serverless API (server-only, service-role)

| Endpoint             | Who    | Action                                                          |
| -------------------- | ------ | --------------------------------------------------------------- |
| `POST /api/invite`   | admin  | Creates the auth user (invited) + emails the link, writes `invitation` + `profile`. |
| `POST /api/accept-invite` | any (self) | Flips the caller's own `profile.status` to `active`, stamps the invitation. |
| `POST /api/disable-user`  | admin | Sets `profile.status = disabled` and bans the auth user.      |

Every endpoint verifies the caller's Supabase access token and role before
using the service-role client.

| Endpoint                  | Who              | Action                                                          |
| ------------------------- | ---------------- | --------------------------------------------------------------- |
| `POST /api/submit-and-grade` | active trainee | Queues a submission, grades it, applies the gate (Prompt 6).    |
| `POST /api/compare-program`  | admin, trainer | Compares a draft program to the trainer's authored version; returns AI summary + suggestions (no DB writes). |
| `POST /api/export-program`   | admin, trainer | Returns the program as a branded Word (.docx) or PDF binary download. |

## Grading & Sandbox

Auto-grading is **on** (`AUTO_GRADE_ENABLED = true` in `src/lib/runtime.ts`,
mirrored server-side by the Prompt-6 RPCs). On submit, the trainee UI calls
`POST /api/submit-and-grade`, which:

1. `start_grading_submission` (service-role only) inserts a new submission row
   (history is insert-only — re-grades/resubmissions append) and returns the
   grading context.
2. `gradeSubmission()` runs the grader for the exercise type:
   - **code / rag / agent / cross_track** — run inside a **Vercel Sandbox**
     MicroVM (`api/grading/sandbox.ts`).
   - **judge** — a server-side Claude call (no sandbox), scoring the artifact
     against the rubric (a `judge_rubric_version` sha256 snapshot is stored).
3. `apply_grading_result` (service-role only) writes the AI grade and applies
   the gate.

**Gate semantics:** AI grades are **advisory** for `trainer_review` and
`cross_track` gates — the trainer's `review_submission` decision is
authoritative. **Only `auto_pass`** advances on the AI grade alone (graded +
passed). Any `error` / `needs_manual_review` outcome routes to a trainer; the
system never silently passes or fails.

**Sandbox swap point:** all Vercel-Sandbox specifics live in
`api/grading/sandbox.ts` behind the `GradingSandbox` interface. To change
providers, implement that interface and update `getGradingSandbox()`. A
`NotConfiguredSandbox` fallback returns a `needs_manual_review` grade if the
provider is unavailable.

**Untrusted-code isolation (candidate code):**

- Runs only inside an isolated Vercel Sandbox MicroVM (one per submission),
  with a short wall-clock timeout and minimal vCPU caps.
- The sandbox is created with an **empty env** — **no secrets** ever enter it
  (`SUPABASE_*`, `ANTHROPIC_API_KEY`, `VERCEL_*` are never forwarded). No
  access to internal services.
- The sandbox is always torn down (`destroy` in a `finally`).
- Single-region (US-East) by default; treat captured output as untrusted text.

**Sandbox credentials (server-only):** in production on Vercel the SDK uses the
platform **OIDC token automatically** (`VERCEL_OIDC_TOKEN`) — no secret needed.
For local/explicit auth, set `VERCEL_TOKEN`, `VERCEL_TEAM_ID`, and
`VERCEL_PROJECT_ID` (see `.env.example`). These are **server-only**: never
prefixed with `VITE_`, never in the client bundle, and never passed into the
candidate sandbox env.

## Program compare & branded export

On a program detail page (`/trainer/programs/:programId`, admin + trainer), staff
can reconcile the app-generated program against their own authored version and
download a branded copy.

**Compare & apply (draft programs only):**

1. **"Compare with my version"** (visible only while the program is `draft`)
   opens a dialog. Staff either upload a `.docx`/`.pdf` (stored in the existing
   `jd-uploads` bucket under `${tenantId}/compare/…`) or paste raw text.
2. `POST /api/compare-program` loads the app-generated program (modules,
   lessons, exercises, rubrics), reads the authored version (mammoth for `.docx`,
   a Claude document block for `.pdf`, raw text for paste), and asks Claude
   (`claude-opus-4-8`) for a **summary + concrete suggestions**. No DB writes.
3. Each suggestion has an Accept/Reject toggle (default Accept). **"Apply N
   accepted changes"** calls the `apply_program_changes` RPC, which applies the
   accepted edits, **logs each as a `refinement` row**, and **bumps
   `program.version`**.

Compare/apply is **staff-only and draft-only** — the RPC raises
`Only draft programs can be edited.` for published programs, and it edits
modules/exercises **only — it never touches enrollments or submissions**.

**Branded export (any program — draft or published):** the **"Download"**
dropdown offers **Word (.docx)** and **PDF**. `POST /api/export-program` builds a
well-formatted, on-brand document (cover with an ink banner, module sections with
gate badges, objectives, materials, rendered lessons, and rubric tables) using
the app palette (ink `#0F172A`, emerald `#059669`, mist `#F1F5F9`) and streams it
back as a binary download. `.docx` uses the `docx` package; PDF uses `pdfkit`.

**Logo drop-in:** place a PNG at **`api/assets/venakan-logo.png`** (white/reversed
or transparent, for the dark ink banner) to brand exports. If it is absent, the
exports fall back to a styled "Venakan **Learn**" text wordmark — no build step
needed. See `api/assets/README.md`.

These features reuse the existing Anthropic env (`ANTHROPIC_API_KEY`,
`ANTHROPIC_MODEL = claude-opus-4-8`) and Supabase env
(`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`) — **no new secrets**.

### Migration `0007_program_compare.sql`

Adds the `apply_program_changes(uuid, jsonb)` `SECURITY DEFINER` RPC (staff- and
draft-gated inside; `revoke … from public; grant execute … to authenticated`).
Depends on `0001` (helpers, `profile`), `0002` (`program` / `module` /
`exercise` / `refinement`), and `0005` (`module.lesson`). Run it via the Supabase
SQL editor or `supabase db push`.

## Deployment (Vercel)

> Document-only — do not run destructively.

1. Create a Vercel project pointed at this repo. If this app lives in a
   subdirectory, set the project **Root Directory** to `venakan-learn`.
   Framework preset: **Vite**. Build: `npm run build`. Output: `dist`.
2. Add the env vars above in Vercel (Project → Settings → Environment
   Variables). Set `APP_URL=https://learn.venakaninfo.com` for production.
3. In Supabase → Authentication → URL Configuration, add
   `https://learn.venakaninfo.com/accept-invite` (and the localhost equivalent)
   to the allowed redirect URLs.

### Custom domain `learn.venakaninfo.com`

1. Vercel → Project → Settings → Domains → add `learn.venakaninfo.com`.
2. In **GoDaddy DNS** for `venakaninfo.com`, add a **CNAME** record:
   - **Host/Name:** `learn`
   - **Value/Points to:** `cname.vercel-dns.com`
   - **TTL:** default (1 hour)
3. Wait for propagation; Vercel issues the TLS certificate automatically.

## Project structure

```
venakan-learn/
├── api/                      # Vercel serverless functions (service-role, server-only)
│   ├── _supabaseAdmin.ts     # service-role client (never imported by src/)
│   ├── _auth.ts              # caller verification + requireAdmin
│   ├── invite.ts             # admin: invite user
│   ├── accept-invite.ts      # self: activate account
│   └── disable-user.ts       # admin: disable user
├── supabase/
│   ├── migrations/0001_init.sql
│   └── bootstrap_admin.sql   # one-time first-admin template
├── src/
│   ├── components/
│   │   ├── auth/             # AuthProvider, RequireRole
│   │   ├── layout/           # AppShell, TopBar, SideNav, nav config, Wordmark
│   │   └── ui/               # shadcn primitives
│   ├── hooks/                # use-auth
│   ├── lib/                  # supabase client, api wrapper, types, utils
│   └── pages/                # login, accept-invite, admin/users, placeholders
└── .env.example
```
