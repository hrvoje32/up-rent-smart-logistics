"""Deterministic Cartesian distance calculations.

Distances are stored as integer tenths of a kilometre. Each segment is rounded with
round-half-up to one decimal kilometre before route totals are summed.
"""

import math
from decimal import ROUND_HALF_UP, Decimal

from app.domain.models import Location

type DistanceTenthsKm = int
type DistanceMatrix = dict[str, dict[str, DistanceTenthsKm]]


def round_kilometres_to_tenths(distance_km: float) -> DistanceTenthsKm:
    """Round a non-negative kilometre distance to integer tenths using half-up rounding."""
    if not math.isfinite(distance_km) or distance_km < 0:
        raise ValueError("distance_km must be a finite non-negative number")
    rounded_kilometres = Decimal(str(distance_km)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return int(rounded_kilometres * 10)


def distance_between_locations(first: Location, second: Location) -> DistanceTenthsKm:
    """Return the individually rounded Euclidean segment distance in tenths of kilometres."""
    return round_kilometres_to_tenths(math.hypot(second.x - first.x, second.y - first.y))


def distance_between_location_ids(
    locations_by_id: dict[str, Location], first_location_id: str, second_location_id: str
) -> DistanceTenthsKm:
    """Return a rounded segment distance by location IDs with clear unknown-ID errors."""
    try:
        first = locations_by_id[first_location_id]
        second = locations_by_id[second_location_id]
    except KeyError as error:
        raise ValueError(f"unknown location id '{error.args[0]}'") from error
    return distance_between_locations(first, second)


def build_distance_matrix(locations: tuple[Location, ...] | list[Location]) -> DistanceMatrix:
    """Build a symmetric matrix of individually rounded segment distances."""
    return {
        first.id: {second.id: distance_between_locations(first, second) for second in locations}
        for first in locations
    }


def route_distance_tenths(
    location_ids: tuple[str, ...] | list[str], matrix: DistanceMatrix
) -> DistanceTenthsKm:
    """Sum individually rounded matrix segments for an ordered location sequence."""
    segments = zip(location_ids, location_ids[1:], strict=False)
    return sum(
        matrix[first_location_id][second_location_id]
        for first_location_id, second_location_id in segments
    )


def tenths_to_kilometres(distance_tenths_km: DistanceTenthsKm) -> float:
    """Convert integer tenths of a kilometre to a display-friendly kilometre value."""
    return distance_tenths_km / 10
