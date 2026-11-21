"""Versioned local-demo HTTP interface for the existing optimization engine."""

from __future__ import annotations

from threading import BoundedSemaphore

from fastapi import APIRouter, HTTPException, status

from app.api.models import MAX_CONCURRENT_OPTIMIZATIONS, OptimizeRequest
from app.domain.dataset import load_canonical_dataset
from app.domain.models import PlanningDataset
from app.solver.engine import optimize_plan
from app.solver.models import OptimizationResult, OptimizationStatus

router = APIRouter(prefix="/api/v1", tags=["optimization"])
optimization_semaphore = BoundedSemaphore(value=MAX_CONCURRENT_OPTIMIZATIONS)


@router.get(
    "/demo-case",
    response_model=PlanningDataset,
    summary="Load the immutable canonical UP RENT demonstration dataset",
)
def get_demo_case() -> PlanningDataset:
    """Return a newly loaded canonical fixture without database interaction or mutation."""
    return load_canonical_dataset()


@router.post(
    "/optimize",
    response_model=OptimizationResult,
    summary="Synchronously optimize a validated planning dataset",
    responses={
        413: {"description": "Optimization request body exceeds the configured byte limit."},
        422: {"description": "Dataset or solver settings fail request validation."},
        503: {"description": "The bounded local optimizer capacity is currently busy."},
    },
)
def optimize(request: OptimizeRequest) -> OptimizationResult:
    """Run the CPU-bound solver in FastAPI's sync worker pool with bounded concurrency."""
    if not optimization_semaphore.acquire(blocking=False):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Optimizer is busy; retry after the current local solve completes.",
        )
    try:
        result = optimize_plan(request.dataset, request.settings)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Optimization could not be completed due to an internal error.",
        ) from None
    finally:
        optimization_semaphore.release()

    if result.status is OptimizationStatus.ERROR:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Optimization could not be completed due to an internal error.",
        )
    return result
