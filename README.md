# UP RENT Smart Logistics Planner

Tasks 00–04 establish the local repository foundation, canonical planning input, independent validator, OR-Tools engine, and a local FastAPI optimization contract. User workflows, maps, authentication, database integration, AI, and GPS functionality are deliberately not implemented.

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

The web app is served by Next.js, while the optimizer runs independently at `http://127.0.0.1:8000`. Bind the optimizer to `127.0.0.1` for local development. Its OpenAPI UI is available at `http://127.0.0.1:8000/docs`.

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

## Local optimization API

- `GET /health` returns service liveness.
- `GET /api/v1/demo-case` returns a freshly loaded canonical fixture; it does not write a database or mutate shared state.
- `POST /api/v1/optimize` accepts `{ "dataset": PlanningDataset, "settings": ApiSolverSettings }` and returns the existing typed `OptimizationResult` contract.

Result distances use `*_tenths_km` integer units (0.1 km); `*_kg` is kilograms; `machine_count` is simultaneous machines; `*_seconds` is seconds; and `distance_reduction_percentage` is a percentage. The response nests independent validation, ordered actions, load snapshots, route metrics, baseline comparison, and structured diagnostics.

The local demo limits a request to 256 KiB, 20 vehicles, 100 locations, 100 orders, 10 solver seconds, and one concurrent in-process solve. Invalid input returns 422, oversize input 413, busy capacity 503, and sanitized unexpected failures 500. Business outcomes such as `INFEASIBLE` and `NO_SOLUTION_FOUND` remain structured 200 responses. This in-process guard is not a distributed rate limiter.

No CORS policy is enabled and no authentication exists yet. Keep the service loopback-bound; do not expose it publicly before the planned authentication and deployment work.

## Current limitations

The project has no connected database, authentication, document processing, maps, live tracking, AI integration, frontend planning screens, or deployment configuration. The API is for controlled local demo use only. Solver results can vary by OR-Tools version, hardware, and bounded search settings; no global optimum is claimed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the planned boundaries and documented original requirements.
