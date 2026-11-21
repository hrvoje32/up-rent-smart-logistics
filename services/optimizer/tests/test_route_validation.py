from __future__ import annotations

from app.domain.dataset import load_canonical_dataset
from app.validation.baseline import build_canonical_baseline_plan
from app.validation.engine import validate_plan
from app.validation.models import (
    ActionType,
    RouteStop,
    TransportAction,
    TransportPlan,
    ValidationErrorCode,
    VehicleRoute,
)


def _action(order_id: str, action_type: ActionType) -> TransportAction:
    return TransportAction(order_id=order_id, action_type=action_type)


def _stop(location_id: str, *actions: TransportAction) -> RouteStop:
    return RouteStop(location_id=location_id, actions=list(actions))


def _route(vehicle_id: str, *stops: RouteStop) -> VehicleRoute:
    return VehicleRoute(vehicle_id=vehicle_id, stops=list(stops))


def _single_order_plan() -> TransportPlan:
    return TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L1", _action("N01", ActionType.PICKUP)),
                _stop("L3", _action("N01", ActionType.DELIVERY)),
                _stop("L0"),
            ),
        ]
    )


def _codes(result: object) -> set[ValidationErrorCode]:
    from app.validation.models import ValidationResult

    assert isinstance(result, ValidationResult)
    return {violation.code for violation in result.violations}


def test_valid_pickup_delivery_tracks_load_metrics_and_completion() -> None:
    result = validate_plan(load_canonical_dataset(), _single_order_plan())
    truck_b_metric = next(metric for metric in result.route_metrics if metric.vehicle_id == "B")

    assert result.completed_order_counts == {"A": 0, "B": 1}
    assert [snapshot.load_kg for snapshot in result.load_snapshots[:2]] == [800, 0]
    assert [snapshot.machine_count for snapshot in result.load_snapshots[:2]] == [1, 0]
    assert truck_b_metric.distance_tenths_km == 417
    assert result.combined_distance_tenths_km == 417
    assert "N01" not in result.unserved_order_ids


def test_canonical_baseline_is_complete_valid_and_not_optimized() -> None:
    dataset = load_canonical_dataset()
    result = validate_plan(dataset, build_canonical_baseline_plan(dataset))

    assert result.is_valid is True
    assert result.is_complete is True
    assert result.completed_order_counts == {"A": 0, "B": 10}
    assert result.combined_distance_tenths_km == 4772
    assert result.combined_driving_time_seconds == 28632
    assert result.combined_total_service_seconds == 24000
    assert result.combined_total_elapsed_seconds == 52632
    assert result.combined_driving_time_seconds < dataset.parameters.max_driving_seconds
    assert ValidationErrorCode.UNDELIVERED_LOAD not in _codes(result)


def test_invalid_depot_start_and_return_are_reported() -> None:
    plan = TransportPlan(routes=[_route("A", _stop("L1")), _route("B", _stop("L0"), _stop("L1"))])

    result = validate_plan(load_canonical_dataset(), plan)

    assert ValidationErrorCode.INVALID_DEPOT_START in _codes(result)
    assert ValidationErrorCode.INVALID_DEPOT_RETURN in _codes(result)


def test_weight_and_simultaneous_machine_capacity_are_checked_after_actions() -> None:
    plan = TransportPlan(
        routes=[
            _route(
                "A",
                _stop("L0"),
                _stop("L1", _action("N01", ActionType.PICKUP)),
                _stop("L2", _action("N02", ActionType.PICKUP)),
                _stop("L9", _action("N03", ActionType.PICKUP)),
                _stop("L0"),
            ),
            _route("B", _stop("L0")),
        ]
    )

    result = validate_plan(load_canonical_dataset(), plan)

    assert ValidationErrorCode.WEIGHT_CAPACITY_EXCEEDED in _codes(result)
    assert ValidationErrorCode.MACHINE_COUNT_EXCEEDED in _codes(result)
    assert result.load_snapshots[-1].load_kg == 3900
    assert result.load_snapshots[-1].machine_count == 3


def test_delivery_before_pickup_and_cross_vehicle_delivery_are_distinguished() -> None:
    before_pickup = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L3", _action("N01", ActionType.DELIVERY)),
                _stop("L0"),
            ),
        ]
    )
    cross_vehicle = TransportPlan(
        routes=[
            _route(
                "A",
                _stop("L0"),
                _stop("L1", _action("N01", ActionType.PICKUP)),
                _stop("L0"),
            ),
            _route(
                "B",
                _stop("L0"),
                _stop("L3", _action("N01", ActionType.DELIVERY)),
                _stop("L0"),
            ),
        ]
    )

    assert ValidationErrorCode.DELIVERY_BEFORE_PICKUP in _codes(
        validate_plan(load_canonical_dataset(), before_pickup)
    )
    assert ValidationErrorCode.CROSS_VEHICLE_DELIVERY in _codes(
        validate_plan(load_canonical_dataset(), cross_vehicle)
    )


def test_duplicate_and_missing_actions_are_reported() -> None:
    duplicate_plan = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop(
                    "L1",
                    _action("N01", ActionType.PICKUP),
                    _action("N01", ActionType.PICKUP),
                ),
                _stop(
                    "L3",
                    _action("N01", ActionType.DELIVERY),
                    _action("N01", ActionType.DELIVERY),
                ),
                _stop("L0"),
            ),
        ]
    )
    missing_plan = TransportPlan(routes=[_route("A", _stop("L0")), _route("B", _stop("L0"))])

    duplicate_codes = _codes(validate_plan(load_canonical_dataset(), duplicate_plan))
    missing_codes = _codes(validate_plan(load_canonical_dataset(), missing_plan))

    assert ValidationErrorCode.DUPLICATE_PICKUP in duplicate_codes
    assert ValidationErrorCode.DUPLICATE_DELIVERY in duplicate_codes
    assert ValidationErrorCode.MISSING_PICKUP in missing_codes
    assert ValidationErrorCode.MISSING_DELIVERY in missing_codes


