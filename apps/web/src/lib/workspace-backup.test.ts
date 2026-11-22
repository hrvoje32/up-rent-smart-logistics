import { describe, expect, it } from "vitest";

import { BUSINESS_WORKSPACE_STORAGE_KEY, createBusinessWorkspace, saveBusinessWorkspace } from "@/lib/business-workspace";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "@/lib/workspace-backup";
import type { DemoDataset } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M01", weight_kg: 800 }], locations: [{ id: "L0", x: 0, y: 0 }], orders: [],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, clear: () => data.clear(), getItem: (key) => data.get(key) ?? null, key: (index) => [...data.keys()][index] ?? null, removeItem: (key) => data.delete(key), setItem: (key, value) => data.set(key, value) };
}

describe("workspace backup", () => {
  it("exports complete stable workspace data and restores only new IDs", () => {
    const source = memoryStorage(); const workspace = createBusinessWorkspace(dataset);
    workspace.vehicles.push({ id: "B", display_name: "Kamion B", max_payload_kg: 5000, max_simultaneous_machines: 2, average_speed_kmh: 60, active: true, registration_number: "", description: "", notes: "" });
    workspace.runs.push({ id: "run-1", draft_id: "draft-1", draft_name: "Plan", created_at: "2026-01-01T00:00:00Z", source_snapshot: dataset, result: null, outcome: "TECHNICAL_ERROR", failure: { message: "Greška", affected_order_ids: [], constraint_details: ["Detalj"], corrective_guidance: null }, optimization_strategy: "BALANCED", require_all_selected_vehicles: false, selected_vehicle_ids: ["A"], selected_order_ids: [] });
    saveBusinessWorkspace(source, workspace);
    const backup = createWorkspaceBackup(source, dataset);
    expect(backup.workspace.runs[0]?.failure?.constraint_details).toEqual(["Detalj"]);
    const target = memoryStorage(); const current = createBusinessWorkspace(dataset);
    current.vehicles[0].display_name = "Postojeći Kamion A";
    saveBusinessWorkspace(target, current);
    const restored = restoreWorkspaceBackup(target, dataset, backup);
    expect(restored.workspace.vehicles.find((item) => item.id === "A")?.display_name).toBe("Postojeći Kamion A");
    expect(restored.workspace.vehicles.some((item) => item.id === "B")).toBe(true);
    expect(restored.workspace.runs[0]?.id).toBe("run-1");
    expect(target.getItem(BUSINESS_WORKSPACE_STORAGE_KEY)).not.toBeNull();
  });

  it("rejects an invalid backup without clearing stored data", () => {
    const storage = memoryStorage(); saveBusinessWorkspace(storage, createBusinessWorkspace(dataset));
    const before = storage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY);
    expect(() => restoreWorkspaceBackup(storage, dataset, { format: "wrong" })).toThrow();
    expect(storage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY)).toBe(before);
  });
});
