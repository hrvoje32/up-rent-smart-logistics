"""Validated, database-independent planning domain models.

All weights are kilograms, coordinates are Cartesian kilometres, and durations are minutes.
"""

from __future__ import annotations

import math
from typing import Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class DomainModel(BaseModel):
    """Base configuration shared by boundary models.

    Extra fields are rejected so a fixture cannot silently drift from the documented format.
    """

    model_config = ConfigDict(extra="forbid", strict=True)


class Vehicle(DomainModel):
    """A transport vehicle and its operational limits."""

    id: str = Field(min_length=1)
    max_payload_kg: int = Field(gt=0)
    max_simultaneous_machines: int = Field(gt=0)
    start_location_id: str = Field(min_length=1)
    end_location_id: str = Field(min_length=1)
    average_speed_kmh: int = Field(gt=0)


class Machine(DomainModel):
    """A machine available to be transported."""

    id: str = Field(min_length=1)
    weight_kg: int = Field(gt=0)


class Location(DomainModel):
    """A Cartesian location expressed in kilometres."""

    id: str = Field(min_length=1)
    x: float
    y: float

    @field_validator("x", "y", mode="before")
    @classmethod
    def validate_finite_coordinate(cls, value: object) -> float:
        """Accept only finite JSON numbers, including integer fixture coordinates."""
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ValueError("coordinates must be finite numbers")

        coordinate = float(value)
        if not math.isfinite(coordinate):
            raise ValueError("coordinates must be finite numbers")
        return coordinate


class TransportOrder(DomainModel):
    """An order that moves one machine from pickup to delivery."""

    id: str = Field(min_length=1)
    machine_id: str = Field(min_length=1)
    pickup_location_id: str = Field(min_length=1)
    delivery_location_id: str = Field(min_length=1)


class PlanningParameters(DomainModel):
    """Time and depot assumptions shared by a planning dataset.

    The driving limit applies only to driving time. Service time is intentionally tracked
    separately by the time-calculation module.
    """

    depot_location_id: str = Field(min_length=1)
    max_driving_minutes: int = Field(gt=0)
    pickup_service_minutes: int = Field(gt=0)
    delivery_service_minutes: int = Field(gt=0)

    @property
    def max_driving_seconds(self) -> int:
        """Return the maximum driving allowance in seconds."""
        return self.max_driving_minutes * 60

    @property
    def pickup_service_seconds(self) -> int:
        """Return one pickup service duration in seconds."""
        return self.pickup_service_minutes * 60

    @property
    def delivery_service_seconds(self) -> int:
        """Return one delivery service duration in seconds."""
        return self.delivery_service_minutes * 60


class PlanningDataset(DomainModel):
    """A self-contained, validated planning input dataset."""

    vehicles: list[Vehicle] = Field(min_length=1)
    machines: list[Machine] = Field(min_length=1)
    locations: list[Location] = Field(min_length=1)
    orders: list[TransportOrder]
    parameters: PlanningParameters

    @model_validator(mode="after")
    def validate_references_and_identifiers(self) -> Self:
        """Validate cross-record identifiers after Pydantic validates individual fields."""
        self._require_unique_ids(self.vehicles, "vehicle")
        self._require_unique_ids(self.machines, "machine")
        self._require_unique_ids(self.locations, "location")
        self._require_unique_ids(self.orders, "order")

        location_ids = {location.id for location in self.locations}
        machine_ids = {machine.id for machine in self.machines}

        self._require_location(
            self.parameters.depot_location_id,
            "parameters.depot_location_id",
            location_ids,
        )
        for vehicle in self.vehicles:
            self._require_location(
                vehicle.start_location_id, f"vehicle {vehicle.id} start", location_ids
            )
            self._require_location(
                vehicle.end_location_id, f"vehicle {vehicle.id} end", location_ids
            )
        for order in self.orders:
            if order.machine_id not in machine_ids:
                raise ValueError(
                    f"order {order.id} references unknown machine '{order.machine_id}'"
                )
            self._require_location(
                order.pickup_location_id, f"order {order.id} pickup", location_ids
            )
            self._require_location(
                order.delivery_location_id, f"order {order.id} delivery", location_ids
            )
        return self

    @staticmethod
    def _require_unique_ids(
        records: list[Vehicle] | list[Machine] | list[Location] | list[TransportOrder],
        record_type: str,
    ) -> None:
        identifiers = [record.id for record in records]
        duplicate_ids = {
            identifier for identifier in identifiers if identifiers.count(identifier) > 1
        }
        duplicates = sorted(duplicate_ids)
        if duplicates:
            joined_identifiers = ", ".join(f"'{identifier}'" for identifier in duplicates)
            raise ValueError(f"duplicate {record_type} id(s): {joined_identifiers}")

    @staticmethod
    def _require_location(location_id: str, reference_name: str, location_ids: set[str]) -> None:
        if location_id not in location_ids:
            raise ValueError(f"{reference_name} references unknown location '{location_id}'")

    @property
    def locations_by_id(self) -> dict[str, Location]:
        """Return locations indexed by identifier for pure calculation functions."""
        return {location.id: location for location in self.locations}
