import { describe, expect, it } from "vitest";

import { buildInfeasibilityWarnings } from "./infeasible-order-warnings";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = { vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 1, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }], machines: [{ id: "M10", weight_kg: 9400 }], locations: [{ id: "L0", x: 0, y: 0 }], orders: [{ id: "N10", machine_id: "M10", pickup_location_id: "L0", delivery_location_id: "L0" }], parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 } };
const base: OptimizationResult = { status: "INFEASIBLE", solver_status: null, solver_duration_seconds: 0, plan: null, validation_result: null, violations: [], baseline_comparison: null, diagnostic_message: null };

describe("infeasible order warnings", () => {
  it("reports a proven overweight order with concrete selected capacities", () => {
    const warnings = buildInfeasibilityWarnings(dataset, { ...base, violations: [{ code: "UNSERVICEABLE_ORDER", description: "too heavy", vehicle_id: null, order_id: "N10", stop_index: null, action_index: null }] });
    expect(warnings.orders[0]).toMatchObject({ kind: "PROVEN_INFEASIBLE", order: { id: "N10", machine_id: "M10" }, machineWeightKg: 9400 });
    expect(warnings.orders[0]?.explanation).toContain("3.500 kg");
  });

  it("does not blame an individual order when the search merely timed out", () => {
    const warnings = buildInfeasibilityWarnings(dataset, { ...base, status: "NO_SOLUTION_FOUND", violations: [{ code: "SOLVER_NO_SOLUTION", description: "search limit", vehicle_id: null, order_id: null, stop_index: null, action_index: null }] });
    expect(warnings.orders).toEqual([]);
    expect(warnings.global[0]?.kind).toBe("SEARCH_INCOMPLETE");
  });
});
