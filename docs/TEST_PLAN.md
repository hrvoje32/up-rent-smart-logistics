# Test Plan

## Scope

Task 02 verifies the rendering/liveness baseline plus canonical data loading, deterministic calculations, and independent validation of proposed routes. It intentionally does not claim coverage for route optimization behavior.

## Test strategy

- **Frontend unit/render tests:** Vitest and Testing Library exercise small components and rendered pages.
- **Backend unit/API tests:** pytest and FastAPI TestClient validate schemas and endpoint behavior without external services.
- **Domain-calculation tests:** pytest checks the canonical fixture, cross-record validation, individually rounded segment distances, route totals, and separate service/driving durations without network or database access.
- **Route-validator tests:** pytest covers depot rules, action ordering, pickup/delivery pairing, same-vehicle handling, capacity/load snapshots, repeated stops, partial plans, deterministic results, and the canonical non-optimized baseline.
- **Optimizer tests:** pytest covers complete OR-Tools extraction, strict same-coordinate pickup/delivery ordering, capacity/driving limits, depot action nodes, immutable source data, programmatic baseline comparison, and infeasible overweight orders.
- **API integration tests:** FastAPI TestClient verifies the real canonical solve, OpenAPI contract, request validation, oversized bodies, bounded local concurrency, sanitized failures, and immutable demo fixture behavior without network or database services.
- **Integration tests:** later tests will exercise the typed frontend-to-optimizer contract and isolated database integrations.
- **Solver tests:** later tests will cover capacity, pickup-before-delivery, same-vehicle, daily-duration, depot-return, unserviceable-order, objective, and independent-validator cases.
- **Security tests:** later tests will verify authentication, authorization, RLS policies, input validation, secret handling, and unsafe file/document rejection.
- **End-to-end tests:** later browser tests will cover dispatcher and driver flows against controlled local test data.

## Current test cases

| Test | Tool | Expected result |
| --- | --- | --- |
| Web foundation render | Vitest + Testing Library | Planner title and foundation message render |
| Optimizer health | pytest + FastAPI TestClient | `GET /health` returns HTTP 200 and structured success payload |
| Canonical dataset and model validation | pytest + Pydantic | Original values load; invalid IDs, references, quantities, coordinates, and durations fail clearly |
| Distance engine | pytest | Symmetric matrix, zero diagonal, half-up segment rounding, and rounded-segment route totals |
| Time helpers | pytest | Driving, pickup, delivery, and elapsed seconds remain distinct |
| Independent route validator | pytest | Recomputed trusted metrics and structured violations for all original route rules |
| OR-Tools optimizer | pytest | A valid complete heuristic plan, independently verified and shorter than the baseline |
| FastAPI optimization API | pytest + TestClient | Typed demo/optimize contracts, safe limits, and structured status handling |

CI runs dependency installation, frontend type checking/linting/tests/build, plus Python Ruff and pytest.
