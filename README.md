# UP RENT Smart Logistics Planner

A full-stack prototype for planning the transport of rental machines between simulated locations. It assigns transport orders to trucks, calculates an efficient visit order, and verifies that every proposed route respects the business constraints.

The focus of this project is not just finding a short route. Every result is independently validated for payload, number of machines, pickup/delivery order, return to depot, and driving-time limits.

**Live demo:** [up-rent-smart-logistic.vercel.app](https://up-rent-smart-logistic.vercel.app)

## What I built

- Editable transport orders, fleet, machines and locations
- Pickup-and-delivery route optimization with OR-Tools
- Separate FastAPI optimizer and Next.js dashboard
- Independent route validator, separate from the solver
- Per-truck route summaries, timelines and load after every operation
- Interactive Cartesian route map with vehicle and stop selection
- Infeasible-order diagnostics in Croatian
- Saved planning drafts and immutable optimization history
- CSV export and print-friendly/PDF transport report
- Supabase login, RLS-protected workspace backup and private production optimizer access

## Business rules covered

The canonical UP RENT dataset contains two trucks, ten machines, ten locations and ten transport orders.

| Rule | How it is handled |
| --- | --- |
| Payload | The truck load can never exceed the configured payload in kg. |
| Machine count | The configured simultaneous-machine limit is checked after every action. |
| Pickup before delivery | Every machine must be picked up before it is delivered. |
| Same vehicle | Pickup and delivery for one order must use the same truck. |
| Depot return | Every used route starts and ends at the depot. |
| Driving limit | Driving time is limited to 9 hours / 540 minutes. Service time is shown separately. |
| Service duration | Loading and unloading each take 20 simulated minutes. |

Distances use the assignment's Cartesian coordinates. Each segment is rounded half-up to 0.1 km before totals are calculated. The map and the timeline are simulations; they do not claim to use real traffic, GPS or driver-shift data.

## Architecture

```text
Browser
  │
  ▼
Next.js dashboard (apps/web)
  │  authenticated same-origin API call
  ▼
FastAPI optimizer (services/optimizer)
  │
  ├─ OR-Tools pickup & delivery solver
  └─ Independent deterministic validator

Supabase
  ├─ Authentication
  └─ RLS-protected workspace snapshot (optional cloud backup)
```

- **Frontend:** Next.js 16, React, TypeScript and CSS
- **Optimizer:** Python 3.12, FastAPI, Pydantic and OR-Tools
- **Persistence:** browser-local workspace for the fast demo workflow, with an optional Supabase JSON workspace snapshot per authenticated user
- **Production:** Vercel Services keeps FastAPI/OR-Tools private; the browser only talks to Next.js

The route validator deliberately does not depend on OR-Tools or FastAPI. It recalculates the route from the returned stops/actions and rejects plans that violate the rules.

## Run locally

### Prerequisites

- Node.js 24+
- pnpm 11.21.0
- Python 3.12

### Install

```bash
git clone https://github.com/hrvoje32/up-rent-smart-logistics.git
cd up-rent-smart-logistics

pnpm install --frozen-lockfile

python3.12 -m venv services/optimizer/.venv
services/optimizer/.venv/bin/python -m pip install --upgrade pip
services/optimizer/.venv/bin/python -m pip install -r services/optimizer/requirements-dev.lock
services/optimizer/.venv/bin/python -m pip install --no-deps -e services/optimizer
```

Create `apps/web/.env.local`:

```env
OPTIMIZER_API_URL=http://127.0.0.1:8000
```

Start the two services in separate terminals:

```bash
# Terminal 1: FastAPI and OR-Tools
services/optimizer/.venv/bin/uvicorn app.main:app --app-dir services/optimizer --reload
```

```bash
# Terminal 2: Next.js
pnpm dev:web
```

Open [http://localhost:3000](http://localhost:3000). The FastAPI OpenAPI page is available at [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

Supabase variables are optional for the local optimization demo. Without them, the application runs local-first. To test the hosted login and workspace backup, add the following to `apps/web/.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Never commit `.env.local` or a Supabase secret key.

## Verification

Run from the repository root:

```bash
pnpm typecheck
pnpm lint
pnpm test:web
pnpm build

(cd services/optimizer && .venv/bin/ruff check .)
(cd services/optimizer && .venv/bin/pytest -q)
```

The test suite includes focused coverage for, among other cases:

- overweight M10 transport with only Truck A
- valid M10 transport with Truck B
- pickup-before-delivery and same-vehicle requirements
- depot pickups and deliveries
- multiple actions at one stop and cross-midnight schedules
- idle vehicles
- invalid location references, deadlines and vehicle constraints
- no mutation of optimization results by the reporting/timeline UI
- RLS owner versus cross-user access checks in an isolated local Supabase stack

## API overview

The FastAPI service is intended to be loopback-only in local development and private in production.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health check |
| `GET /api/v1/demo-case` | Canonical assignment dataset |
| `POST /api/v1/optimize` | Validate input, run OR-Tools and return validated result |

In the web app, the browser calls the same-origin `POST /api/optimizer` route. The Next.js server verifies the production session and invokes the private FastAPI service. The FastAPI URL is never exposed to the browser.

## Cloud workspace note

The demo is intentionally **local-first**: normal editing is stored in the browser for a fast, self-contained exercise workflow. Supabase is used for authentication, RLS and an optional private cloud snapshot of the whole workspace.

The cloud snapshot is not a normalized production database yet, and it is not automatically loaded on every page visit. This is a conscious prototype boundary; a next iteration would make Supabase the primary source of truth and remove the manual backup/merge step.

Setup and RLS notes are in [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md). Vercel configuration details are in [docs/VERCEL_DEPLOYMENT.md](docs/VERCEL_DEPLOYMENT.md).

## Current limitations / next steps

- Simulated X/Y locations, not real road maps
- No traffic prediction, GPS tracking or real driver-shift management
- No public user registration
- Cloud workspace is a versioned JSON snapshot rather than normalized business tables
- Optimizer search is bounded, so a feasible result is not presented as a mathematical global optimum

## AI usage

AI tools were used as a development assistant for implementation, code review, test ideas and documentation. I reviewed generated suggestions against the assignment requirements, kept the solver and validator deterministic, and verified important business constraints with automated tests. AI output is never treated as an operational source of truth.

See [docs/AI_USAGE.md](docs/AI_USAGE.md) for the planned product-facing AI safeguards.

## Project structure

```text
apps/web/             Next.js dashboard and same-origin API routes
services/optimizer/   FastAPI, domain models, solver and independent validator
fixtures/             Canonical UP RENT input data
supabase/             RLS migration and local pgTAP tests
docs/                 Architecture, deployment and AI-use notes
```
