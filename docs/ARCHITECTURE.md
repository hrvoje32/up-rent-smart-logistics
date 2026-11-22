# Architecture

## System components

The frontend is a Next.js App Router application in `apps/web`. It owns browser presentation, feature composition, and future authenticated user flows. It must not contain route-solving algorithms or privileged service credentials.

The optimizer is an independent FastAPI service in `services/optimizer`. It owns API schemas, canonical input validation, deterministic calculation utilities, future optimization orchestration, and independent solution validation. It exposes `GET /health`; Task 01 adds no planning endpoint or solver.

## Planning domain and source data

`fixtures/up_rent_case.json` is the canonical source for the original assessment case. The optimizer packages an exact tested copy at `services/optimizer/app/data/up_rent_case.json`, so `app.domain.dataset` can load it relative to its own module location after deployment without depending on the process working directory or the repository root. Pydantic models define `Vehicle`, `Machine`, `Location`, `TransportOrder`, `PlanningParameters`, and `PlanningDataset`.

Dataset-level validation owns unique IDs and cross-record references. Record-level validation owns positive quantities/durations and finite coordinates. Canonical input is never mutated; future scenario simulation must work from a separately loaded dataset instance.

`app.domain.distance` is a pure module. It rounds each Euclidean segment half-up to an integer number of tenths of a kilometre before any route sum. `app.domain.time` returns separate integer-second driving, pickup, delivery, and elapsed durations. The canonical 60 km/h speed makes one tenth of a kilometre exactly six seconds. The 540-minute rule is documented as driving time only.

## Independent route validation

`app.validation.models` defines immutable-by-convention input records: ordered actions remain nested beneath ordered stops and routes, preserving repeated visits and multiple actions at one location. It also defines structured violations, metrics, action-load snapshots, and validation results.

`app.validation.engine.validate_plan` is a side-effect-free domain service. It never invokes FastAPI or OR-Tools, and it recomputes distance/time from locations rather than accepting client metrics. It validates depots, known identifiers, action location/order, pickup/delivery sequencing and vehicle affinity, load and simultaneous-machine limits, final-empty loads, driving limits, completeness, and missing routes.

The canonical baseline builder is isolated in `app.validation.baseline`. It encodes only the requested non-optimized assignment strategy; the validation engine computes all resulting metrics independently.

## OR-Tools optimization

`app.solver.engine` is a local domain service independent of FastAPI, Supabase, frontend code, OpenAI, and external maps. It builds a `RoutingIndexManager` and `RoutingModel` using one logical node for the start depot, one for every pickup action, one for every delivery action, and a distinct end-depot node. Logical action nodes are never merged merely because their physical location IDs match.

Distance arc costs are Task 01 integer tenths of kilometres. Weight and machine dimensions apply positive pickup and negative delivery demand; start cumulative loads are zero and nonnegative capacity bounds are enforced. A per-vehicle driving-time dimension uses rounded arc distance and each vehicle's speed, without adding service duration to the 540-minute driving constraint. A constant positive visit-order dimension makes pickup strictly precede delivery even for zero-distance action pairs.

The extracted route is converted back to the Task 02 `TransportPlan` format and independently validated. The public result contains the original solver status, elapsed search time, settings, plan, trusted validation metrics, diagnostics, and a programmatic baseline comparison. Search status alone is never enough to claim success.

## FastAPI integration contract

`app.api.optimization` exposes the versioned local API without reimplementing any solver or validator logic. `GET /api/v1/demo-case` uses the path-independent canonical fixture loader. `POST /api/v1/optimize` accepts the existing `PlanningDataset` plus a constrained subclass of `SolverSettings`, then calls `optimize_plan` once.

The optimization path operation is synchronous, so FastAPI runs CPU-bound OR-Tools work in its standard sync worker context rather than blocking an async handler. A process-local `BoundedSemaphore(1)` rejects concurrent work with 503. This is deliberately simple local-demo protection, not distributed scheduling or rate limiting.

