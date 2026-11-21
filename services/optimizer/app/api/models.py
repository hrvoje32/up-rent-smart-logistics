"""Public FastAPI request contracts and conservative local-demo limits."""

from __future__ import annotations

from typing import Literal, Self

from pydantic import Field, model_validator

from app.domain.models import DomainModel, PlanningDataset
from app.solver.models import SolverSettings

MAX_REQUEST_BODY_BYTES = 262_144
MAX_VEHICLES = 20
MAX_LOCATIONS = 100
MAX_TRANSPORT_ORDERS = 100
MAX_SOLVER_TIME_SECONDS = 10
MAX_CONCURRENT_OPTIMIZATIONS = 1


class ApiSolverSettings(SolverSettings):
    """API-safe subset of the existing solver settings contract."""

    time_limit_seconds: int = Field(
        default=5,
        gt=0,
        le=MAX_SOLVER_TIME_SECONDS,
        description="Maximum bounded OR-Tools search duration in seconds.",
    )
    first_solution_strategy: Literal["PARALLEL_CHEAPEST_INSERTION"] = Field(
        default="PARALLEL_CHEAPEST_INSERTION",
        description="Supported OR-Tools initial route-construction strategy.",
    )
    local_search_metaheuristic: Literal["GUIDED_LOCAL_SEARCH"] = Field(
        default="GUIDED_LOCAL_SEARCH",
        description="Supported OR-Tools local-search improvement strategy.",
    )


class OptimizeRequest(DomainModel):
    """A complete planning dataset and bounded settings for one synchronous solve."""

    dataset: PlanningDataset = Field(
        description="Validated vehicles, machines, locations, orders, and planning parameters."
    )
    settings: ApiSolverSettings = Field(
        default_factory=ApiSolverSettings,
        description="Bounded, supported optimization search settings.",
    )

    @model_validator(mode="after")
    def validate_workload_limits(self) -> Self:
        """Reject workloads beyond the local controlled-demo resource envelope."""
        if len(self.dataset.vehicles) > MAX_VEHICLES:
            raise ValueError(f"dataset may contain at most {MAX_VEHICLES} vehicles")
        if len(self.dataset.locations) > MAX_LOCATIONS:
            raise ValueError(f"dataset may contain at most {MAX_LOCATIONS} locations")
        if len(self.dataset.orders) > MAX_TRANSPORT_ORDERS:
            raise ValueError(f"dataset may contain at most {MAX_TRANSPORT_ORDERS} transport orders")
        return self
