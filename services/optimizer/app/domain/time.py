"""Pure duration calculations for a planning dataset.

Driving time and service time remain separate. The 540-minute assessment limit applies
to driving time only; no routing constraint is implemented here.
"""

from __future__ import annotations

from app.domain.distance import DistanceTenthsKm
from app.domain.models import PlanningParameters, Vehicle


def driving_time_seconds(distance_tenths_km: DistanceTenthsKm, vehicle: Vehicle) -> int:
    """Return driving duration rounded half-up to whole seconds.

    The canonical 60 km/h speed makes every 0.1 km exactly six seconds.
    """
    if distance_tenths_km < 0:
        raise ValueError("distance_tenths_km cannot be negative")
    numerator = distance_tenths_km * 360
    return (numerator * 2 + vehicle.average_speed_kmh) // (2 * vehicle.average_speed_kmh)


def pickup_service_time_seconds(pickup_count: int, parameters: PlanningParameters) -> int:
    """Return total pickup service duration in seconds."""
    _require_non_negative_count(pickup_count, "pickup_count")
    return pickup_count * parameters.pickup_service_seconds


def delivery_service_time_seconds(delivery_count: int, parameters: PlanningParameters) -> int:
    """Return total delivery service duration in seconds."""
    _require_non_negative_count(delivery_count, "delivery_count")
    return delivery_count * parameters.delivery_service_seconds


def planned_elapsed_time_seconds(
    distance_tenths_km: DistanceTenthsKm,
    vehicle: Vehicle,
    parameters: PlanningParameters,
    pickup_count: int,
    delivery_count: int,
) -> int:
    """Return driving plus pickup and delivery service time in seconds."""
    return (
        driving_time_seconds(distance_tenths_km, vehicle)
        + pickup_service_time_seconds(pickup_count, parameters)
        + delivery_service_time_seconds(delivery_count, parameters)
    )


def _require_non_negative_count(value: int, name: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
