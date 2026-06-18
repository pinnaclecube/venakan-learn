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
