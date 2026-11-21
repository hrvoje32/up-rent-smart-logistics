"""Operational health endpoint."""

from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["operations"])


class HealthResponse(BaseModel):
    """Structured liveness response for service consumers and orchestration."""

    status: Literal["ok"]
    service: Literal["optimizer"]


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Return the minimal liveness status without accessing external services."""
    return HealthResponse(status="ok", service="optimizer")
