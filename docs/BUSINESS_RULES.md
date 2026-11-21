# Business Rules

Task 02 implements canonical data validation, deterministic distance/time calculations, and independent validation of a proposed route plan. It does not implement route planning or optimization behavior.

## Original UP RENT requirements

### Vehicles

| Vehicle | Maximum load | Maximum simultaneous machines | Start/end depot |
| --- | ---: | ---: | --- |
| Truck A | 3,500 kg | 2 | L0 |
| Truck B | 10,000 kg | 3 | L0 |

### Machines

| Machine | Weight | Machine | Weight |
| --- | ---: | --- | ---: |
| M01 | 800 kg | M06 | 3,900 kg |
| M02 | 1,300 kg | M07 | 4,800 kg |
| M03 | 1,800 kg | M08 | 6,100 kg |
| M04 | 2,400 kg | M09 | 7,500 kg |
| M05 | 3,100 kg | M10 | 9,400 kg |

### Locations

| Location | Cartesian coordinate | Description |
| --- | --- | --- |
| L0 | (0, 0) | depot |
| L1 | (3, 8) | — |
| L2 | (10, 11) | — |
| L3 | (17, 9) | — |
| L4 | (9, -6) | — |
| L5 | (26, 3) | — |
| L6 | (-7, 13) | — |
| L7 | (20, -8) | — |
| L8 | (23, 15) | — |
| L9 | (-8, -5) | — |

### Transport orders

| Order | Machine | Pickup | Delivery |
| --- | --- | --- | --- |
| N01 | M01 | L1 | L3 |
| N02 | M02 | L2 | L5 |
| N03 | M03 | L9 | L4 |
| N04 | M04 | L3 | L0 |
| N05 | M05 | L0 | L8 |
| N06 | M06 | L5 | L7 |
| N07 | M07 | L8 | L2 |
| N08 | M08 | L4 | L9 |
| N09 | M09 | L6 | L1 |
| N10 | M10 | L7 | L3 |

### Routing constraints and outputs

- Use Euclidean distance between locations and round every route segment to one decimal kilometre.
- Both trucks travel at an average of 60 km/h; drivers may drive no more than nine hours per day.
- Each pickup and delivery takes 20 minutes.
- Each pickup must occur before its matching delivery, and one truck must perform both actions.
- A truck may never exceed its weight capacity or simultaneous-machine limit.
- Every truck starts and returns to L0. The objective is to minimize combined travel distance.
- Clearly identify unserviceable orders.
- For every truck, report the ordered locations; pickup/delivery actions; current load weight and number of machines after each action; total distance; and completed-order count. Also report combined distance and warnings for unserviceable orders.

## Canonical data and calculation interpretation

The original assessment input is stored unchanged in `fixtures/up_rent_case.json`. It contains vehicles, machines, Cartesian locations, orders, and the shared depot/time parameters. The validator requires unique IDs, positive capacities/weights/counts/durations, finite coordinates, and valid machine, location, and depot references.

Euclidean segments are rounded **individually**, half-up, to one decimal kilometre. Internally they are represented as integer tenths of a kilometre: for example, 8.5 km is `85`. A route total is the sum of those already rounded segments; it is not a raw geometric total rounded once at the end.

At 60 km/h, 1.0 km takes 60 seconds and 0.1 km takes 6 seconds. Driving time, pickup service time, delivery service time, and total elapsed time are separate values. The 540-minute limit applies to driving time only, not automatically to service-inclusive elapsed time.

N04's delivery at L0 and N05's pickup at L0 are valid. Future optimization must preserve a pickup at the starting depot and a delivery at the ending depot.

## Independent plan validation

Plans are composed of ordered vehicle routes, ordered stops, and ordered pickup/delivery actions. A stop may contain several actions, locations may repeat, and depot visits without explicit actions have no transport effect. Both trucks must start and finish at L0; intermediate L0 visits and a depot-only idle route are valid.

The validator requires exactly one pickup and delivery per order, in that order, at their specified locations, using the same vehicle. It tracks kilograms and machines after every action, checks capacity after each pickup, requires every route to finish empty, and enforces the 540-minute limit only on recomputed driving time. It reports structured facts rather than solver assumptions, including incomplete/unserved orders and stable error codes for violations.

The canonical reference baseline deliberately leaves Truck A idle and sends Truck B on one order at a time, returning to L0 between orders. It is a verification comparison only—not an optimized plan. The validator calculates 477.2 km, 477.2 minutes driving, 400 minutes service, and 877.2 minutes elapsed time for it.

## Planned additional functionality

The future platform may add dispatcher dashboards, fleet and driver management, scenario simulation, real geographic maps, inspection workflows, consent-based GPS tracking, analytics, AI document extraction, AI explanations, and reporting. These items are not original routing constraints and are not implemented in Task 00.
