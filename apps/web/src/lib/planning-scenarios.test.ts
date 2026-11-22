import { describe, expect, it } from "vitest";

import { createCustomScenario, createOriginalScenario, createSavedPlan, deleteScenarioRecord, exportScenario, importScenario, loadCustomScenarios, loadSavedPlans, resetScenarioFromCanonical, saveCustomScenarios, saveSavedPlans, scenarioToOptimizerDataset, updateOptimizationSelection, upsertScenarioRecord } from "./planning-scenarios";
import type { DemoDataset } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 5000, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: -4, y: 5 }],
  machines: [{ id: "M1", weight_kg: 900 }],
  orders: [{ id: "O1", machine_id: "M1", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return { get length() { return values.size; }, clear: () => values.clear(), getItem: (key) => values.get(key) ?? null, key: () => null, removeItem: (key) => values.delete(key), setItem: (key, value) => values.set(key, value) };
}

describe("planning scenarios", () => {
  it("keeps the original assessment immutable and creates an independent custom copy", () => {
    const original = createOriginalScenario(dataset);
    const custom = createCustomScenario(dataset, "Workshop moves");
    expect(original.kind).toBe("ORIGINAL");
    expect(() => upsertScenarioRecord(original, "vehicles", { ...original.vehicles[0], max_payload_kg: 1 })).toThrow(/samo za čitanje/i);
    const updated = upsertScenarioRecord(custom, "vehicles", { ...custom.vehicles[0], max_payload_kg: 6500 });
    expect(updated.vehicles[0].max_payload_kg).toBe(6500);
    expect(dataset.vehicles[0].max_payload_kg).toBe(5000);
  });

  it("resets a custom scenario from a newly loaded canonical dataset without modifying the original", () => {
    const custom = createCustomScenario(dataset, "Resettable");
    const changed = upsertScenarioRecord(custom, "vehicles", { ...custom.vehicles[0], max_payload_kg: 6500 });
    const reset = resetScenarioFromCanonical(changed, dataset);
    expect(reset.name).toBe("Resettable");
    expect(reset.revision).toBe(changed.revision + 1);
    expect(reset.vehicles[0].max_payload_kg).toBe(5000);
    expect(dataset.vehicles[0].max_payload_kg).toBe(5000);
  });

  it("validates CRUD references and protects referenced records from deletion", () => {
    let scenario = createCustomScenario(dataset, "Custom");
    scenario = upsertScenarioRecord(scenario, "machine_types", { id: "T1", name: "Excavator", default_weight_kg: null, description: "" });
    scenario = upsertScenarioRecord(scenario, "machines", { ...scenario.machines[0], machine_type_id: "T1" });
    expect(() => deleteScenarioRecord(scenario, "machine_types", "T1")).toThrow(/još koristi/i);
    expect(() => deleteScenarioRecord(scenario, "locations", "L0")).toThrow(/još koristi/i);
    expect(() => upsertScenarioRecord(scenario, "orders", { id: "O2", machine_id: "unknown", pickup_location_id: "L0", delivery_location_id: "L1", notes: "", status: "PENDING" })).toThrow(/nepoznati stroj/i);
  });

  it("uses active vehicles only for an optimizer dataset and preserves explicit weights", () => {
    let scenario = createCustomScenario(dataset, "Custom");
    scenario = upsertScenarioRecord(scenario, "vehicles", { ...scenario.vehicles[0], active: false });
    expect(() => scenarioToOptimizerDataset(scenario)).toThrow(/Aktivirajte/i);
    scenario = upsertScenarioRecord(scenario, "vehicles", { ...scenario.vehicles[0], active: true });
    const optimizerDataset = scenarioToOptimizerDataset(scenario);
    expect(optimizerDataset.machines[0].weight_kg).toBe(900);
    expect(optimizerDataset.locations[1].x).toBe(-4);
  });

  it("uses only the explicitly selected fleet and active transport orders", () => {
    let scenario = createCustomScenario(dataset, "Odabir");
    scenario = updateOptimizationSelection(scenario, { vehicle_ids: ["A"], order_ids: ["O1"] });
    const optimizerDataset = scenarioToOptimizerDataset(scenario);
    expect(optimizerDataset.vehicles.map((vehicle) => vehicle.id)).toEqual(["A"]);
    expect(optimizerDataset.orders.map((order) => order.id)).toEqual(["O1"]);
    scenario = upsertScenarioRecord(scenario, "orders", { ...scenario.orders[0], status: "CANCELLED" });
    expect(() => scenarioToOptimizerDataset(scenario)).toThrow(/barem jedan aktivan transportni nalog/i);
  });

  it("uses per-plan route settings while vehicle master data remains depot-independent", () => {
    let scenario = createCustomScenario(dataset, "Vožnja");
    scenario = updateOptimizationSelection(scenario, { ...scenario.selection, vehicle_routes: { A: { start_location_id: "L1", end_location_id: "L0" } } });
    expect(scenario.vehicles[0]).not.toHaveProperty("start_location_id");
    expect(scenarioToOptimizerDataset(scenario).vehicles[0]).toMatchObject({ start_location_id: "L1", end_location_id: "L0" });
  });

  it("safely restores stored scenarios, rejects corrupt storage, and versioned imports create a new custom scenario", () => {
    const storage = memoryStorage();
    const scenario = createCustomScenario(dataset, "Stored");
    saveCustomScenarios(storage, [scenario]);
    expect(loadCustomScenarios(storage)).toHaveLength(1);
    const imported = importScenario(exportScenario(scenario));
    expect(imported.id).not.toBe(scenario.id);
    storage.setItem("up-rent.planning-scenarios.v1", "not json");
    expect(loadCustomScenarios(storage)).toEqual([]);
  });

  it("saves route snapshots with scenario revision so changed scenarios become stale", () => {
    const storage = memoryStorage();
    const scenario = createCustomScenario(dataset, "Saved plan scenario");
    const plan = createSavedPlan("First route", scenario, { status: "FEASIBLE" });
    saveSavedPlans(storage, [plan]);
    expect(loadSavedPlans(storage)[0].scenario_revision).toBe(scenario.revision);
    const changed = upsertScenarioRecord(scenario, "vehicles", { ...scenario.vehicles[0], max_payload_kg: 6000 });
    expect(plan.scenario_revision).not.toBe(changed.revision);
  });
});
