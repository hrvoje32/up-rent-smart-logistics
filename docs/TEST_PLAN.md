# Test Plan

## Scope

Task 00 verifies only the rendering baseline and optimizer liveness endpoint. It intentionally does not claim coverage for unimplemented logistics behavior.

## Test strategy

- **Frontend unit/render tests:** Vitest and Testing Library exercise small components and rendered pages.
- **Backend unit/API tests:** pytest and FastAPI TestClient validate schemas and endpoint behavior without external services.
- **Integration tests:** later tests will exercise the typed frontend-to-optimizer contract and isolated database integrations.
- **Solver tests:** later tests will cover capacity, pickup-before-delivery, same-vehicle, daily-duration, depot-return, unserviceable-order, objective, and independent-validator cases.
- **Security tests:** later tests will verify authentication, authorization, RLS policies, input validation, secret handling, and unsafe file/document rejection.
- **End-to-end tests:** later browser tests will cover dispatcher and driver flows against controlled local test data.

## Current test cases

| Test | Tool | Expected result |
| --- | --- | --- |
| Web foundation render | Vitest + Testing Library | Planner title and foundation message render |
| Optimizer health | pytest + FastAPI TestClient | `GET /health` returns HTTP 200 and structured success payload |

CI runs dependency installation, frontend type checking/linting/tests/build, plus Python Ruff and pytest.
