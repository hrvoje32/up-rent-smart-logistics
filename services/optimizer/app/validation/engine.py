"""Pure independent validation for proposed UP RENT transport plans."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from app.domain.distance import build_distance_matrix
from app.domain.models import PlanningDataset, PlanningParameters, TransportOrder, Vehicle
from app.domain.time import (
    delivery_service_time_seconds,
    driving_time_seconds,
    pickup_service_time_seconds,
)
from app.validation.models import (
    ActionLoadSnapshot,
    ActionType,
    RouteMetrics,
    TransportAction,
    TransportPlan,
    ValidationErrorCode,
    ValidationResult,
    ValidationViolation,
    VehicleRoute,
)


@dataclass
class _RouteState:
    """Mutable state used only while processing one route; never exposed or retained."""

    load_kg: int = 0
    loaded_order_ids: set[str] = field(default_factory=set)
    distance_tenths_km: int = 0
    pickup_count: int = 0
    delivery_count: int = 0
    elapsed_seconds: int = 0
    waiting_time_seconds: int = 0


@dataclass
class _OrderFacts:
    """Facts collected across routes for one known order."""

    pickup_count: int = 0
    delivery_count: int = 0
    pickup_vehicle_id: str | None = None
    delivery_vehicle_id: str | None = None
    pickup_location_is_correct: bool = True
    delivery_location_is_correct: bool = True
    delivery_after_pickup: bool = True


def validate_plan(
    dataset: PlanningDataset, plan: TransportPlan, *, require_all_vehicles: bool = False
) -> ValidationResult:
    """Validate a plan without mutating either input or relying on a solver.

    Metrics are recomputed from ordered stops and explicit actions. Invalid routes receive
    structured violations whenever their data can safely be evaluated.
    """
    vehicles_by_id = {vehicle.id: vehicle for vehicle in dataset.vehicles}
    orders_by_id = {order.id: order for order in dataset.orders}
    machine_weight_by_id = {machine.id: machine.weight_kg for machine in dataset.machines}
    location_ids = set(dataset.locations_by_id)
    distance_matrix = build_distance_matrix(dataset.locations)

    violations: list[ValidationViolation] = []
    snapshots: list[ActionLoadSnapshot] = []
    route_metrics: list[RouteMetrics] = []
    route_count_by_vehicle: dict[str, int] = defaultdict(int)
    order_facts = {order.id: _OrderFacts() for order in dataset.orders}

    for route_index, route in enumerate(plan.routes):
        route_count_by_vehicle[route.vehicle_id] += 1
        if route_count_by_vehicle[route.vehicle_id] > 1:
            violations.append(
                _violation(
                    ValidationErrorCode.DUPLICATE_VEHICLE_ROUTE,
                    f"vehicle '{route.vehicle_id}' has more than one route",
                    vehicle_id=route.vehicle_id,
                )
            )

        vehicle = vehicles_by_id.get(route.vehicle_id)
        if vehicle is None:
            violations.append(
                _violation(
                    ValidationErrorCode.UNKNOWN_VEHICLE,
                    f"route references unknown vehicle '{route.vehicle_id}'",
                    vehicle_id=route.vehicle_id,
                )
            )
            continue

        route_violations_start = len(violations)
        state = _validate_route(
            route=route,
            vehicle=vehicle,
            dataset=dataset,
            location_ids=location_ids,
            distance_matrix=distance_matrix,
            orders_by_id=orders_by_id,
            machine_weight_by_id=machine_weight_by_id,
            order_facts=order_facts,
            violations=violations,
            snapshots=snapshots,
        )
        route_metrics.append(
            _build_metrics(
                vehicle=vehicle,
                route_index=route_index,
                state=state,
                parameters=dataset.parameters,
                is_valid=len(violations) == route_violations_start,
            )
        )

    for vehicle in dataset.vehicles:
        if route_count_by_vehicle[vehicle.id] == 0:
            violations.append(
                _violation(
                    ValidationErrorCode.MISSING_VEHICLE_ROUTE,
                    f"vehicle '{vehicle.id}' has no route",
                    vehicle_id=vehicle.id,
                )
            )
            route_metrics.append(
                _build_metrics(
                    vehicle=vehicle,
                    route_index=len(plan.routes),
                    state=_RouteState(),
                    parameters=dataset.parameters,
                    is_valid=False,
                )
            )

    completed_order_ids = _finalize_order_validation(
        dataset=dataset,
        order_facts=order_facts,
        violations=violations,
    )
    completed_order_counts = _completed_order_counts(dataset, completed_order_ids, order_facts)
    if require_all_vehicles:
        for vehicle_id, completed_count in completed_order_counts.items():
            if completed_count == 0:
                violations.append(
                    _violation(
                        ValidationErrorCode.REQUIRED_VEHICLE_UNUSED,
                        f"vehicle '{vehicle_id}' was selected but did not serve an order",
                        vehicle_id=vehicle_id,
                    )
                )
    _update_completed_counts(route_metrics, completed_order_counts)

    per_vehicle_validity = _per_vehicle_validity(dataset, violations)
    for metric in route_metrics:
        metric.is_valid = per_vehicle_validity.get(metric.vehicle_id, False)
    return ValidationResult(
        is_valid=not violations,
        is_complete=len(completed_order_ids) == len(dataset.orders),
        per_vehicle_validity=per_vehicle_validity,
        violations=violations,
        unserved_order_ids=sorted(set(orders_by_id) - completed_order_ids),
        completed_order_counts=completed_order_counts,
        route_metrics=route_metrics,
        combined_distance_tenths_km=sum(
            metric.distance_tenths_km for metric in route_metrics
        ),
        combined_driving_time_seconds=sum(
            metric.driving_time_seconds for metric in route_metrics
        ),
        combined_pickup_service_seconds=sum(
            metric.pickup_service_seconds for metric in route_metrics
        ),
        combined_delivery_service_seconds=sum(
            metric.delivery_service_seconds for metric in route_metrics
        ),
        combined_waiting_time_seconds=sum(
            metric.waiting_time_seconds for metric in route_metrics
        ),
        combined_total_service_seconds=sum(
            metric.total_service_seconds for metric in route_metrics
        ),
        combined_total_elapsed_seconds=sum(
            metric.total_elapsed_seconds for metric in route_metrics
        ),
        load_snapshots=snapshots,
    )


def _validate_route(
    *,
    route: VehicleRoute,
    vehicle: Vehicle,
    dataset: PlanningDataset,
    location_ids: set[str],
    distance_matrix: dict[str, dict[str, int]],
    orders_by_id: dict[str, TransportOrder],
    machine_weight_by_id: dict[str, int],
    order_facts: dict[str, _OrderFacts],
    violations: list[ValidationViolation],
    snapshots: list[ActionLoadSnapshot],
) -> _RouteState:
    """Validate one known vehicle route and return recomputed local state."""
    state = _RouteState()
    if not route.stops:
        violations.append(
            _violation(
                ValidationErrorCode.EMPTY_ROUTE,
                f"vehicle '{vehicle.id}' route has no stops",
                vehicle_id=vehicle.id,
            )
        )
        return state

    depot_id = dataset.parameters.depot_location_id
    if route.stops[0].location_id != depot_id:
        violations.append(
            _violation(
                ValidationErrorCode.INVALID_DEPOT_START,
                f"vehicle '{vehicle.id}' must start at depot '{depot_id}'",
                vehicle_id=vehicle.id,
                stop_index=0,
            )
        )
    if route.stops[-1].location_id != depot_id:
        violations.append(
            _violation(
                ValidationErrorCode.INVALID_DEPOT_RETURN,
                f"vehicle '{vehicle.id}' must finish at depot '{depot_id}'",
                vehicle_id=vehicle.id,
                stop_index=len(route.stops) - 1,
            )
        )

    previous_location_id: str | None = None
    for stop_index, stop in enumerate(route.stops):
        location_is_known = stop.location_id in location_ids
        if not location_is_known:
            violations.append(
                _violation(
                    ValidationErrorCode.UNKNOWN_LOCATION,
                    f"route references unknown location '{stop.location_id}'",
                    vehicle_id=vehicle.id,
                    stop_index=stop_index,
                )
            )
            previous_location_id = None
        elif previous_location_id is not None:
            leg_distance = distance_matrix[previous_location_id][stop.location_id]
            state.distance_tenths_km += leg_distance
            state.elapsed_seconds += driving_time_seconds(leg_distance, vehicle)

        if location_is_known:
            previous_location_id = stop.location_id

        for action_index, action in enumerate(stop.actions):
            order = orders_by_id.get(action.order_id)
            if order is not None:
                _apply_time_constraint(
                    order=order,
                    action=action,
                    vehicle=vehicle,
                    stop_index=stop_index,
                    action_index=action_index,
                    state=state,
                    parameters=dataset.parameters,
                    violations=violations,
                )
            _apply_action(
                action=action,
                location_id=stop.location_id,
                vehicle=vehicle,
                stop_index=stop_index,
                action_index=action_index,
                state=state,
                orders_by_id=orders_by_id,
                machine_weight_by_id=machine_weight_by_id,
                order_facts=order_facts,
                violations=violations,
            )
            snapshots.append(
                ActionLoadSnapshot(
                    vehicle_id=vehicle.id,
                    order_id=action.order_id,
                    action_type=action.action_type,
                    stop_index=stop_index,
                    action_index=action_index,
                    load_kg=state.load_kg,
                    machine_count=len(state.loaded_order_ids),
                )
            )

    if state.loaded_order_ids:
        for order_id in sorted(state.loaded_order_ids):
            violations.append(
                _violation(
                    ValidationErrorCode.UNDELIVERED_LOAD,
                    f"order '{order_id}' remains loaded when vehicle '{vehicle.id}' route ends",
                    vehicle_id=vehicle.id,
                    order_id=order_id,
                )
            )
    route_driving_seconds = driving_time_seconds(state.distance_tenths_km, vehicle)
    if route_driving_seconds > dataset.parameters.max_driving_seconds:
        violations.append(
            _violation(
                ValidationErrorCode.DRIVING_TIME_EXCEEDED,
                f"vehicle '{vehicle.id}' exceeds its driving-time limit",
                vehicle_id=vehicle.id,
            )
        )
    return state


def _apply_action(
    *,
    action: TransportAction,
    location_id: str,
    vehicle: Vehicle,
    stop_index: int,
    action_index: int,
    state: _RouteState,
    orders_by_id: dict[str, TransportOrder],
    machine_weight_by_id: dict[str, int],
    order_facts: dict[str, _OrderFacts],
    violations: list[ValidationViolation],
) -> None:
    """Apply one known action if possible, preserving order and load facts."""
    order = orders_by_id.get(action.order_id)
    if order is None:
        violations.append(
            _violation(
                ValidationErrorCode.UNKNOWN_ORDER,
                f"action references unknown order '{action.order_id}'",
                vehicle_id=vehicle.id,
                order_id=action.order_id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
        return

    facts = order_facts[order.id]
    if action.action_type is ActionType.PICKUP:
        state.pickup_count += 1
        _apply_pickup(
            order=order,
            facts=facts,
            location_id=location_id,
            vehicle=vehicle,
            stop_index=stop_index,
            action_index=action_index,
            state=state,
            machine_weight_by_id=machine_weight_by_id,
            violations=violations,
        )
        return

    state.delivery_count += 1
    _apply_delivery(
        order=order,
        facts=facts,
        location_id=location_id,
        vehicle=vehicle,
        stop_index=stop_index,
        action_index=action_index,
        state=state,
        machine_weight_by_id=machine_weight_by_id,
        violations=violations,
    )


def _apply_time_constraint(
    *,
    order: TransportOrder,
    action: TransportAction,
    vehicle: Vehicle,
    stop_index: int,
    action_index: int,
    state: _RouteState,
    parameters: PlanningParameters,
    violations: list[ValidationViolation],
) -> None:
    """Apply optional appointment windows to one ordered operation.

    Cumul values represent service start. Waiting is legitimate and contributes only to
    elapsed time; the existing driving limit remains travel-only.
    """
    if action.action_type is ActionType.PICKUP:
        earliest = order.earliest_pickup_at
        latest_completion = order.latest_pickup_at
        service_seconds = parameters.pickup_service_seconds
        code = ValidationErrorCode.PICKUP_TIME_WINDOW_VIOLATION
    else:
        earliest = order.earliest_delivery_at
        latest_completion = order.delivery_deadline_at
        service_seconds = parameters.delivery_service_seconds
        code = ValidationErrorCode.DELIVERY_TIME_WINDOW_VIOLATION

    if earliest is None and latest_completion is None:
        state.elapsed_seconds += service_seconds
        return
    if parameters.planning_start_at is None:
        violations.append(
            _violation(
                ValidationErrorCode.UNSUPPORTED_TIME_CONSTRAINT,
                "time-constrained order requires planning_start_at with a timezone offset",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
        state.elapsed_seconds += service_seconds
        return

    planning_start = parameters.planning_start_at
    if earliest is not None:
        earliest_offset = int((earliest - planning_start).total_seconds())
        if state.elapsed_seconds < earliest_offset:
            state.waiting_time_seconds += earliest_offset - state.elapsed_seconds
            state.elapsed_seconds = earliest_offset
    completion_seconds = state.elapsed_seconds + service_seconds
    if latest_completion is not None:
        latest_offset = int((latest_completion - planning_start).total_seconds())
        if completion_seconds > latest_offset:
            violations.append(
                _violation(
                    code,
                    f"order '{order.id}' service finishes after its permitted time window",
                    vehicle_id=vehicle.id,
                    order_id=order.id,
                    stop_index=stop_index,
                    action_index=action_index,
                )
            )
    state.elapsed_seconds = completion_seconds


def _apply_pickup(
    *,
    order: TransportOrder,
    facts: _OrderFacts,
    location_id: str,
    vehicle: Vehicle,
    stop_index: int,
    action_index: int,
    state: _RouteState,
    machine_weight_by_id: dict[str, int],
    violations: list[ValidationViolation],
) -> None:
    """Record a pickup and update load only for its first occurrence."""
    facts.pickup_count += 1
    if facts.pickup_count > 1:
        violations.append(
            _violation(
                ValidationErrorCode.DUPLICATE_PICKUP,
                f"order '{order.id}' has more than one pickup",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
        return

    facts.pickup_vehicle_id = vehicle.id
    if location_id != order.pickup_location_id:
        facts.pickup_location_is_correct = False
        violations.append(
            _violation(
                ValidationErrorCode.WRONG_PICKUP_LOCATION,
                f"order '{order.id}' pickup must occur at '{order.pickup_location_id}'",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )

    state.loaded_order_ids.add(order.id)
    state.load_kg += machine_weight_by_id[order.machine_id]
    _validate_capacity(vehicle, state, order.id, stop_index, action_index, violations)


def _apply_delivery(
    *,
    order: TransportOrder,
    facts: _OrderFacts,
    location_id: str,
    vehicle: Vehicle,
    stop_index: int,
    action_index: int,
    state: _RouteState,
    machine_weight_by_id: dict[str, int],
    violations: list[ValidationViolation],
) -> None:
    """Record a delivery, enforcing local pickup-before-delivery state."""
    facts.delivery_count += 1
    if facts.delivery_count > 1:
        violations.append(
            _violation(
                ValidationErrorCode.DUPLICATE_DELIVERY,
                f"order '{order.id}' has more than one delivery",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
        return

    facts.delivery_vehicle_id = vehicle.id
    if location_id != order.delivery_location_id:
        facts.delivery_location_is_correct = False
        violations.append(
            _violation(
                ValidationErrorCode.WRONG_DELIVERY_LOCATION,
                f"order '{order.id}' delivery must occur at '{order.delivery_location_id}'",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )

    if order.id not in state.loaded_order_ids:
        facts.delivery_after_pickup = False
        code = (
            ValidationErrorCode.CROSS_VEHICLE_DELIVERY
            if facts.pickup_vehicle_id is not None and facts.pickup_vehicle_id != vehicle.id
            else ValidationErrorCode.DELIVERY_BEFORE_PICKUP
        )
        violations.append(
            _violation(
                code,
                f"order '{order.id}' delivery has no prior pickup on vehicle '{vehicle.id}'",
                vehicle_id=vehicle.id,
                order_id=order.id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
        return

    state.loaded_order_ids.remove(order.id)
    state.load_kg -= machine_weight_by_id[order.machine_id]


def _validate_capacity(
    vehicle: Vehicle,
    state: _RouteState,
    order_id: str,
    stop_index: int,
    action_index: int,
    violations: list[ValidationViolation],
) -> None:
    """Report capacity breaches after a pickup without altering physical load state."""
    if state.load_kg > vehicle.max_payload_kg:
        violations.append(
            _violation(
                ValidationErrorCode.WEIGHT_CAPACITY_EXCEEDED,
                f"vehicle '{vehicle.id}' load exceeds {vehicle.max_payload_kg} kg",
                vehicle_id=vehicle.id,
                order_id=order_id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )
    if len(state.loaded_order_ids) > vehicle.max_simultaneous_machines:
        violations.append(
            _violation(
                ValidationErrorCode.MACHINE_COUNT_EXCEEDED,
                f"vehicle '{vehicle.id}' carries too many simultaneous machines",
                vehicle_id=vehicle.id,
                order_id=order_id,
                stop_index=stop_index,
                action_index=action_index,
            )
        )


def _finalize_order_validation(
    *,
    dataset: PlanningDataset,
    order_facts: dict[str, _OrderFacts],
    violations: list[ValidationViolation],
) -> set[str]:
    """Report required missing actions and derive fully completed order IDs."""
    completed_order_ids: set[str] = set()
    for order in dataset.orders:
        facts = order_facts[order.id]
        if facts.pickup_count == 0:
            violations.append(
                _violation(
                    ValidationErrorCode.MISSING_PICKUP,
                    f"order '{order.id}' has no pickup",
                    order_id=order.id,
                )
            )
        if facts.delivery_count == 0:
            violations.append(
                _violation(
                    ValidationErrorCode.MISSING_DELIVERY,
                    f"order '{order.id}' has no delivery",
                    order_id=order.id,
                )
            )
        if _order_is_completed(facts):
            completed_order_ids.add(order.id)
    return completed_order_ids


def _order_is_completed(facts: _OrderFacts) -> bool:
    """Return whether exactly one location-correct, same-truck action pair completed."""
    return (
        facts.pickup_count == 1
        and facts.delivery_count == 1
        and facts.pickup_vehicle_id == facts.delivery_vehicle_id
        and facts.pickup_location_is_correct
        and facts.delivery_location_is_correct
        and facts.delivery_after_pickup
    )


def _completed_order_counts(
    dataset: PlanningDataset,
    completed_order_ids: set[str],
    order_facts: dict[str, _OrderFacts],
) -> dict[str, int]:
    """Count completed orders by their validating pickup/delivery vehicle."""
    counts = {vehicle.id: 0 for vehicle in dataset.vehicles}
    for order_id in completed_order_ids:
        vehicle_id = order_facts[order_id].pickup_vehicle_id
        if vehicle_id is not None:
            counts[vehicle_id] += 1
    return counts


def _update_completed_counts(
    route_metrics: list[RouteMetrics], completed_order_counts: dict[str, int]
) -> None:
    """Apply aggregate completed counts to per-route metrics without touching input plans."""
    for metric in route_metrics:
        if metric.vehicle_id in completed_order_counts:
            metric.completed_order_count = completed_order_counts[metric.vehicle_id]


def _build_metrics(
    *,
    vehicle: Vehicle,
    route_index: int,
    state: _RouteState,
    parameters: PlanningParameters,
    is_valid: bool,
) -> RouteMetrics:
    """Build trusted metrics entirely from recomputed route state."""
    driving_seconds = driving_time_seconds(state.distance_tenths_km, vehicle)
    pickup_seconds = pickup_service_time_seconds(state.pickup_count, parameters)
    delivery_seconds = delivery_service_time_seconds(state.delivery_count, parameters)
    service_seconds = pickup_seconds + delivery_seconds
    return RouteMetrics(
        vehicle_id=vehicle.id,
        route_index=route_index,
        distance_tenths_km=state.distance_tenths_km,
        driving_time_seconds=driving_seconds,
        pickup_service_seconds=pickup_seconds,
        delivery_service_seconds=delivery_seconds,
        waiting_time_seconds=state.waiting_time_seconds,
        total_service_seconds=service_seconds,
        total_elapsed_seconds=driving_seconds + service_seconds + state.waiting_time_seconds,
        completed_order_count=0,
        is_valid=is_valid,
    )


def _per_vehicle_validity(
    dataset: PlanningDataset, violations: list[ValidationViolation]
) -> dict[str, bool]:
    """Summarize known vehicle validity from localized violations."""
    invalid_vehicle_ids = {
        violation.vehicle_id for violation in violations if violation.vehicle_id is not None
    }
    return {vehicle.id: vehicle.id not in invalid_vehicle_ids for vehicle in dataset.vehicles}


def _violation(
    code: ValidationErrorCode,
    description: str,
    *,
    vehicle_id: str | None = None,
    order_id: str | None = None,
    stop_index: int | None = None,
    action_index: int | None = None,
) -> ValidationViolation:
    """Create a consistent structured violation."""
    return ValidationViolation(
        code=code,
        description=description,
        vehicle_id=vehicle_id,
        order_id=order_id,
        stop_index=stop_index,
        action_index=action_index,
    )
