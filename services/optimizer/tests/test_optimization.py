from __future__ import annotations

from collections.abc import Iterator

import pytest

from app.domain.dataset import load_canonical_dataset
from app.domain.models import (
    Location,
    Machine,
    PlanningDataset,
    PlanningParameters,
    TransportOrder,
    Vehicle,
)
from app.solver.engine import optimize_plan
from app.solver.models import OptimizationResult, OptimizationStatus, SolverSettings
from app.validation.models import ActionType, TransportPlan


@pytest.fixture(scope="module")
def canonical_result() -> OptimizationResult:
    return optimize_plan(load_canonical_dataset(), SolverSettings(time_limit_seconds=1))


def _actions_by_order(plan: TransportPlan) -> dict[str, list[tuple[str, ActionType]]]:
    actions: dict[str, list[tuple[str, ActionType]]] = {}
    for route in plan.routes:
        for stop in route.stops:
            for action in stop.actions:
                actions.setdefault(action.order_id, []).append(
                    (route.vehicle_id, action.action_type)
                )
    return actions


def _same_coordinate_dataset() -> PlanningDataset:
    return PlanningDataset(
        vehicles=[
            Vehicle(
                id="A",
                max_payload_kg=1000,
                max_simultaneous_machines=1,
                start_location_id="L0",
                end_location_id="L0",
                average_speed_kmh=60,
            ),
            Vehicle(
                id="B",
                max_payload_kg=1000,
                max_simultaneous_machines=1,
                start_location_id="L0",
                end_location_id="L0",
                average_speed_kmh=60,
            ),
        ],
        machines=[Machine(id="M01", weight_kg=100)],
        locations=[Location(id="L0", x=0, y=0), Location(id="L1", x=5, y=0)],
        orders=[
            TransportOrder(
                id="N01",
                machine_id="M01",
                pickup_location_id="L1",
                delivery_location_id="L1",
            )
        ],
        parameters=PlanningParameters(
            depot_location_id="L0",
            max_driving_minutes=540,
            pickup_service_minutes=20,
            delivery_service_minutes=20,
        ),
    )


def _all_actions(plan: TransportPlan) -> Iterator[tuple[str, ActionType]]:
    for route in plan.routes:
        for stop in route.stops:
            for action in stop.actions:
                yield action.order_id, action.action_type


def test_canonical_optimization_is_complete_valid_and_strictly_beats_baseline(
    canonical_result: OptimizationResult,
) -> None:
    assert canonical_result.status is OptimizationStatus.FEASIBLE
    assert canonical_result.plan is not None
    assert canonical_result.validation_result is not None
    assert canonical_result.validation_result.is_valid is True
    assert canonical_result.validation_result.is_complete is True
    assert canonical_result.baseline_comparison is not None
    assert canonical_result.baseline_comparison.optimized_distance_tenths_km < (
        canonical_result.baseline_comparison.baseline_distance_tenths_km
    )


def test_all_canonical_orders_are_completed_once_by_one_vehicle(
    canonical_result: OptimizationResult,
) -> None:
    assert canonical_result.plan is not None
    actions_by_order = _actions_by_order(canonical_result.plan)

    assert set(actions_by_order) == {f"N{number:02d}" for number in range(1, 11)}
    for actions in actions_by_order.values():
        assert [action_type for _, action_type in actions] == [
            ActionType.PICKUP,
            ActionType.DELIVERY,
        ]
        assert actions[0][0] == actions[1][0]


def test_routes_depots_loads_and_metrics_match_independent_validation(
    canonical_result: OptimizationResult,
) -> None:
    assert canonical_result.plan is not None
    assert canonical_result.validation_result is not None
    validation = canonical_result.validation_result

    for route in canonical_result.plan.routes:
        assert route.stops[0].location_id == "L0"
        assert route.stops[-1].location_id == "L0"
    assert canonical_result.baseline_comparison is not None
    assert validation.combined_distance_tenths_km == (
        canonical_result.baseline_comparison.optimized_distance_tenths_km
    )
    assert validation.combined_driving_time_seconds <= 32400
    assert validation.combined_total_service_seconds == 24000
    assert sum(metric.completed_order_count for metric in validation.route_metrics) == 10
    assert all(snapshot.load_kg >= 0 for snapshot in validation.load_snapshots)
    assert all(snapshot.machine_count >= 0 for snapshot in validation.load_snapshots)


def test_depot_actions_and_all_logical_action_nodes_are_preserved(
    canonical_result: OptimizationResult,
) -> None:
    assert canonical_result.plan is not None
    actions = list(_all_actions(canonical_result.plan))
    depot_actions = [
        (action.order_id, action.action_type)
        for route in canonical_result.plan.routes
        for stop in route.stops
        if stop.location_id == "L0"
        for action in stop.actions
    ]

    assert len(actions) == 20
    assert ("N05", ActionType.PICKUP) in depot_actions
    assert ("N04", ActionType.DELIVERY) in depot_actions


def test_equal_coordinate_pickup_delivery_nodes_keep_strict_action_order() -> None:
    result = optimize_plan(_same_coordinate_dataset(), SolverSettings(time_limit_seconds=1))

    assert result.status is OptimizationStatus.FEASIBLE
    assert result.plan is not None
    assert list(_all_actions(result.plan)) == [
        ("N01", ActionType.PICKUP),
        ("N01", ActionType.DELIVERY),
    ]


def test_a_vehicle_can_remain_idle_on_a_small_feasible_problem() -> None:
    result = optimize_plan(_same_coordinate_dataset(), SolverSettings(time_limit_seconds=1))

    assert result.status is OptimizationStatus.FEASIBLE
    assert result.plan is not None
    assert any(not route_stop.actions for route in result.plan.routes for route_stop in route.stops)
    assert any(
        sum(len(stop.actions) for stop in route.stops) == 0 for route in result.plan.routes
    )


def test_overweight_order_is_infeasible_and_never_reported_as_success() -> None:
    dataset = load_canonical_dataset().model_copy(deep=True)
    dataset.machines[0].weight_kg = 20000

    result = optimize_plan(dataset, SolverSettings(time_limit_seconds=1))

    assert result.status is OptimizationStatus.INFEASIBLE
    assert result.plan is None
    assert result.status is not OptimizationStatus.FEASIBLE


def test_optimizer_does_not_mutate_dataset_and_repeated_runs_remain_valid() -> None:
    dataset = load_canonical_dataset()
    dataset_before = dataset.model_dump(mode="json")

    first = optimize_plan(dataset, SolverSettings(time_limit_seconds=1))
    second = optimize_plan(dataset, SolverSettings(time_limit_seconds=1))

    assert dataset.model_dump(mode="json") == dataset_before
    assert first.status is OptimizationStatus.FEASIBLE
    assert second.status is OptimizationStatus.FEASIBLE
    assert first.validation_result is not None and first.validation_result.is_valid
    assert second.validation_result is not None and second.validation_result.is_valid


def test_search_uses_a_bounded_time_limit(canonical_result: OptimizationResult) -> None:
    assert canonical_result.solver_duration_seconds < 3
