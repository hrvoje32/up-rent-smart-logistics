import pytest

from app.domain.dataset import load_canonical_dataset
from app.domain.distance import (
    build_distance_matrix,
    distance_between_location_ids,
    distance_between_locations,
    round_kilometres_to_tenths,
    route_distance_tenths,
    tenths_to_kilometres,
)
from app.domain.models import Location


def test_reference_distances_and_negative_coordinates_are_correct() -> None:
    dataset = load_canonical_dataset()
    locations = dataset.locations_by_id

    assert tenths_to_kilometres(distance_between_location_ids(locations, "L0", "L1")) == 8.5
    assert tenths_to_kilometres(distance_between_location_ids(locations, "L0", "L3")) == 19.2
    assert tenths_to_kilometres(distance_between_location_ids(locations, "L0", "L9")) == 9.4
    negative_location = Location(id="NEG", x=-3, y=-4)
    origin_location = Location(id="ZERO", x=0, y=0)
    assert distance_between_locations(negative_location, origin_location) == 50


def test_distance_matrix_is_symmetric_and_zero_on_the_diagonal() -> None:
    dataset = load_canonical_dataset()
    matrix = build_distance_matrix(dataset.locations)

    for first_location in dataset.locations:
        assert matrix[first_location.id][first_location.id] == 0
        for second_location in dataset.locations:
            first_distance = matrix[first_location.id][second_location.id]
            second_distance = matrix[second_location.id][first_location.id]
            assert first_distance == second_distance


def test_segment_rounding_uses_half_up_boundaries() -> None:
    assert round_kilometres_to_tenths(1.04) == 10
    assert round_kilometres_to_tenths(1.05) == 11
    with pytest.raises(ValueError, match="finite non-negative"):
        round_kilometres_to_tenths(-0.1)


def test_route_totals_sum_each_individually_rounded_segment() -> None:
    dataset = load_canonical_dataset()
    matrix = build_distance_matrix(dataset.locations)

    assert tenths_to_kilometres(route_distance_tenths(("L0", "L1", "L3", "L0"), matrix)) == 41.7
    assert tenths_to_kilometres(route_distance_tenths(("L0", "L9", "L4", "L0"), matrix)) == 37.2