def test_wrong_pickup_and_delivery_locations_are_reported() -> None:
    wrong_pickup = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L2", _action("N01", ActionType.PICKUP)),
                _stop("L3", _action("N01", ActionType.DELIVERY)),
                _stop("L0"),
            ),
        ]
    )
    wrong_delivery = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L1", _action("N01", ActionType.PICKUP)),
                _stop("L4", _action("N01", ActionType.DELIVERY)),
                _stop("L0"),
            ),
        ]
    )

    assert ValidationErrorCode.WRONG_PICKUP_LOCATION in _codes(
        validate_plan(load_canonical_dataset(), wrong_pickup)
    )
    assert ValidationErrorCode.WRONG_DELIVERY_LOCATION in _codes(
        validate_plan(load_canonical_dataset(), wrong_delivery)
    )


def test_unknown_order_vehicle_and_location_are_safe_structured_violations() -> None:
    plan = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route("B", _stop("L0"), _stop("L99", _action("N99", ActionType.PICKUP)), _stop("L0")),
            _route("C", _stop("L0")),
        ]
    )

    codes = _codes(validate_plan(load_canonical_dataset(), plan))

    assert ValidationErrorCode.UNKNOWN_ORDER in codes
    assert ValidationErrorCode.UNKNOWN_LOCATION in codes
    assert ValidationErrorCode.UNKNOWN_VEHICLE in codes


def test_depot_actions_repeated_visits_and_intermediate_depot_are_preserved() -> None:
    plan = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L3", _action("N04", ActionType.PICKUP)),
                _stop(
                    "L0",
                    _action("N04", ActionType.DELIVERY),
                    _action("N05", ActionType.PICKUP),
                ),
                _stop("L8", _action("N05", ActionType.DELIVERY)),
                _stop("L0"),
                _stop("L0"),
            ),
        ]
    )

    result = validate_plan(load_canonical_dataset(), plan)

    assert result.completed_order_counts["B"] == 2
    assert len(result.load_snapshots) == 4
    assert [snapshot.order_id for snapshot in result.load_snapshots] == ["N04", "N04", "N05", "N05"]
    assert ValidationErrorCode.INVALID_DEPOT_START not in _codes(result)
    assert ValidationErrorCode.INVALID_DEPOT_RETURN not in _codes(result)


def test_delivery_at_the_ending_depot_is_a_valid_explicit_action() -> None:
    plan = TransportPlan(
        routes=[
            _route("A", _stop("L0")),
            _route(
                "B",
                _stop("L0"),
                _stop("L3", _action("N04", ActionType.PICKUP)),
                _stop("L0", _action("N04", ActionType.DELIVERY)),
            ),
        ]
    )

    result = validate_plan(load_canonical_dataset(), plan)

    assert result.completed_order_counts["B"] == 1
    assert "N04" not in result.unserved_order_ids
    assert ValidationErrorCode.INVALID_DEPOT_RETURN not in _codes(result)


def test_idle_duplicate_and_missing_vehicle_routes_are_supported_or_reported() -> None:
    idle_result = validate_plan(load_canonical_dataset(), _single_order_plan())
    duplicate_result = validate_plan(
        load_canonical_dataset(),
        TransportPlan(
            routes=[_route("A", _stop("L0")), _route("A", _stop("L0")), _route("B", _stop("L0"))]
        ),
    )
    missing_result = validate_plan(
        load_canonical_dataset(), TransportPlan(routes=[_route("A", _stop("L0"))])
    )

    assert idle_result.route_metrics[0].distance_tenths_km == 0
    assert ValidationErrorCode.DUPLICATE_VEHICLE_ROUTE in _codes(duplicate_result)
    assert ValidationErrorCode.MISSING_VEHICLE_ROUTE in _codes(missing_result)


def test_driving_limit_and_service_time_are_separate() -> None:
    long_route = [_stop("L0")]
    for _ in range(11):
        long_route.extend([_stop("L5"), _stop("L0")])
    plan = TransportPlan(routes=[_route("A", _stop("L0")), _route("B", *long_route)])

    result = validate_plan(load_canonical_dataset(), plan)

    assert ValidationErrorCode.DRIVING_TIME_EXCEEDED in _codes(result)
    assert result.combined_pickup_service_seconds == 0
    assert result.combined_delivery_service_seconds == 0
    assert result.combined_total_elapsed_seconds == result.combined_driving_time_seconds


def test_incomplete_empty_and_repeated_validation_are_deterministic_without_mutation() -> None:
    dataset = load_canonical_dataset()
    plan = _single_order_plan()
    dataset_before = dataset.model_dump(mode="json")
    plan_before = plan.model_dump(mode="json")

    first_result = validate_plan(dataset, plan)
    second_result = validate_plan(dataset, plan)
    empty_result = validate_plan(dataset, TransportPlan())

    assert first_result.is_complete is False
    assert first_result.unserved_order_ids == second_result.unserved_order_ids
    assert first_result.model_dump(mode="json") == second_result.model_dump(mode="json")
    assert dataset.model_dump(mode="json") == dataset_before
    assert plan.model_dump(mode="json") == plan_before
    assert ValidationErrorCode.MISSING_VEHICLE_ROUTE in _codes(empty_result)
