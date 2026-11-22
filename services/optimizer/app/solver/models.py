"""Typed configuration and output for the OR-Tools optimization engine."""

from __future__ import annotations

from enum import Enum

from pydantic import Field

from app.domain.models import DomainModel
from app.validation.models import TransportPlan, ValidationResult, ValidationViolation


class OptimizationStatus(str, Enum):
    """Public outcome states that distinguish search and validation outcomes."""

    FEASIBLE = "FEASIBLE"
    INFEASIBLE = "INFEASIBLE"
    NO_SOLUTION_FOUND = "NO_SOLUTION_FOUND"
    VALIDATION_FAILED = "VALIDATION_FAILED"
    ERROR = "ERROR"


class OptimizationStrategy(str, Enum):
    """Real routing objectives exposed by the local planning application."""

    FASTEST_DELIVERY = "FASTEST_DELIVERY"
    BALANCED = "BALANCED"
    DISTANCE_SAVINGS = "DISTANCE_SAVINGS"


class SolverSettings(DomainModel):
    """Bounded routing-search settings exposed to callers."""

    time_limit_seconds: int = Field(default=5, gt=0, le=60)
    first_solution_strategy: str = "PARALLEL_CHEAPEST_INSERTION"
    local_search_metaheuristic: str = "GUIDED_LOCAL_SEARCH"
    random_seed: int | None = None
    optimization_strategy: OptimizationStrategy = OptimizationStrategy.DISTANCE_SAVINGS
    require_all_selected_vehicles: bool = False


class BaselineComparison(DomainModel):
    """Distance-only comparison with the documented non-optimized reference plan."""

    baseline_distance_tenths_km: int = Field(ge=0, description="Baseline distance in 0.1 km units.")
    optimized_distance_tenths_km: int = Field(
        ge=0, description="Independently validated optimized distance in 0.1 km units."
    )
    distance_reduction_tenths_km: int = Field(
        description="Baseline minus optimized distance in 0.1 km units."
    )
    distance_reduction_percentage: float = Field(
        description="Distance reduction relative to baseline, as a percentage."
    )


class OptimizationResult(DomainModel):
    """Solver outcome, independently recomputed plan result, and diagnostics."""

    status: OptimizationStatus = Field(description="Public optimization outcome status.")
    solver_status: int | None = Field(
        default=None, description="Original OR-Tools routing status code."
    )
    solver_duration_seconds: float = Field(
        ge=0, description="Solver execution duration in seconds."
    )
    settings: SolverSettings = Field(description="Effective bounded search settings.")
    plan: TransportPlan | None = Field(
        default=None, description="Extracted ordered routes when available."
    )
    validation_result: ValidationResult | None = Field(
        default=None, description="Independent recomputation of route validity and metrics."
    )
    violations: list[ValidationViolation] = Field(
        default_factory=list, description="Structured solver or preflight diagnostics."
    )
    baseline_comparison: BaselineComparison | None = Field(
        default=None, description="Programmatic comparison to the canonical baseline."
    )
    diagnostic_message: str | None = Field(
        default=None, description="Sanitized human-readable status diagnostic."
    )
