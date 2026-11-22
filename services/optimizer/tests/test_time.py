from datetime import datetime

from app.domain.dataset import load_canonical_dataset
from app.domain.models import (
    Location,
    Machine,
    PlanningDataset,
    PlanningParameters,
    TransportOrder,
    Vehicle,
)
from app.domain.time import (
    delivery_service_time_seconds,
    driving_time_seconds,
    pickup_service_time_seconds,
    planned_elapsed_time_seconds,
)
from app.solver.engine import optimize_plan
from app.solver.models import OptimizationStatus, SolverSettings


def test_driving_time_is_calculated_separately_at_canonical_speed() -> None:
    vehicle = load_canonical_dataset().vehicles[0]

    assert driving_time_seconds(10, vehicle) == 60
    assert driving_time_seconds(85, vehicle) == 510


def test_pickup_delivery_and_elapsed_service_times_are_correct() -> None:
    dataset = load_canonical_dataset()
    vehicle = dataset.vehicles[0]
    parameters = dataset.parameters

    assert parameters.max_driving_seconds == 32400
    assert pickup_service_time_seconds(2, parameters) == 2400
    assert delivery_service_time_seconds(3, parameters) == 3600
    elapsed_seconds = planned_elapsed_time_seconds(
        85, vehicle, parameters, pickup_count=2, delivery_count=3
    )
    assert elapsed_seconds == 6510


def test_earliest_pickup_creates_waiting_without_changing_driving_limit() -> None:
    dataset = PlanningDataset(
        vehicles=[
            Vehicle(
                id="A",
                max_payload_kg=1000,
                max_simultaneous_machines=1,
                start_location_id="L0",
                end_location_id="L0",
                average_speed_kmh=60,
            )
        ],
        machines=[Machine(id="M01", weight_kg=100)],
        locations=[Location(id="L0", x=0, y=0), Location(id="L1", x=1, y=0)],
        orders=[
            TransportOrder(
                id="N01",
                machine_id="M01",
                pickup_location_id="L0",
                delivery_location_id="L1",
                earliest_pickup_at=datetime.fromisoformat("2026-01-01T08:30:00+01:00"),
                latest_pickup_at=datetime.fromisoformat("2026-01-01T09:00:00+01:00"),
                delivery_deadline_at=datetime.fromisoformat("2026-01-01T10:00:00+01:00"),
            )
        ],
        parameters=PlanningParameters(
            depot_location_id="L0",
            max_driving_minutes=540,
            pickup_service_minutes=20,
            delivery_service_minutes=20,
            planning_start_at=datetime.fromisoformat("2026-01-01T08:00:00+01:00"),
        ),
    )

    result = optimize_plan(dataset, SolverSettings(time_limit_seconds=1))

    assert result.status is OptimizationStatus.FEASIBLE
    assert result.validation_result is not None
    metric = result.validation_result.route_metrics[0]
    assert metric.waiting_time_seconds == 1800
    assert metric.driving_time_seconds == 120
    assert metric.total_elapsed_seconds == 4320
