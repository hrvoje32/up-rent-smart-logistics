# UP RENT Smart Logistics Planner

Task 00 establishes the local repository foundation for a future construction-machinery logistics planning platform. It deliberately includes no order management, optimization, map, authentication, database, AI, or GPS functionality.

## Architecture summary

- `apps/web`: Next.js App Router frontend, React, TypeScript, Tailwind CSS, and a shadcn/ui-compatible component layout.
- `services/optimizer`: independent FastAPI service with a health endpoint and reserved domain, solver, validation, and API boundaries.
- `supabase`: reserved migration and test locations only; no Supabase project or database is connected.
- `docs`: architecture, business rules, decisions, test plan, and AI governance.

## Prerequisites

- Node.js 24 or later
- pnpm 11.21.0
- Python 3.12
- Docker (optional, for the optimizer container)

## Local installation

```bash
pnpm install --frozen-lockfile
python3.12 -m venv services/optimizer/.venv
services/optimizer/.venv/bin/python -m pip install --upgrade pip
services/optimizer/.venv/bin/python -m pip install -r services/optimizer/requirements-dev.lock
services/optimizer/.venv/bin/python -m pip install --no-deps -e services/optimizer
```

Copy the example configuration only when local configuration becomes necessary. Never add real secrets to `.env` files tracked by Git.

## Development commands

```bash
pnpm dev:web
services/optimizer/.venv/bin/uvicorn app.main:app --app-dir services/optimizer --reload
```

The web app is served by Next.js, while the optimizer runs independently at `http://127.0.0.1:8000`. Its baseline health check is `GET /health`.

## Verification commands

```bash
pnpm typecheck
pnpm lint
pnpm test:web
pnpm build
(cd services/optimizer && .venv/bin/ruff check .)
(cd services/optimizer && .venv/bin/pytest)
curl --fail http://127.0.0.1:8000/health
```

## Current limitations

Only the repository foundation and health endpoint exist. The project has no connected database, authentication, route solver, document processing, maps, live tracking, AI integration, or deployment configuration.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the planned boundaries and documented original requirements.
