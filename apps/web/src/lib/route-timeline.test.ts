import { describe, expect, it } from "vitest";

import { buildSimulatedRouteTimeline, formatSimulatedTime } from "./route-timeline";
import type { DemoDataset, LoadSnapshot, VehicleRoute } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "B", max_payload_kg: 10_000, max_simultaneous_machines: 3, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M1", weight_kg: 1000 }, { id: "M2", weight_kg: 1100 }, { id: "M3", weight_kg: 1200 }],
  locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 6, y: 8 }],
  orders: [{ id: "N1", machine_id: "M1", pickup_location_id: "L0", delivery_location_id: "L1" }, { id: "N2", machine_id: "M2", pickup_location_id: "L0", delivery_location_id: "L0" }, { id: "N3", machine_id: "M3", pickup_location_id: "L1", delivery_location_id: "L0" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

const route: VehicleRoute = {
  vehicle_id: "B",
  stops: [
    { location_id: "L0", actions: [{ order_id: "N1", action_type: "PICKUP" }, { order_id: "N2", action_type: "PICKUP" }] },
    { location_id: "L1", actions: [{ order_id: "N1", action_type: "DELIVERY" }, { order_id: "N3", action_type: "PICKUP" }] },
    { location_id: "L0", actions: [{ order_id: "N2", action_type: "DELIVERY" }, { order_id: "N3", action_type: "DELIVERY" }] },
  ],
};

const snapshots: LoadSnapshot[] = [
  { vehicle_id: "B", order_id: "N1", action_type: "PICKUP", stop_index: 0, action_index: 0, load_kg: 1000, machine_count: 1 },
  { vehicle_id: "B", order_id: "N2", action_type: "PICKUP", stop_index: 0, action_index: 1, load_kg: 2100, machine_count: 2 },
  { vehicle_id: "B", order_id: "N1", action_type: "DELIVERY", stop_index: 1, action_index: 0, load_kg: 1100, machine_count: 1 },
  { vehicle_id: "B", order_id: "N3", action_type: "PICKUP", stop_index: 1, action_index: 1, load_kg: 2300, machine_count: 2 },
  { vehicle_id: "B", order_id: "N2", action_type: "DELIVERY", stop_index: 2, action_index: 0, load_kg: 1200, machine_count: 1 },
  { vehicle_id: "B", order_id: "N3", action_type: "DELIVERY", stop_index: 2, action_index: 1, load_kg: 0, machine_count: 0 },
];

describe("buildSimulatedRouteTimeline", () => {
  it("schedules depot actions, travel, ordered same-stop actions, and ending-depot deliveries sequentially", () => {
    const timeline = buildSimulatedRouteTimeline({ dataset, route, snapshots, startTime: "08:00" });
    expect(timeline.stops).toHaveLength(3);
    expect(timeline.stops[0]).toMatchObject({ travelDistanceTenthsKm: 0, travelDurationSeconds: 0, arrivalSeconds: 28_800, departureSeconds: 31_200 });
    expect(timeline.stops[0].actions.map((action) => [action.serviceStartSeconds, action.serviceFinishSeconds])).toEqual([[28_800, 30_000], [30_000, 31_200]]);
    expect(timeline.stops[1]).toMatchObject({ travelDistanceTenthsKm: 100, travelDurationSeconds: 600, arrivalSeconds: 31_800, departureSeconds: 34_200 });
    expect(timeline.stops[1].actions.map((action) => action.action.action_type)).toEqual(["DELIVERY", "PICKUP"]);
    expect(timeline.stops[2].actions.map((action) => action.action.order_id)).toEqual(["N2", "N3"]);
    expect(timeline.stops[2].actions[1].loadSnapshot).toMatchObject({ load_kg: 0, machine_count: 0 });
    expect(timeline.elapsedSeconds).toBe(8400);
    expect(formatSimulatedTime(timeline.completionSeconds)).toBe("10:20:00");
  });

  it("handles idle vehicles and does not mutate the optimized route or snapshots", () => {
    const originalRoute = structuredClone(route);
    const originalSnapshots = structuredClone(snapshots);
    const timeline = buildSimulatedRouteTimeline({ dataset, route: { vehicle_id: "B", stops: [] }, snapshots, startTime: "08:00" });
    buildSimulatedRouteTimeline({ dataset, route, snapshots, startTime: "08:00" });
    expect(timeline).toMatchObject({ elapsedSeconds: 0, completionSeconds: 28_800, stops: [] });
    expect(route).toEqual(originalRoute);
    expect(snapshots).toEqual(originalSnapshots);
  });

  it("labels cross-midnight planned times and retains the exact arrival/service sequence", () => {
    const timeline = buildSimulatedRouteTimeline({ dataset, route: { vehicle_id: "B", stops: [{ location_id: "L0", actions: [] }, { location_id: "L1", actions: [{ order_id: "N1", action_type: "PICKUP" }] }] }, snapshots: [], startTime: "23:50" });
    expect(formatSimulatedTime(timeline.stops[1].arrivalSeconds)).toBe("Dan +1 · 00:00:00");
    expect(formatSimulatedTime(timeline.stops[1].actions[0].serviceFinishSeconds)).toBe("Dan +1 · 00:20:00");
  });

  it("keeps ten pickups and ten deliveries as twenty sequential operations", () => {
    const orders = Array.from({ length: 10 }, (_, index) => ({ id: `N${index + 1}`, machine_id: `M${index + 1}`, pickup_location_id: "L0", delivery_location_id: "L0" }));
    const manyActionDataset: DemoDataset = { ...dataset, machines: orders.map((order) => ({ id: order.machine_id, weight_kg: 100 })), orders };
    const operations = orders.flatMap((order) => [{ order_id: order.id, action_type: "PICKUP" as const }, { order_id: order.id, action_type: "DELIVERY" as const }]);
    const timeline = buildSimulatedRouteTimeline({ dataset: manyActionDataset, route: { vehicle_id: "B", stops: [{ location_id: "L0", actions: operations }] }, snapshots: [], startTime: "08:00" });
    expect(timeline.stops[0].actions).toHaveLength(20);
    expect(timeline.stops[0].actions.filter((item) => item.action.action_type === "PICKUP")).toHaveLength(10);
    expect(timeline.stops[0].actions.filter((item) => item.action.action_type === "DELIVERY")).toHaveLength(10);
    expect(timeline.elapsedSeconds).toBe(24_000);
  });
});