Request validation rejects unknown fields and enforces 256 KiB payloads, 20 vehicles, 100 locations, 100 orders, and a ten-second maximum search. An ASGI body-size middleware returns 413 before parsing excessive optimization payloads. The API returns the existing `OptimizationResult`, including exact integer 0.1-km and second units, independently recomputed validation data, and structured diagnostics.

`supabase/` is a future integration boundary for PostgreSQL migrations, Row Level Security policies, storage, authentication, and realtime capabilities. No Supabase client, project, schema, or credentials are present.

## Responsibility boundaries

| Boundary | Owns | Must not own |
| --- | --- | --- |
| Next.js web | UI, user interactions, typed API clients | Solver implementation, service secrets |
| FastAPI optimizer | API schemas, optimization, independent validation | Browser UI, authentication UI |
| Supabase (future) | Durable data, RLS, files, auth state | Route solving decisions |
| AI integration (future) | Server-side structured extraction and explanations | Unverified order persistence or final routing authority |

## Frontend/backend interaction

The local `/admin/optimizer` page obtains `GET /api/v1/demo-case` through a server-only Next.js module marked with `server-only`. `OPTIMIZER_API_URL` is server-only and must never use a `NEXT_PUBLIC_` prefix. The browser calls only the controlled same-origin `POST /api/optimizer` route, which discards client-supplied datasets/settings and constructs the fixed canonical request on the server.

That Next route denies requests in production builds and requires an exact `Origin`/`Host` match in the local demo. This is intentionally fail-closed until a later authentication and authorization design exists. The frontend has a small runtime parser for the fields it renders; FastAPI OpenAPI remains the source-of-truth integration schema. The optimizer returns validated results; frontend display code must not be treated as solver validation.

`apps/web/src/lib/route-timeline.ts` is a pure presentation projection, not a solver. It uses the returned ordered route/actions and snapshots with the immutable dataset's individually rounded Cartesian segments, vehicle speed, and service parameters to produce simulated arrival, service, and departure times. It neither mutates the optimization result nor submits calculated times to the backend. A timeline is compared to `RouteMetrics.total_elapsed_seconds` so any discrepancy remains visible.

`apps/web/src/lib/road-distance-estimate.ts` is a separate pure presentation calculation. It applies an integer circuity scale (100–180, in 5-point increments) to a trusted total in tenths of a kilometre and uses a single integer half-up conversion back to tenths. It never feeds estimated values into the solver, validator, official timeline, or FastAPI contract. Its assumed 60 km/h driving time and 9-hour scenario warning are explanatory only, not driver-rule compliance logic.

`VehicleTransportReport` is a reusable UI projection placed after the existing vehicle timeline. Its start/finish date and time are calculated from that timeline plus a user-selected simulated date, preserving seconds and midnight crossings. It exposes no driver assignment, break rule, or compliance decision: breaks are explicitly shown as unscheduled. Print styling is presentation-only and excludes app navigation/controls while preserving critical report content.

## Future data integration

Supabase PostgreSQL will store orders, fleet records, assignments, inspections, optimization history, and auditable approvals. Migrations and RLS policies will be reviewed before database access is enabled. Storage will hold approved documents rather than raw secrets.

## Future identity and authorization

Supabase Auth will provide identity. Authorization will be enforced with roles and Row Level Security, with separate dispatcher/admin and driver scopes. The frontend will not rely solely on hidden controls for authorization; protected API operations must validate identity and authorization server-side.
# Scenario persistence and CRUD

`apps/web/src/lib/planning-scenarios.ts` owns the versioned browser-local scenario model and validation. It enriches optimizer records with display-only fields (`display_name`, activity, depot marker, optional machine type, and order notes), then removes those fields before creating the bounded `DemoDataset` forwarded to FastAPI. The canonical scenario is reconstructed from the server-loaded dataset on each application load and is never persisted as editable data.

`ScenarioManager` provides local CRUD, import/export, reset, and named route snapshots. Entity deletion checks references first; saved route snapshots retain scenario ID/revision, solver output, and timestamp. The Next route remains same-origin and rejects every optimization request in production.
