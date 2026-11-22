# Supabase Auth and workspace setup

This repository prepares, but does not apply, the SQL required for a new isolated Supabase project. No hosted project, remote SQL, GitHub push, or Vercel deployment has been performed.

## Files and SQL order

1. Apply `supabase/migrations/20261122220000_create_planning_workspaces.sql` in the Supabase SQL editor or through the Supabase CLI against a new project.
2. Create private demo users in **Authentication → Users**. Public self-registration is not implemented.
3. Add the Vercel Preview and Production URLs as Supabase Auth redirect URLs.
4. Run `supabase/tests/planning_workspaces_rls_test.sql` with the local Supabase test runner when an isolated local environment is available.
5. Only after reviewing the RLS results, add the browser-safe variables to Vercel and deploy a Preview.

The migration creates one `public.planning_workspaces` JSONB row per `auth.users` owner. It revokes all privileges from `anon`, grants only CRUD to `authenticated`, enables RLS, and has separate owner checks for SELECT, INSERT, UPDATE, and DELETE. The API updates with `owner_id` and `version` predicates, so a stale browser receives `409 VERSION_CONFLICT` rather than overwriting another session.

## Local RLS verification

The pgTAP test is intentionally local-only. It creates the `pgtap` extension in the isolated local stack and creates two synthetic `auth.users` records inside a transaction that is rolled back by the test runner. It does not use `tests.create_supabase_user()` and must not be pasted into the hosted SQL Editor.

```bash
pnpm dlx supabase@3.2.0 start -x studio,imgproxy,logflare,vector,supavisor,edge-runtime
pnpm dlx supabase@3.2.0 test db supabase/tests/planning_workspaces_rls_test.sql
```

The test covers anonymous read/write denial, owner insert/read/update/delete, cross-user insert/read/update/delete denial, and owner-ID reassignment denial.

## Hosted migration history after SQL Editor use

Applying SQL through the Supabase SQL Editor changes the schema but does not add an entry to `supabase_migrations.schema_migrations`. First select the intended project ref and inspect history without changing it:

```bash
pnpm dlx supabase@3.2.0 migration list --remote=<project-ref>
```

Compare the hosted table, columns, trigger, grants, RLS enabled state, and four policies with `20261122220000_create_planning_workspaces.sql`. If—and only if—they exactly match, mark the already-applied migration in history without replaying its SQL:

```bash
pnpm dlx supabase@3.2.0 migration repair 20261122220000 --status applied --remote=<project-ref>
pnpm dlx supabase@3.2.0 migration list --remote=<project-ref>
```

`migration repair` changes only migration history. Do not run `db push` for this migration, and do not run the repair command until the project ref and schema match have been independently confirmed.

Historical optimization runs are stored as part of the workspace JSONB snapshot and are never edited by the UI. The application writes a full replacement only after a confirmed server response. The version check preserves immutable historical input/result/failure records against accidental concurrent replacement; it is not an audit-log or legal retention system.

## Required variables

Set these on the Next.js `web` Vercel Service for Preview and Production:

```text
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Do not configure `SUPABASE_SECRET_KEY` for this feature. Normal workspace access uses the authenticated user's cookie session and RLS. Do not use legacy `anon`/`service_role` keys for a new project. `OPTIMIZER_API_URL` is still injected by the private Vercel Service binding and must not be public.

## Browser-data migration

1. Sign in with the intended private demo account.
2. Use **Preuzmi sigurnosnu kopiju JSON**. It contains the complete versioned business workspace, stable IDs, drafts, settings, success/failure runs, snapshots, diagnostics, and legacy records.
3. Review the shown counts and account address.
4. Press **Potvrdi uvoz u cloud** only when no cloud workspace exists. The browser sends the full workspace and expected version `0`.
5. If a cloud workspace already exists, use **Sigurno sjedini s cloudom**. Existing local and remote records are retained by stable ID; conflicts are not silently overwritten.
6. If restoring a backup, use **Vrati/ujedini JSON**. Only new stable IDs are added to local storage; the imported raw backup is separately retained. Existing local records are not cleared or replaced.
7. Confirm counts, historical runs, failure diagnostics, and IDs after reload. Keep the downloaded backup until the review is complete.

## Authorization boundary

`proxy.ts` uses current Next.js 16 naming and Supabase SSR cookie refresh. `/admin/*` redirects to `/login` when claims are absent. Route handlers call `auth.getUser()` server-side before reading/writing workspaces or invoking the optimizer.

Production `POST /api/optimizer` requires: same-origin request, verified user, RLS-visible workspace, request size at most 256 KiB, a per-instance user rate guard, and FastAPI's existing bounded input/concurrency/timeout controls. The browser never receives the private FastAPI URL. A missing Supabase configuration fails closed.

The rate guard is intentionally instance-local; configure an edge/WAF rate limit before a public production rollout.
