import { describe, expect, it } from "vitest";

import { buildTransportPlanCsv } from "./plan-export";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [
    { id: "A", max_payload_kg: 5000, max_simultaneous_machines: 2, average_speed_kmh: 60, start_location_id: "L0", end_location_id: "L0" },
    { id: "B", max_payload_kg: 10000, max_simultaneous_machines: 3, average_speed_kmh: 60, start_location_id: "L0", end_location_id: "L0" },
  ],
  machines: [{ id: "M01", weight_kg: 1200 }],
  locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 3, y: 4 }],
  orders: [{ id: "N01", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

const result: OptimizationResult = {
  status: "FEASIBLE",
  solver_status: 1,
  solver_duration_seconds: 0.1,
  plan: { routes: [{ vehicle_id: "A", stops: [{ location_id: "L0", actions: [{ order_id: "N01", action_type: "PICKUP" }] }, { location_id: "L1", actions: [{ order_id: "N01", action_type: "DELIVERY" }] }, { location_id: "L0", actions: [] }] }, { vehicle_id: "B", stops: [] }] },
  validation_result: {
    is_valid: true,
    is_complete: true,
    per_vehicle_validity: { A: true, B: true },
    violations: [],
    unserved_order_ids: [],
    completed_order_counts: { A: 1, B: 0 },
    route_metrics: [],
    combined_distance_tenths_km: 100,
    combined_driving_time_seconds: 600,
    combined_pickup_service_seconds: 1200,
    combined_delivery_service_seconds: 1200,
    combined_total_service_seconds: 2400,
    combined_total_elapsed_seconds: 3000,
    load_snapshots: [
      { vehicle_id: "A", order_id: "N01", action_type: "PICKUP", stop_index: 0, action_index: 0, load_kg: 1200, machine_count: 1 },
      { vehicle_id: "A", order_id: "N01", action_type: "DELIVERY", stop_index: 1, action_index: 0, load_kg: 0, machine_count: 0 },
    ],
  },
  violations: [],
  baseline_comparison: null,
  diagnostic_message: null,
};

describe("buildTransportPlanCsv", () => {
  it("exports ordered operations, simulated times, validated loads and idle vehicles", () => {
    const csv = buildTransportPlanCsv({ dataset, result, startTime: "08:00" });

    expect(csv).toContain("Vozilo;Stajanje;Lokacija;Dionica");
    expect(csv).toContain("A;1;L0;0,0 km;0 min;08:00:00;Preuzimanje;N01;M01;08:00:00;08:20:00;08:20:00;1200 kg;1");
    expect(csv).toContain("A;2;L1;5,0 km;5 min;08:25:00;Isporuka;N01;M01;08:25:00;08:45:00;08:45:00;0 kg;0");
    expect(csv).toContain("B;—;L0;0,0 km;0 min;—;Nije korišten u ovom planu;—;—;—;—;—;0 kg;0");
  });
});
