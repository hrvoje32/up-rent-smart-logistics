"""Canonical dataset loading with a location independent of the current working directory."""

from __future__ import annotations

from pathlib import Path

from app.domain.models import PlanningDataset

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
CANONICAL_DATASET_PATH = REPOSITORY_ROOT / "fixtures" / "up_rent_case.json"


def load_dataset(path: Path) -> PlanningDataset:
    """Load and validate a planning dataset from JSON at an explicit path."""
    return PlanningDataset.model_validate_json(path.read_text(encoding="utf-8"))


def load_canonical_dataset() -> PlanningDataset:
    """Load the repository's canonical UP RENT assessment dataset."""
    return load_dataset(CANONICAL_DATASET_PATH)
