"""OR-Tools pickup-and-delivery optimization with independent result validation."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from app.domain.distance import distance_between_location_ids
from app.domain.models import Location, PlanningDataset, Vehicle
from app.domain.time import driving_time_seconds
from app.solver.models import (
    BaselineComparison,
    OptimizationResult,
    OptimizationStatus,
    SolverSettings,
)
from app.validation.baseline import build_canonical_baseline_plan
from app.validation.engine import validate_plan
from app.validation.models import (
    ActionType,
    RouteStop,
    TransportAction,
    TransportPlan,
    ValidationErrorCode,
    ValidationViolation,
    VehicleRoute,
)

DEPOT_START_NODE = 0


@dataclass(frozen=True)
class _LogicalNode:
    """One routing node, deliberately distinct from its physical location."""

    location_id: str
    order_id: str | None = None
    action_type: ActionType | None = None


def optimize_plan(
    dataset: PlanningDataset, settings: SolverSettings | None = None
) -> OptimizationResult:
    """Find a feasible minimum-distance plan or return an explicit non-success status.

    This function does not mutate the dataset, does not expose an API, and validates every
    extracted solution through the independent validator before marking it feasible.
    """
    solver_settings = settings or SolverSettings()
    started_at = perf_counter()
    try:
        preflight_violations = _prevalidate_orders(dataset)
        if preflight_violations:
            return OptimizationResult(
                status=OptimizationStatus.INFEASIBLE,
                solver_duration_seconds=perf_counter() - started_at,
                settings=solver_settings,
                violations=preflight_violations,
                diagnostic_message="One or more orders cannot fit on any available vehicle.",
            )

        logical_nodes, pickup_delivery_nodes = _build_logical_nodes(dataset)
        vehicle_count = len(dataset.vehicles)
        end_node = len(logical_nodes) - 1
        manager = pywrapcp.RoutingIndexManager(
            len(logical_nodes),
            vehicle_count,
            [DEPOT_START_NODE] * vehicle_count,
            [end_node] * vehicle_count,
        )
        routing = pywrapcp.RoutingModel(manager)
        locations_by_id = dataset.locations_by_id

        distance_callback_index = routing.RegisterTransitCallback(
            _distance_callback(manager, logical_nodes, locations_by_id)
        )
        routing.SetArcCostEvaluatorOfAllVehicles(distance_callback_index)
        _add_capacity_dimensions(routing, manager, logical_nodes, dataset)
        _add_driving_time_dimension(routing, manager, logical_nodes, locations_by_id, dataset)
        _add_pairing_constraints(routing, manager, pickup_delivery_nodes)

        search_parameters = _build_search_parameters(solver_settings)
        assignment = routing.SolveWithParameters(search_parameters)
        solver_status = int(routing.status())
        elapsed_seconds = perf_counter() - started_at
        if assignment is None:
            return OptimizationResult(
                status=OptimizationStatus.NO_SOLUTION_FOUND,
                solver_status=solver_status,
                solver_duration_seconds=elapsed_seconds,
                settings=solver_settings,
                violations=[
                    _violation(
                        ValidationErrorCode.SOLVER_NO_SOLUTION,
                        "OR-Tools did not find a complete solution within the configured "
                        "search limit.",
                    )
                ],
                diagnostic_message="Search exhaustion or time limit is not proof of infeasibility.",
            )

        plan = _extract_plan(manager, routing, assignment, logical_nodes, dataset.vehicles)
        validation_result = validate_plan(dataset, plan)
        comparison = _build_baseline_comparison(
            dataset, validation_result.combined_distance_tenths_km
        )
        if not validation_result.is_valid or not validation_result.is_complete:
            return OptimizationResult(
                status=OptimizationStatus.VALIDATION_FAILED,
                solver_status=solver_status,
                solver_duration_seconds=elapsed_seconds,
                settings=solver_settings,
                plan=plan,
                validation_result=validation_result,
                violations=validation_result.violations,
                baseline_comparison=comparison,
                diagnostic_message="A solver result failed independent business-rule validation.",
            )
        return OptimizationResult(
            status=OptimizationStatus.FEASIBLE,
            solver_status=solver_status,
            solver_duration_seconds=elapsed_seconds,
            settings=solver_settings,
            plan=plan,
            validation_result=validation_result,
            violations=[],
            baseline_comparison=comparison,
        )
    except Exception as error:
        return OptimizationResult(
            status=OptimizationStatus.ERROR,
            solver_duration_seconds=perf_counter() - started_at,
            settings=solver_settings,
            diagnostic_message=f"Unexpected optimizer error: {error}",
        )


def _prevalidate_orders(dataset: PlanningDataset) -> list[ValidationViolation]:
    """Identify orders that cannot possibly fit on any vehicle before searching."""
    machine_weight_by_id = {machine.id: machine.weight_kg for machine in dataset.machines}
    violations: list[ValidationViolation] = []
    for order in dataset.orders:
        weight_kg = machine_weight_by_id[order.machine_id]
        can_be_carried = any(
            vehicle.max_payload_kg >= weight_kg and vehicle.max_simultaneous_machines >= 1
            for vehicle in dataset.vehicles
        )
        if not can_be_carried:
            violations.append(
                _violation(
                    ValidationErrorCode.UNSERVICEABLE_ORDER,
                    f"order '{order.id}' machine weight {weight_kg} kg exceeds every "
                    "vehicle capacity",
                    order_id=order.id,
                )
            )
    return violations


def _build_logical_nodes(
    dataset: PlanningDataset,
) -> tuple[list[_LogicalNode], dict[str, tuple[int, int]]]:
    """Create distinct depot, pickup, and delivery nodes without location merging."""
    depot_id = dataset.parameters.depot_location_id
    nodes = [_LogicalNode(location_id=depot_id)]
    pickup_delivery_nodes: dict[str, tuple[int, int]] = {}
    for order in dataset.orders:
        pickup_node = len(nodes)
        nodes.append(
            _LogicalNode(
                location_id=order.pickup_location_id,
                order_id=order.id,
                action_type=ActionType.PICKUP,
            )
        )
        delivery_node = len(nodes)
        nodes.append(
            _LogicalNode(
                location_id=order.delivery_location_id,
                order_id=order.id,
                action_type=ActionType.DELIVERY,
            )
        )
        pickup_delivery_nodes[order.id] = (pickup_node, delivery_node)
    nodes.append(_LogicalNode(location_id=depot_id))
    return nodes, pickup_delivery_nodes


def _distance_callback(
    manager: pywrapcp.RoutingIndexManager,
    nodes: list[_LogicalNode],
    locations_by_id: dict[str, Location],
):
    """Return a callback that yields Task 01 rounded distance units for every arc."""
    def callback(from_index: int, to_index: int) -> int:
        from_node = nodes[manager.IndexToNode(from_index)]
        to_node = nodes[manager.IndexToNode(to_index)]
        return distance_between_location_ids(
            locations_by_id, from_node.location_id, to_node.location_id
        )

    return callback


def _add_capacity_dimensions(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    nodes: list[_LogicalNode],
    dataset: PlanningDataset,
) -> None:
    """Add nonnegative weight and simultaneous-machine capacity dimensions.

    OR-Tools applies the unary demand while leaving a node; therefore the following node's
    cumul contains the load after the current action. Starts are fixed to zero and delivery
    demands return both dimensions to zero at the route end.
    """
    orders_by_id = {order.id: order for order in dataset.orders}
    weights_by_machine_id = {machine.id: machine.weight_kg for machine in dataset.machines}

    def weight_demand(index: int) -> int:
        node = nodes[manager.IndexToNode(index)]
        if node.order_id is None or node.action_type is None:
            return 0
        weight = weights_by_machine_id[orders_by_id[node.order_id].machine_id]
        return weight if node.action_type is ActionType.PICKUP else -weight

    def machine_demand(index: int) -> int:
        node = nodes[manager.IndexToNode(index)]
        if node.action_type is ActionType.PICKUP:
            return 1
        if node.action_type is ActionType.DELIVERY:
            return -1
        return 0

    weight_callback = routing.RegisterUnaryTransitCallback(weight_demand)
    machine_callback = routing.RegisterUnaryTransitCallback(machine_demand)
    vehicle_weight_capacities = [vehicle.max_payload_kg for vehicle in dataset.vehicles]
    vehicle_machine_capacities = [vehicle.max_simultaneous_machines for vehicle in dataset.vehicles]
    routing.AddDimensionWithVehicleCapacity(
        weight_callback,
        0,
        vehicle_weight_capacities,
        True,
        "WeightCapacity",
    )
    routing.AddDimensionWithVehicleCapacity(
        machine_callback,
        0,
        vehicle_machine_capacities,
        True,
        "MachineCapacity",
    )


def _add_driving_time_dimension(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    nodes: list[_LogicalNode],
    locations_by_id: dict[str, Location],
    dataset: PlanningDataset,
) -> None:
    """Constrain travel-only driving seconds with one callback per vehicle speed."""
    time_callback_indices: list[int] = []
    for vehicle in dataset.vehicles:
        def driving_callback(from_index: int, to_index: int, vehicle: Vehicle = vehicle) -> int:
            from_node = nodes[manager.IndexToNode(from_index)]
            to_node = nodes[manager.IndexToNode(to_index)]
            distance = distance_between_location_ids(
                locations_by_id, from_node.location_id, to_node.location_id
            )
            return driving_time_seconds(distance, vehicle)

        time_callback_indices.append(routing.RegisterTransitCallback(driving_callback))
    routing.AddDimensionWithVehicleTransitAndCapacity(
        time_callback_indices,
        0,
        [dataset.parameters.max_driving_seconds] * len(dataset.vehicles),
        True,
        "DrivingTime",
    )


def _add_pairing_constraints(
    routing: pywrapcp.RoutingModel,
    manager: pywrapcp.RoutingIndexManager,
    pickup_delivery_nodes: dict[str, tuple[int, int]],
) -> None:
    """Require every pair on one vehicle with strict visit order even at equal coordinates."""
    routing.AddConstantDimension(1, len(pickup_delivery_nodes) * 2 + 2, True, "VisitOrder")
    visit_order = routing.GetDimensionOrDie("VisitOrder")
    solver = routing.solver()
    for pickup_node, delivery_node in pickup_delivery_nodes.values():
        pickup_index = manager.NodeToIndex(pickup_node)
        delivery_index = manager.NodeToIndex(delivery_node)
        routing.AddPickupAndDelivery(pickup_index, delivery_index)
        solver.Add(routing.VehicleVar(pickup_index) == routing.VehicleVar(delivery_index))
        solver.Add(visit_order.CumulVar(pickup_index) < visit_order.CumulVar(delivery_index))


def _build_search_parameters(settings: SolverSettings):
    """Configure bounded OR-Tools search using supported named enum values."""
    parameters = pywrapcp.DefaultRoutingSearchParameters()
    parameters.first_solution_strategy = _first_solution_strategy(settings.first_solution_strategy)
    parameters.local_search_metaheuristic = _local_search_strategy(
        settings.local_search_metaheuristic
    )
    parameters.time_limit.FromSeconds(settings.time_limit_seconds)
    if settings.random_seed is not None and hasattr(parameters, "random_seed"):
        parameters.random_seed = settings.random_seed
    return parameters


def _first_solution_strategy(name: str) -> int:
    """Resolve supported public strategy names with an actionable error for invalid input."""
    try:
        return int(getattr(routing_enums_pb2.FirstSolutionStrategy, name))
    except AttributeError as error:
        raise ValueError(f"unsupported first-solution strategy '{name}'") from error


def _local_search_strategy(name: str) -> int:
    """Resolve supported public local-search strategy names."""
    try:
        return int(getattr(routing_enums_pb2.LocalSearchMetaheuristic, name))
    except AttributeError as error:
        raise ValueError(f"unsupported local-search strategy '{name}'") from error


def _extract_plan(
    manager: pywrapcp.RoutingIndexManager,
    routing: pywrapcp.RoutingModel,
    assignment: pywrapcp.Assignment,
    nodes: list[_LogicalNode],
    vehicles: list[Vehicle],
) -> TransportPlan:
    """Extract all logical action nodes into the existing ordered route representation."""
    routes: list[VehicleRoute] = []
    for vehicle_index, vehicle in enumerate(vehicles):
        stops: list[RouteStop] = []
        index = routing.Start(vehicle_index)
        _append_stop(stops, nodes[manager.IndexToNode(index)])
        while not routing.IsEnd(index):
            index = assignment.Value(routing.NextVar(index))
            _append_stop(stops, nodes[manager.IndexToNode(index)])
        routes.append(VehicleRoute(vehicle_id=vehicle.id, stops=stops))
    return TransportPlan(routes=routes)


def _append_stop(stops: list[RouteStop], node: _LogicalNode) -> None:
    """Append an action node while preserving multiple ordered actions at one location."""
    action = (
        TransportAction(order_id=node.order_id, action_type=node.action_type)
        if node.order_id is not None and node.action_type is not None
        else None
    )
    if stops and stops[-1].location_id == node.location_id:
        if action is not None:
            stops[-1].actions.append(action)
        return
    stops.append(RouteStop(location_id=node.location_id, actions=[action] if action else []))


def _build_baseline_comparison(
    dataset: PlanningDataset, optimized_distance_tenths_km: int
) -> BaselineComparison:
    """Compute the baseline comparison through the independent validator, never constants."""
    baseline_validation = validate_plan(dataset, build_canonical_baseline_plan(dataset))
    if not baseline_validation.is_valid or not baseline_validation.is_complete:
        raise RuntimeError("canonical baseline failed independent validation")
    baseline_distance = baseline_validation.combined_distance_tenths_km
    reduction = baseline_distance - optimized_distance_tenths_km
    return BaselineComparison(
        baseline_distance_tenths_km=baseline_distance,
        optimized_distance_tenths_km=optimized_distance_tenths_km,
        distance_reduction_tenths_km=reduction,
        distance_reduction_percentage=(reduction / baseline_distance) * 100,
    )


def _violation(
    code: ValidationErrorCode, description: str, *, order_id: str | None = None
) -> ValidationViolation:
    """Create a non-route diagnostic using the established structured violation model."""
    return ValidationViolation(code=code, description=description, order_id=order_id)
