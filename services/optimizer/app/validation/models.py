"""Typed route input and independent validation output models."""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from app.domain.models import DomainModel


class ActionType(str, Enum):
    """The only explicit transport actions recognised by the validator."""

    PICKUP = "PICKUP"
    DELIVERY = "DELIVERY"


class TransportAction(DomainModel):
    """One ordered pickup or delivery operation for a transport order."""

    order_id: str = Field(min_length=1)
    action_type: ActionType


class RouteStop(DomainModel):
    """A route visit and its explicitly ordered transport actions."""

    location_id: str = Field(min_length=1)
    actions: list[TransportAction] = Field(default_factory=list)


class VehicleRoute(DomainModel):
    """An ordered sequence of visits for one vehicle."""

    vehicle_id: str = Field(min_length=1)
    stops: list[RouteStop] = Field(default_factory=list)


class TransportPlan(DomainModel):
    """A proposed collection of vehicle routes.

    The validator, not this transport representation, evaluates whether routes are complete.
    """

    routes: list[VehicleRoute] = Field(default_factory=list)


class ValidationErrorCode(str, Enum):
    """Stable machine-readable codes for independent business-rule violations."""

    UNKNOWN_VEHICLE = "UNKNOWN_VEHICLE"
    UNKNOWN_LOCATION = "UNKNOWN_LOCATION"
    UNKNOWN_ORDER = "UNKNOWN_ORDER"
    DUPLICATE_VEHICLE_ROUTE = "DUPLICATE_VEHICLE_ROUTE"
    MISSING_VEHICLE_ROUTE = "MISSING_VEHICLE_ROUTE"
    INVALID_DEPOT_START = "INVALID_DEPOT_START"
    INVALID_DEPOT_RETURN = "INVALID_DEPOT_RETURN"
    WEIGHT_CAPACITY_EXCEEDED = "WEIGHT_CAPACITY_EXCEEDED"
    MACHINE_COUNT_EXCEEDED = "MACHINE_COUNT_EXCEEDED"
    DELIVERY_BEFORE_PICKUP = "DELIVERY_BEFORE_PICKUP"
    CROSS_VEHICLE_DELIVERY = "CROSS_VEHICLE_DELIVERY"
    DUPLICATE_PICKUP = "DUPLICATE_PICKUP"
    DUPLICATE_DELIVERY = "DUPLICATE_DELIVERY"
    MISSING_PICKUP = "MISSING_PICKUP"
    MISSING_DELIVERY = "MISSING_DELIVERY"
    WRONG_PICKUP_LOCATION = "WRONG_PICKUP_LOCATION"
    WRONG_DELIVERY_LOCATION = "WRONG_DELIVERY_LOCATION"
    UNDELIVERED_LOAD = "UNDELIVERED_LOAD"
    DRIVING_TIME_EXCEEDED = "DRIVING_TIME_EXCEEDED"
    EMPTY_ROUTE = "EMPTY_ROUTE"


class ValidationViolation(DomainModel):
    """One structured, localized validation finding."""

    code: ValidationErrorCode
    description: str = Field(min_length=1)
    vehicle_id: str | None = None
    order_id: str | None = None
    stop_index: int | None = Field(default=None, ge=0)
    action_index: int | None = Field(default=None, ge=0)


class ActionLoadSnapshot(DomainModel):
    """Vehicle load immediately after one explicitly ordered action."""

    vehicle_id: str
    order_id: str
    action_type: ActionType
    stop_index: int
    action_index: int
    load_kg: int = Field(ge=0)
    machine_count: int = Field(ge=0)


class RouteMetrics(DomainModel):
    """Recomputed route metrics for a supplied vehicle route."""

    vehicle_id: str
    route_index: int = Field(ge=0)
    distance_tenths_km: int = Field(ge=0)
    driving_time_seconds: int = Field(ge=0)
    pickup_service_seconds: int = Field(ge=0)
    delivery_service_seconds: int = Field(ge=0)
    total_service_seconds: int = Field(ge=0)
    total_elapsed_seconds: int = Field(ge=0)
    completed_order_count: int = Field(ge=0)
    is_valid: bool


class ValidationResult(DomainModel):
    """Independent validation facts, metrics, and structured violations."""

    is_valid: bool
    is_complete: bool
    per_vehicle_validity: dict[str, bool]
    violations: list[ValidationViolation]
    unserved_order_ids: list[str]
    completed_order_counts: dict[str, int]
    route_metrics: list[RouteMetrics]
    combined_distance_tenths_km: int = Field(ge=0)
    combined_driving_time_seconds: int = Field(ge=0)
    combined_pickup_service_seconds: int = Field(ge=0)
    combined_delivery_service_seconds: int = Field(ge=0)
    combined_total_service_seconds: int = Field(ge=0)
    combined_total_elapsed_seconds: int = Field(ge=0)
    load_snapshots: list[ActionLoadSnapshot]
