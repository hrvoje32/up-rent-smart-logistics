# UP RENT Smart Logistics Planner

Tasks 00–03 establish the local repository foundation, canonical planning input, independent validator, and OR-Tools pickup-and-delivery optimization engine. Product APIs, user workflows, maps, authentication, database integration, AI, and GPS functionality are deliberately not implemented.

## Architecture summary

- `apps/web`: Next.js App Router frontend, React, TypeScript, Tailwind CSS, and a shadcn/ui-compatible component layout.
- `services/optimizer`: independent FastAPI service with a health endpoint, validated domain models, canonical dataset loader, pure distance/time utilities, an independent route validator, and a local OR-Tools solver module.
- `fixtures/up_rent_case.json`: canonical original assessment input; scenario work must load a separate instance rather than modify this source fixture.
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

The canonical dataset and its models can be loaded from any current working directory because the loader resolves the fixture path from its module location.

## Dataset and calculation conventions

`fixtures/up_rent_case.json` contains vehicles, machines, Cartesian locations, orders, and shared planning parameters. Pydantic validates identifier uniqueness, positive limits and durations, finite coordinates, and cross-record machine/location/depot references.

Distances use Euclidean geometry. Every segment is rounded **half-up** to one decimal kilometre, stored as integer tenths of kilometres, then summed. For example, 8.5 km is stored as `85`. Route totals never round only once at the end.

At the source-data speed of 60 km/h, one tenth of a kilometre takes six seconds. Driving seconds, pickup service seconds, delivery service seconds, and total elapsed seconds are calculated separately. The 540-minute maximum is a driving-time limit, not a total elapsed-working-time limit. Pickup at L0 and delivery at L0 are valid operations.

## Independent route validation

`app.validation` contains strongly typed routes (`TransportPlan`, `VehicleRoute`, `RouteStop`, and ordered `TransportAction` records) plus `validate_plan(dataset, plan)`. The validator has no OR-Tools, FastAPI, database, or external-service dependency. It recomputes all distance and timing metrics from ordered stops, tracks load after every action, and returns structured violations with stable codes such as `WEIGHT_CAPACITY_EXCEEDED`, `DELIVERY_BEFORE_PICKUP`, and `INVALID_DEPOT_RETURN`.

Validation distinguishes `is_valid` (no business-rule violations) from `is_complete` (every order has one valid, same-vehicle pickup/delivery pair). Depot-only idle routes, repeated locations, intermediate depot visits, and explicit depot pickup/delivery actions are supported.

`build_canonical_baseline_plan()` supplies an intentionally inefficient comparison plan: Truck A is idle and Truck B handles one order at a time, returning to L0 between orders. The validator derives—not hardcodes—its 477.2 km distance, 477.2 driving minutes, 400 service minutes, and 877.2 total elapsed minutes.

## OR-Tools optimization

`app.solver.optimize_plan(dataset, settings)` creates separate logical nodes for every pickup and delivery action, including actions at the same physical location or at L0. It minimizes the combined Task 01 rounded-distance cost subject to same-vehicle pickup/delivery, strict visit ordering, weight and machine-count capacity dimensions, and travel-only driving-time limits.

The solver returns an extracted `TransportPlan` that is always passed through the independent validator. Only a complete, independently valid result is labelled `FEASIBLE`; otherwise it is `INFEASIBLE`, `NO_SOLUTION_FOUND`, `VALIDATION_FAILED`, or `ERROR`. Default search uses `PARALLEL_CHEAPEST_INSERTION`, `GUIDED_LOCAL_SEARCH`, and a five-second limit. A feasible heuristic result is not a claim of global optimality.

## Current limitations

The project has no connected database, authentication, optimization API endpoint, document processing, maps, live tracking, AI integration, frontend planning screens, or deployment configuration. Solver results can vary by OR-Tools version, hardware, and bounded search settings; no global optimum is claimed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the planned boundaries and documented original requirements.
