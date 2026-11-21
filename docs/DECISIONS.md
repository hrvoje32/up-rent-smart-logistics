# Architecture Decisions

## ADR-001: Next.js App Router for the frontend

Next.js provides a mature React application structure, server-rendering options for future protected workflows, and straightforward deployment flexibility. The App Router is selected for its current routing and layout model. TypeScript strict mode is mandatory to make frontend boundaries explicit.

## ADR-002: Python/FastAPI for optimization service

Python has the strongest ecosystem fit for OR-Tools. FastAPI offers typed request and response schemas through Pydantic, automatic API documentation, and an independently deployable process. The optimizer therefore remains separate from the frontend.

## ADR-003: Google OR-Tools for future routing

OR-Tools supports vehicle routing and constraint modeling suitable for pickup-before-delivery, capacities, duration constraints, and optimization objectives. An independent validation layer will remain necessary so solver output is checked against business rules.

## ADR-004: Supabase for future persistence and identity

Supabase combines PostgreSQL, Auth, Storage, Realtime, and Row Level Security. It is a future dependency only: Task 00 makes no external connection and creates no schema.

## Assumptions

- The optimizer API will be treated as a trusted server-to-server boundary after identity propagation and authorization design are introduced.
- Business constraints are documented before modeling so future implementation can trace requirements to tests.
- Exact dependency versions and lockfiles support repeatable local and CI installations.
- No external service configuration belongs in source control; examples document configuration keys without values.
