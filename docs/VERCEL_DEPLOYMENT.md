# Vercel Services deployment preparation

This repository is prepared for one Vercel project with two services:

- `web`: the Next.js application and its existing Next.js route handlers;
- `optimizer`: the FastAPI / OR-Tools service, reachable only by `web` through a Vercel Service binding.

This is preparation only. **Do not deploy** until the reviewed commit is on GitHub and Supabase Auth, RLS, and user-isolation checks have been configured. Production optimization now fails closed unless a server-verified user owns an RLS-visible workspace; see [Supabase setup](SUPABASE_SETUP.md).

## Repository configuration

The root [vercel.json](../vercel.json) uses the current `services` configuration, not the retired `experimentalServices` configuration.

`web` receives the private `OPTIMIZER_API_URL` environment variable at runtime from its binding to `optimizer`. Vercel generates this URL for each deployment; it must not be created in the dashboard or prefixed with `NEXT_PUBLIC_`.

The only top-level rewrite is the final catch-all to `web`. There is deliberately no `/api/*` rewrite to `optimizer`. Consequently, existing routes such as `POST /api/optimizer` remain Next.js route handlers, and `optimizer` has no public ingress path.

The Python service has an explicit Python 3.12 declaration in [services/optimizer/.python-version](../services/optimizer/.python-version), a pinned `pyproject.toml`, deployable package data for the canonical fixture, and an explicit FastAPI entry point (`app.main:app`). Vercel Services builds each service from its own root.

Pages that load the demo dataset are explicitly dynamic. This matters because a Service binding is injected at function runtime, not at build time; the Vercel build must never need an optimizer URL.

## Security state and required follow-up

A private Service binding limits network reachability; it is not end-user authorization. The current production `403` in `apps/web/src/app/api/optimizer/route.ts` is therefore retained as a fail-closed safeguard. Do not remove it merely because the private binding works.

Before enabling production optimization, implement and review all of the following:

1. Supabase Auth session verification in the Next.js route handler.
2. Explicit authorization for the authenticated user or organization that owns the selected planning workspace.
3. CSRF-safe request design for cookie-authenticated browser requests.
4. Supabase RLS policies verified with an authenticated user A/user B isolation test.
5. Rate limiting / abuse controls appropriate to the deployment plan.

The FastAPI service stays private after that change. The Next.js server verifies the user and calls FastAPI through the binding; the browser must never receive `OPTIMIZER_API_URL` or call FastAPI directly.

## Environment variable checklist

Add variables to the **web service only**, for the appropriate Preview and Production environments. Never commit real values.

| Variable | Scope | Value / purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + web | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + web | Current `sb_publishable_...` key only. It is safe to expose only when RLS is enabled and tested. |
| `SUPABASE_SECRET_KEY` | Server-side web only, only if a reviewed server-only administrative operation requires it | Current `sb_secret_...` key. Do not expose it to the browser or optimizer, and do not use it for normal user-scoped data access because it bypasses RLS. |
| `OPTIMIZER_API_URL` | Injected into web at runtime | **Do not set manually.** The Vercel `optimizer` service binding supplies it. |

There are no optimizer secrets in the present application. If future FastAPI code needs a secret, add it only to the `optimizer` service and document why it is needed. Do not use Supabase legacy `anon` or `service_role` keys for a newly created project.

For local development, retain `OPTIMIZER_API_URL=http://127.0.0.1:8000` in the untracked `apps/web/.env.local`. That local value is not a production setting.

## Exact Vercel dashboard setup

