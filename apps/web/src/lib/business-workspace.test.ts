import { describe, expect, it } from "vitest";

import { createBusinessWorkspace, createDraftFromOptimizationRun, createFailedOptimizationRun, createNewDraft, createOptimizationRun, createOriginalDraft, draftToDataset, duplicateDraft, updateDraft } from "./business-workspace";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M01", weight_kg: 800 }], locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 1, y: 0 }],
  orders: [{ id: "N01", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

const runResult: OptimizationResult = { status: "FEASIBLE", solver_status: 1, solver_duration_seconds: 0.1, plan: null, validation_result: { is_valid: true, is_complete: true, per_vehicle_validity: { A: true }, violations: [], unserved_order_ids: [], completed_order_counts: { A: 1 }, route_metrics: [], combined_distance_tenths_km: 0, combined_driving_time_seconds: 0, combined_pickup_service_seconds: 0, combined_delivery_service_seconds: 0, combined_total_service_seconds: 0, combined_total_elapsed_seconds: 0, load_snapshots: [] }, violations: [], baseline_comparison: null, diagnostic_message: null };

describe("business workspace", () => {
  it("keeps master records independent while each new draft starts empty", () => {
    const workspace = createBusinessWorkspace(dataset);
    const first = createNewDraft(workspace);
    const second = createNewDraft(workspace);
    first.vehicle_ids = ["A"]; first.order_ids = ["N01"]; first.vehicle_routes.A = { start_location_id: "L0", end_location_id: "L0" };

    const input = draftToDataset(workspace, first, dataset.parameters);
    workspace.vehicles[0].max_payload_kg = 5000;

    expect(second.vehicle_ids).toEqual([]);
    expect(second.order_ids).toEqual([]);
    expect(input.vehicles[0].max_payload_kg).toBe(3500);
    expect(workspace.orders[0].id).toBe("N01");
  });

  it("duplicates draft settings without sharing route selections", () => {
    const workspace = createBusinessWorkspace(dataset);
    const configured = updateDraft(createOriginalDraft(workspace, dataset), {
      name: "Jutarnji plan",
      planning_start_at: "2026-01-15T08:30:00+01:00",
      optimization_strategy: "FASTEST_DELIVERY",
      require_all_selected_vehicles: true,
    });
    const copy = duplicateDraft(configured);
    copy.vehicle_routes.A.start_location_id = "L1";

    expect(copy.id).not.toBe(configured.id);
    expect(copy.name).toBe("Jutarnji plan kopija");
    expect(copy.planning_start_at).toBe("2026-01-15T08:30:00+01:00");
    expect(copy.optimization_strategy).toBe("FASTEST_DELIVERY");
    expect(copy.require_all_selected_vehicles).toBe(true);
    expect(configured.vehicle_routes.A.start_location_id).toBe("L0");
  });

  it("keeps an immutable run snapshot and makes a separate reusable draft", () => {
    const workspace = createBusinessWorkspace(dataset);
    const draft = createOriginalDraft(workspace, dataset);
    draft.optimization_strategy = "FASTEST_DELIVERY";
    const run = createOptimizationRun(draft, dataset, runResult);
    draft.vehicle_ids.length = 0;
    dataset.orders[0]!.pickup_location_id = "L1";
    const restored = createDraftFromOptimizationRun(run);

    expect(run.selected_vehicle_ids).toEqual(["A"]);
    expect(run.source_snapshot.orders[0]?.pickup_location_id).toBe("L0");
    expect(restored.id).not.toBe(run.draft_id);
    expect(restored.optimization_strategy).toBe("FASTEST_DELIVERY");
    expect(restored.vehicle_routes.A).toEqual({ start_location_id: "L0", end_location_id: "L0" });
  });

  it("records an explicit failed attempt without fabricating a route result", () => {
    const workspace = createBusinessWorkspace(dataset);
    const draft = createOriginalDraft(workspace, dataset);
    const failed = createFailedOptimizationRun(draft, dataset, "TECHNICAL_ERROR", { message: "Optimizator nije dostupan.", affected_order_ids: [], constraint_details: [], corrective_guidance: null });

    expect(failed.outcome).toBe("TECHNICAL_ERROR");
    expect(failed.result).toBeNull();
    expect(failed.source_snapshot).toEqual(dataset);
    expect(createDraftFromOptimizationRun(failed).order_ids).toEqual(["N01"]);
  });
});
