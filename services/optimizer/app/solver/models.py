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


class SolverSettings(DomainModel):
    """Bounded routing-search settings exposed to callers."""

    time_limit_seconds: int = Field(default=5, gt=0, le=60)
    first_solution_strategy: str = "PARALLEL_CHEAPEST_INSERTION"
    local_search_metaheuristic: str = "GUIDED_LOCAL_SEARCH"
    random_seed: int | None = None


class BaselineComparison(DomainModel):
    """Distance-only comparison with the documented non-optimized reference plan."""

    baseline_distance_tenths_km: int = Field(ge=0)
    optimized_distance_tenths_km: int = Field(ge=0)
    distance_reduction_tenths_km: int
    distance_reduction_percentage: float


class OptimizationResult(DomainModel):
    """Solver outcome, independently recomputed plan result, and diagnostics."""

    status: OptimizationStatus
    solver_status: int | None = None
    solver_duration_seconds: float = Field(ge=0)
    settings: SolverSettings
    plan: TransportPlan | None = None
    validation_result: ValidationResult | None = None
    violations: list[ValidationViolation] = Field(default_factory=list)
    baseline_comparison: BaselineComparison | None = None
    diagnostic_message: str | None = None
