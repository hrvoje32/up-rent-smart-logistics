"""Canonical, deliberately non-optimized reference transport plan."""

from __future__ import annotations

from app.domain.models import PlanningDataset
from app.validation.models import (
    ActionType,
    RouteStop,
    TransportAction,
    TransportPlan,
    VehicleRoute,
)


def build_canonical_baseline_plan(dataset: PlanningDataset) -> TransportPlan:
    """Build the documented all-orders-on-Truck-B baseline without computed metrics.

    Truck A remains idle at the depot. Truck B handles one order at a time and returns to
    the depot after each delivery. The validator, rather than this builder, computes facts.
    """
    depot_id = dataset.parameters.depot_location_id
    carrier_vehicle_id = "B"
    vehicle_ids = {vehicle.id for vehicle in dataset.vehicles}
    if carrier_vehicle_id not in vehicle_ids or "A" not in vehicle_ids:
        raise ValueError("canonical baseline requires vehicles 'A' and 'B'")

    truck_b_stops = [RouteStop(location_id=depot_id)]
    current_location_id = depot_id
    for order in dataset.orders:
        if current_location_id != order.pickup_location_id:
            truck_b_stops.append(RouteStop(location_id=order.pickup_location_id))
        truck_b_stops.append(
            RouteStop(
                location_id=order.pickup_location_id,
                actions=[TransportAction(order_id=order.id, action_type=ActionType.PICKUP)],
            )
        )
        truck_b_stops.append(
            RouteStop(
                location_id=order.delivery_location_id,
                actions=[TransportAction(order_id=order.id, action_type=ActionType.DELIVERY)],
            )
        )
        current_location_id = order.delivery_location_id
        if current_location_id != depot_id:
            truck_b_stops.append(RouteStop(location_id=depot_id))
        current_location_id = depot_id

    return TransportPlan(
        routes=[
            VehicleRoute(vehicle_id="A", stops=[RouteStop(location_id=depot_id)]),
            VehicleRoute(vehicle_id=carrier_vehicle_id, stops=truck_b_stops),
        ]
    )
