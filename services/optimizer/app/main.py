"""FastAPI application entry point for the optimizer service."""

from fastapi import FastAPI

from app.api.health import router as health_router

app = FastAPI(
    title="UP RENT Optimizer API",
    version="0.1.0",
    description="Task 00 service foundation; optimization endpoints are not implemented.",
)
app.include_router(health_router)
