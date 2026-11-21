from app.domain.dataset import load_canonical_dataset
from app.domain.time import (
    delivery_service_time_seconds,
    driving_time_seconds,
    pickup_service_time_seconds,
    planned_elapsed_time_seconds,
)


def test_driving_time_is_calculated_separately_at_canonical_speed() -> None:
    vehicle = load_canonical_dataset().vehicles[0]

    assert driving_time_seconds(10, vehicle) == 60
    assert driving_time_seconds(85, vehicle) == 510


def test_pickup_delivery_and_elapsed_service_times_are_correct() -> None:
    dataset = load_canonical_dataset()
    vehicle = dataset.vehicles[0]
    parameters = dataset.parameters

    assert parameters.max_driving_seconds == 32400
    assert pickup_service_time_seconds(2, parameters) == 2400
    assert delivery_service_time_seconds(3, parameters) == 3600
    elapsed_seconds = planned_elapsed_time_seconds(
        85, vehicle, parameters, pickup_count=2, delivery_count=3
    )
    assert elapsed_seconds == 6510
