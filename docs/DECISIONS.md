# Architecture Decisions

## ADR-001: Next.js App Router for the frontend

Next.js provides a mature React application structure, server-rendering options for future protected workflows, and straightforward deployment flexibility. The App Router is selected for its current routing and layout model. TypeScript strict mode is mandatory to make frontend boundaries explicit.

## ADR-002: Python/FastAPI for optimization service

Python has the strongest ecosystem fit for OR-Tools. FastAPI offers typed request and response schemas through Pydantic, automatic API documentation, and an independently deployable process. The optimizer therefore remains separate from the frontend.

## ADR-003: Google OR-Tools for future routing

OR-Tools supports vehicle routing and constraint modeling suitable for pickup-before-delivery, capacities, duration constraints, and optimization objectives. An independent validation layer will remain necessary so solver output is checked against business rules.

## ADR-004: Supabase for future persistence and identity

Supabase combines PostgreSQL, Auth, Storage, Realtime, and Row Level Security. It is a future dependency only: Task 00 makes no external connection and creates no schema.

## ADR-005: OR-Tools routing with independent validation

The solver uses Google OR-Tools' routing model because it directly supports vehicle-specific capacities and paired pickup/delivery visits. Pickup and delivery remain separate logical nodes even at identical coordinates. OR-Tools establishes a candidate plan; it is not the authority for correctness. Every extraction is validated by the independent Task 02 engine before a public result is marked feasible.

The sole objective is total rounded Cartesian distance in integer tenths of kilometres. Search is intentionally time-bounded and heuristic, so the application reports feasibility rather than claiming a global optimum. Driving time is a travel-only dimension, while service time is calculated separately after extraction.

## ADR-006: Synchronous local FastAPI optimization interface

The Task 04 API uses synchronous FastAPI path operations because OR-Tools solving is CPU-bound and blocking. It invokes the existing optimizer and returns its existing typed result rather than recreating solver schemas. A local process-wide semaphore permits one concurrent solve, and a strict request envelope limits body size, entity counts, and solver duration.

This is not public-production security: authentication, distributed rate limiting, background jobs, and shared workload coordination remain future work. The intended local command binds Uvicorn to loopback.

## ADR-007: Server-mediated local dashboard integration

The Task 05 dashboard keeps `OPTIMIZER_API_URL` in a server-only Next.js module and makes the browser call only `POST /api/optimizer`. The Next route reads the canonical dataset itself and uses fixed, bounded settings, preventing browser callers from choosing an upstream URL, inserting a dataset, or expanding solver limits. It is denied in production builds and enforces local same-origin requests.

A narrow TypeScript runtime parser validates FastAPI responses before presentation. It exists to fail safely at the JavaScript boundary; it does not supersede FastAPI's OpenAPI schema or the backend's independent validation result. Authentication and CSRF policy are still required before any production enablement.

## Python compatibility finding

The checked runtime and virtual environment are Python 3.12.5, matching the project constraint `>=3.12,<3.13`. FastAPI 0.115.12, Pydantic 2.10.6, OR-Tools 9.11.4210, and Protobuf 5.26.1 run successfully. Current warnings mention future Python 3.14 C-extension behavior, not an active Python 3.12 incompatibility, so dependencies were intentionally left pinned.

## Assumptions

- The optimizer API will be treated as a trusted server-to-server boundary after identity propagation and authorization design are introduced.
- Business constraints are documented before modeling so future implementation can trace requirements to tests.
- Exact dependency versions and lockfiles support repeatable local and CI installations.
- No external service configuration belongs in source control; examples document configuration keys without values.