1. Push the reviewed repository state to GitHub; do not create a deployment from an unreviewed working tree.
2. In Vercel, import the GitHub repository as one project. Set the project **Root Directory** to the repository root, not `apps/web`.
3. Open **Settings → Build and Deployment** and set **Framework Preset** to **Services**. Services requires this setting and the root `services` object in `vercel.json`.
4. Leave **Output Directory** empty. Do not enter `public`; Next.js manages its own output.
5. Do not add a project-level Build Command, Install Command, Framework override, or `/api/*` rewrite. Each service owns its own build configuration.
6. In **Settings → Functions**, confirm the optimizer service has enough memory for OR-Tools. Vercel Fluid compute memory is configured in the dashboard, not by a `memory` field in `vercel.json`. Start with the lowest setting that passes the deployment smoke test and record the result.
7. The checked-in optimizer function limit is 60 seconds. Its normal solver request is bounded to five seconds (ten seconds maximum accepted input), leaving headroom for process startup and validation. Verify the account plan permits 60 seconds; current Vercel limits are plan-dependent.
8. Add only the environment variables in the table after Supabase is configured. Select the intended Preview/Production scopes. Do not manually add `OPTIMIZER_API_URL`.
9. Configure Supabase Auth redirect URLs for the actual Vercel Preview and Production origins, enable RLS on every exposed application table, and test user isolation before enabling the production optimization route.
10. Deploy only after the preceding review is complete. Use the Vercel deployment graph and per-service logs to verify that `web` binds to `optimizer` and that `optimizer` has no public rewrite.

## Linux / OR-Tools and resource verification

The optimizer pins `ortools==9.11.4210`, requires Python 3.12, and has no platform-specific application code. Vercel's current Python runtime is CPython on Linux and supports `pyproject.toml`; FastAPI is deployed as one Python function. The Python function bundle limit is 500 MB uncompressed. A local `linux/amd64` Docker build installed the matching `manylinux_2_17_x86_64` OR-Tools wheel successfully. The deployed bundle size must still be checked in Vercel build logs.

Vercel Services functions use the same limits as Vercel Functions. At the time this guide was prepared, the documented Fluid compute limits are 2 GB memory on Hobby and 4 GB on Pro/Enterprise, with duration limits depending on the plan. Actual availability and configured memory must be verified in the target account before deployment. A local build cannot prove cloud packaging, account limits, or runtime behavior.

## Pre-deployment checks

Run from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test:web
pnpm --filter @up-rent/web exec next build --webpack
(cd services/optimizer && .venv/bin/ruff check .)
(cd services/optimizer && .venv/bin/pytest -q)
git diff --check
```

Optional local Services parity check after installing/authenticating the current Vercel CLI:

```bash
vercel dev -L
```

This should inject a local binding value for `OPTIMIZER_API_URL`. It is a local check only; it does not deploy.

## Online smoke-test checklist (perform only after authorization is implemented)

Record the deployment URL, deployment ID, service graph screenshot, and relevant `web` / `optimizer` logs for each result.

1. Load `/` and `/admin/dashboard`; both render successfully and use the preview's private optimizer binding.
2. Load `/admin/optimizer`; the initial dataset request succeeds through `web → optimizer`, with no public FastAPI URL.
3. Request a known FastAPI path directly from the public deployment URL (for example `/health` and `/api/v1/demo-case`); it must not reach FastAPI through the public router.
4. Call `POST /api/optimizer` without a valid session. Expect `401` or `403` after the production authorization change. Until that change, the present code correctly returns `403` for everyone.
5. With a permitted test user, call the route using a valid CSRF-safe flow. Verify only the Next.js route can invoke FastAPI and that the expected validated result is returned.
6. With a different test user, attempt to access the first user's workspace, scenario, and history records. RLS must deny access; confirm this with database tests as well as the UI.
7. Submit the canonical scenario and verify the optimizer response passes independent validation, includes both vehicles, and retains the existing distance and schedule values.
8. Exercise one invalid/infeasible order and verify structured diagnostics appear without exposing internal stack traces.
9. Inspect optimizer logs for Python dependency installation, FastAPI startup, OR-Tools import, function duration, allocated memory, and bundle size. Confirm the execution remains below the configured 60-second duration.
10. Repeat steps 1–9 on a Preview deployment before promoting to Production.

## Official references checked on 22 November 2026

- [Vercel Services guide](https://vercel.com/kb/guide/vercel-services) — current `services` syntax, internal bindings, routing, and all-plan beta availability.
- [Vercel Services configuration reference](https://vercel.com/docs/services/config-reference) — service-scoped build and function configuration.
- [Vercel FastAPI documentation](https://vercel.com/docs/frameworks/backend/fastapi) — FastAPI function behavior and 500 MB Python application-bundle limit.
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations) — current memory and duration limits.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) and [RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) — publishable/secret key separation and RLS requirements.
