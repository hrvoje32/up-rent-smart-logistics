# UP RENT Smart Logistics Planner

Tasks 00–05 establish the local repository foundation, canonical planning input, independent validator, OR-Tools engine, local FastAPI contract, and a local dispatcher dashboard. Maps, authentication, database integration, AI, and GPS functionality are deliberately not implemented.

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

Set `OPTIMIZER_API_URL=http://127.0.0.1:8000` in `apps/web/.env.local` (see `apps/web/.env.example`), then open `http://localhost:3000/admin/optimizer`. The web app is served by Next.js, while the optimizer runs independently at `http://127.0.0.1:8000`. Bind the optimizer to `127.0.0.1` for local development. Its OpenAPI UI is available at `http://127.0.0.1:8000/docs`.

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

## Local optimizer dashboard

`/admin/optimizer` loads its canonical dataset server-side from `GET /api/v1/demo-case`. The browser never receives `OPTIMIZER_API_URL` and never calls FastAPI directly. Its only interactive request is same-origin `POST /api/optimizer`; that route obtains a fresh canonical dataset server-side, submits a bounded fixed solve to FastAPI, and returns the result.

The route is deliberately disabled when `NODE_ENV=production` and rejects a missing or mismatched `Origin`/`Host`. It is a local controlled-demo safeguard, not authentication. The frontend's lightweight runtime contract checks FastAPI payloads at the boundary; FastAPI's OpenAPI document remains the authoritative schema. Do not publish or proxy this dashboard until a later task adds real identity, authorization, CSRF design, and deployment controls.

The result view always renders both trucks, including a valid idle truck. It shows trusted per-truck route distance, completed orders, driving time, pickup/loading service, delivery/unloading service, combined service, and total elapsed time. The combined summary makes the combined distance, each truck's distance, baseline, reduction, and aggregate time breakdown visible before route detail. Durations preserve seconds; combined elapsed time is explicitly a sum of truck durations, not a parallel-operation wall-clock estimate.

Each result card also includes a chronological **SIMULATED PLANNED TIMES** timeline. Its configurable local start time defaults to `08:00`; it derives each rounded segment's travel time and each ordered 20-minute pickup/delivery operation from the validated route returned by FastAPI. It is not GPS, traffic, shift, or actual-driver telemetry. The card labels cross-midnight times, preserves repeated locations and multiple actions at one stop, and compares its derived duration to the API's trusted elapsed metric.

The optional **Distance Analysis** disclosure compares the authoritative Euclidean totals with an *Estimated road distance (simulation)*. It applies a user-selected integer circuity scale from 1.00× to 1.80× in 0.05 steps, rounds only the validated route total half-up to 0.1 km, and assumes 60 km/h for estimated driving. It does not call another solver, alter route order/timeline, or represent actual roads, traffic, GPS, or compliance. A scenario warning appears if its estimated driving time exceeds nine hours.

Every route card finishes with a print-friendly **Final transport report**. It reuses the validated metrics and simulated timeline to report capacity, active/idle state, simulation date/time and depot facts, time and distance breakdowns, operations, loads, validation, unserved-order diagnostics, and explicitly unscheduled breaks. The global print action hides navigation and controls while retaining critical tables and report content.

## Current limitations

The project has no connected database, authentication, document processing, maps, live tracking, AI integration, or deployment configuration. The API and dashboard are for controlled local demo use only. Solver results can vary by OR-Tools version, hardware, and bounded search settings; no global optimum is claimed.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/BUSINESS_RULES.md](docs/BUSINESS_RULES.md) for the planned boundaries and documented original requirements.
# Editable planning scenarios (Task 05D)

The optimizer dashboard now includes browser-local planning scenarios. **Original assessment** always reloads from the immutable `fixtures/up_rent_case.json` source exposed by the local API and is read-only. Custom scenarios are separate browser-local copies with CRUD for vehicles, locations, machine types, machines, and transport orders.

Custom scenarios and named route snapshots use versioned `localStorage` records. They are not shared across browsers, devices, or users; clearing browser site data removes them. Import/export is versioned JSON and validates references before accepting a new custom scenario. Saved routes retain their source scenario revision and display as older when that scenario has changed.

Custom optimization is accepted only by the same-origin Next.js route in local development. Production remains fail-closed. The original solver objective, canonical fixture, Euclidean calculations, and route validation are unchanged.

## Local optimization history

Every completed local optimization request is stored as an immutable browser-local run in the business workspace. A run preserves its timestamp, plan name, selected vehicles and orders, strategy, required-vehicle setting, exact submitted dataset, and returned validation/result metrics. The optimizer page presents these records in an expandable **Povijest optimizacija** section; a historical selection can be copied into a separate editable draft or safely deleted without changing any other run. The dashboard reads the same workspace and shows only the real latest-run metrics. As with all workspace data, history is local to the current browser and is removed when site data is cleared.
