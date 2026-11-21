"""FastAPI application entry point for the optimizer service."""

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.middleware import RequestBodyLimitMiddleware
from app.api.optimization import router as optimization_router

app = FastAPI(
    title="UP RENT Optimizer API",
    version="0.1.0",
    description="Local controlled-demo API for independently validated route optimization.",
)
app.add_middleware(RequestBodyLimitMiddleware)
app.include_router(health_router)
app.include_router(optimization_router)
