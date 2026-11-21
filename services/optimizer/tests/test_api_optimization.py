from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.api import optimization
from app.main import app
from app.solver.models import OptimizationResult, OptimizationStatus, SolverSettings


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def demo_payload(client: TestClient) -> dict[str, object]:
    response = client.get("/api/v1/demo-case")
    assert response.status_code == 200
    return response.json()


def test_health_and_demo_case_return_canonical_data(client: TestClient) -> None:
    health = client.get("/health")
    demo_case = client.get("/api/v1/demo-case")

    assert health.status_code == 200
    assert health.json() == {"status": "ok", "service": "optimizer"}
    assert demo_case.status_code == 200
    assert len(demo_case.json()["vehicles"]) == 2
    assert len(demo_case.json()["machines"]) == 10
    assert len(demo_case.json()["locations"]) == 10
    assert len(demo_case.json()["orders"]) == 10


def test_optimize_canonical_dataset_executes_real_solver_and_returns_metrics(
    client: TestClient, demo_payload: dict[str, object]
) -> None:
    response = client.post(
        "/api/v1/optimize",
        json={"dataset": demo_payload, "settings": {"time_limit_seconds": 1}},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "FEASIBLE"
    assert body["validation_result"]["is_valid"] is True
    assert body["validation_result"]["is_complete"] is True
    assert len(body["plan"]["routes"]) == 2
    assert sum(body["validation_result"]["completed_order_counts"].values()) == 10
    assert len(body["validation_result"]["load_snapshots"]) == 20
    route_total = sum(
        metric["distance_tenths_km"] for metric in body["validation_result"]["route_metrics"]
    )
    assert body["validation_result"]["combined_distance_tenths_km"] == route_total
    assert body["baseline_comparison"]["optimized_distance_tenths_km"] == route_total
    assert body["baseline_comparison"]["distance_reduction_tenths_km"] > 0


@pytest.mark.parametrize(
    "mutation",
    [
        lambda payload: payload["orders"][0].update({"pickup_location_id": "L99"}),
        lambda payload: payload["orders"][0].update({"machine_id": "M99"}),
        lambda payload: payload["vehicles"][0].update({"max_payload_kg": 0}),
    ],
)
def test_invalid_dataset_references_and_capacities_return_422(
    client: TestClient, demo_payload: dict[str, object], mutation: object
) -> None:
    payload = deepcopy(demo_payload)
    assert callable(mutation)
    mutation(payload)

    response = client.post("/api/v1/optimize", json={"dataset": payload})

    assert response.status_code == 422


def test_unsupported_settings_and_oversized_requests_are_rejected(
    client: TestClient, demo_payload: dict[str, object]
) -> None:
    unsupported_settings = client.post(
        "/api/v1/optimize",
        json={
            "dataset": demo_payload,
            "settings": {"first_solution_strategy": "UNSUPPORTED"},
        },
    )
    oversized = client.post(
        "/api/v1/optimize",
        content=b"x" * 262_145,
        headers={"content-type": "application/json"},
    )

    assert unsupported_settings.status_code == 422
    assert oversized.status_code == 413


def test_overweight_order_is_returned_as_a_structured_business_outcome(
    client: TestClient, demo_payload: dict[str, object]
) -> None:
    payload = deepcopy(demo_payload)
    payload["machines"][0]["weight_kg"] = 20_000

    response = client.post("/api/v1/optimize", json={"dataset": payload})

    assert response.status_code == 200
    assert response.json()["status"] == "INFEASIBLE"
    assert response.json()["violations"][0]["code"] == "UNSERVICEABLE_ORDER"


def test_no_solution_status_is_not_remapped_to_success(
    client: TestClient, demo_payload: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    def no_solution(*_args: object, **_kwargs: object) -> OptimizationResult:
        return OptimizationResult(
            status=OptimizationStatus.NO_SOLUTION_FOUND,
            solver_duration_seconds=0,
            settings=SolverSettings(),
        )

    monkeypatch.setattr(optimization, "optimize_plan", no_solution)

    response = client.post("/api/v1/optimize", json={"dataset": demo_payload})

    assert response.status_code == 200
    assert response.json()["status"] == "NO_SOLUTION_FOUND"


def test_internal_error_is_sanitized_and_busy_capacity_returns_503(
    client: TestClient, demo_payload: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing_solver(*_args: object, **_kwargs: object) -> OptimizationResult:
        raise RuntimeError("/private/secret/internal traceback")

    monkeypatch.setattr(optimization, "optimize_plan", failing_solver)
    failed_response = client.post("/api/v1/optimize", json={"dataset": demo_payload})

    assert failed_response.status_code == 500
    assert "/private/secret" not in failed_response.text

    monkeypatch.undo()
    acquired = optimization.optimization_semaphore.acquire(blocking=False)
    assert acquired is True
    try:
        busy_response = client.post("/api/v1/optimize", json={"dataset": demo_payload})
    finally:
        optimization.optimization_semaphore.release()

    assert busy_response.status_code == 503


def test_demo_fixture_is_independent_across_requests_and_openapi_is_available(
    client: TestClient,
) -> None:
    first_demo = client.get("/api/v1/demo-case")
    second_demo = client.get("/api/v1/demo-case")
    schema = client.get("/openapi.json")

    assert first_demo.json() == second_demo.json()
    assert schema.status_code == 200
    assert "/api/v1/optimize" in schema.json()["paths"]
    assert "OptimizeRequest" in schema.json()["components"]["schemas"]
