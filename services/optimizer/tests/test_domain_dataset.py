import json
from copy import deepcopy
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.domain.dataset import CANONICAL_DATASET_PATH, load_canonical_dataset
from app.domain.models import Location, Machine, PlanningDataset, PlanningParameters, Vehicle

REPOSITORY_CANONICAL_DATASET_PATH = (
    Path(__file__).resolve().parents[3] / "fixtures" / "up_rent_case.json"
)


@pytest.fixture
def canonical_payload() -> dict[str, object]:
    return json.loads(CANONICAL_DATASET_PATH.read_text(encoding="utf-8"))


def test_canonical_dataset_loads_from_any_working_directory(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.chdir(tmp_path)

    dataset = load_canonical_dataset()

    assert dataset.parameters.depot_location_id == "L0"
    assert len(dataset.vehicles) == 2
    assert len(dataset.machines) == 10
    assert len(dataset.locations) == 10
    assert len(dataset.orders) == 10


def test_packaged_canonical_dataset_matches_the_repository_source() -> None:
    """The deployable package data must not drift from the assessment fixture."""
    assert CANONICAL_DATASET_PATH.read_bytes() == REPOSITORY_CANONICAL_DATASET_PATH.read_bytes()


def test_canonical_vehicles_and_machine_weights_are_exact() -> None:
    dataset = load_canonical_dataset()

    vehicles = {vehicle.id: vehicle for vehicle in dataset.vehicles}
    machines = {machine.id: machine.weight_kg for machine in dataset.machines}

    assert vehicles["A"].max_payload_kg == 3500
    assert vehicles["A"].max_simultaneous_machines == 2
    assert vehicles["B"].max_payload_kg == 10000
    assert vehicles["B"].max_simultaneous_machines == 3
    assert machines == {
        "M01": 800,
        "M02": 1300,
        "M03": 1800,
        "M04": 2400,
        "M05": 3100,
        "M06": 3900,
        "M07": 4800,
        "M08": 6100,
        "M09": 7500,
        "M10": 9400,
    }


def test_canonical_locations_and_order_references_are_exact() -> None:
    dataset = load_canonical_dataset()
    orders = {order.id: order for order in dataset.orders}
    locations = {location.id: (location.x, location.y) for location in dataset.locations}

    assert locations == {
        "L0": (0.0, 0.0), "L1": (3.0, 8.0), "L2": (10.0, 11.0), "L3": (17.0, 9.0),
        "L4": (9.0, -6.0), "L5": (26.0, 3.0), "L6": (-7.0, 13.0), "L7": (20.0, -8.0),
        "L8": (23.0, 15.0), "L9": (-8.0, -5.0),
    }
    assert {
        order_id: (order.machine_id, order.pickup_location_id, order.delivery_location_id)
        for order_id, order in orders.items()
    } == {
        "N01": ("M01", "L1", "L3"), "N02": ("M02", "L2", "L5"),
        "N03": ("M03", "L9", "L4"), "N04": ("M04", "L3", "L0"),
        "N05": ("M05", "L0", "L8"), "N06": ("M06", "L5", "L7"),
        "N07": ("M07", "L8", "L2"), "N08": ("M08", "L4", "L9"),
        "N09": ("M09", "L6", "L1"), "N10": ("M10", "L7", "L3"),
    }
    assert orders["N04"].delivery_location_id == "L0"
    assert orders["N05"].pickup_location_id == "L0"


def test_missing_machine_reference_fails(canonical_payload: dict[str, object]) -> None:
    payload = deepcopy(canonical_payload)
    orders = payload["orders"]
    assert isinstance(orders, list)
    orders[0]["machine_id"] = "M99"

    with pytest.raises(ValidationError, match="unknown machine 'M99'"):
        PlanningDataset.model_validate(payload)


def test_missing_location_reference_fails(canonical_payload: dict[str, object]) -> None:
    payload = deepcopy(canonical_payload)
    orders = payload["orders"]
    assert isinstance(orders, list)
    orders[0]["pickup_location_id"] = "L99"

    with pytest.raises(ValidationError, match="unknown location 'L99'"):
        PlanningDataset.model_validate(payload)


def test_duplicate_identifiers_fail(canonical_payload: dict[str, object]) -> None:
    payload = deepcopy(canonical_payload)
    vehicles = payload["vehicles"]
    assert isinstance(vehicles, list)
    vehicles[1]["id"] = "A"

    with pytest.raises(ValidationError, match="duplicate vehicle id"):
        PlanningDataset.model_validate(payload)


def test_missing_depot_reference_fails(canonical_payload: dict[str, object]) -> None:
    payload = deepcopy(canonical_payload)
    parameters = payload["parameters"]
    assert isinstance(parameters, dict)
    parameters["depot_location_id"] = "L99"

    with pytest.raises(ValidationError, match="unknown location 'L99'"):
        PlanningDataset.model_validate(payload)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (Machine, {"id": "M99", "weight_kg": 0}),
        (
            Vehicle,
            {
                "id": "C",
                "max_payload_kg": 0,
                "max_simultaneous_machines": 1,
                "start_location_id": "L0",
                "end_location_id": "L0",
                "average_speed_kmh": 60,
            },
        ),
        (Location, {"id": "L99", "x": float("inf"), "y": 0}),
        (
            Vehicle,
            {
                "id": "C",
                "max_payload_kg": 100,
                "max_simultaneous_machines": 0,
                "start_location_id": "L0",
                "end_location_id": "L0",
                "average_speed_kmh": 60,
            },
        ),
    ],
)
def test_invalid_model_values_fail(
    model: type[Machine] | type[Vehicle] | type[Location], payload: dict[str, object]
) -> None:
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"depot_location_id": "L0", "max_driving_minutes": 0,
         "pickup_service_minutes": 20, "delivery_service_minutes": 20},
        {"depot_location_id": "L0", "max_driving_minutes": 540,
         "pickup_service_minutes": 0, "delivery_service_minutes": 20},
        {"depot_location_id": "L0", "max_driving_minutes": 540,
         "pickup_service_minutes": 20, "delivery_service_minutes": 0},
    ],
)
def test_invalid_planning_durations_fail(payload: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        PlanningParameters.model_validate(payload)
