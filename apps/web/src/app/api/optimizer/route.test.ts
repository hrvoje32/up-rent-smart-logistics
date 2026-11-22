import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/optimizer-api", () => ({
  OptimizerApiError: class OptimizerApiError extends Error {},
  getDemoDataset: vi.fn(),
  optimizeDataset: vi.fn(),
}));

import { POST } from "./route";
import { optimizeDataset } from "@/lib/optimizer-api";

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/optimizer", () => {
  it("fails closed in a production build", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(response.status).toBe(403);
  });

  it("rejects a request from another origin", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "https://untrusted.example", host: "localhost:3000" } }));
    expect(response.status).toBe(403);
  });

  it("forwards a validated custom dataset only in the local environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const customDataset = { vehicles: [{ id: "C", max_payload_kg: 1000, max_simultaneous_machines: 1, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 40 }], machines: [{ id: "M1", weight_kg: 500 }], locations: [{ id: "L0", x: 0, y: 0 }], orders: [], parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 } };
    vi.mocked(optimizeDataset).mockResolvedValue({ status: "FEASIBLE" } as never);
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(customDataset) }));
    expect(response.status).toBe(200);
    expect(optimizeDataset).toHaveBeenCalledWith(expect.objectContaining(customDataset), {});
  });

  it("unwraps dashboard datasets and forwards draft strategy settings", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const customDataset = { vehicles: [{ id: "C", max_payload_kg: 1000, max_simultaneous_machines: 1, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 40 }], machines: [{ id: "M1", weight_kg: 500 }], locations: [{ id: "L0", x: 0, y: 0 }], orders: [{ id: "N1", machine_id: "M1", pickup_location_id: "L0", delivery_location_id: "L0", earliest_pickup_at: "2026-01-15T08:00:00+01:00" }], parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20, planning_start_at: "2026-01-15T07:30:00+01:00" } };
    vi.mocked(optimizeDataset).mockResolvedValue({ status: "FEASIBLE" } as never);

    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify({ dataset: customDataset, settings: { optimization_strategy: "BALANCED", require_all_selected_vehicles: true } }) }));

    expect(response.status).toBe(200);
    expect(optimizeDataset).toHaveBeenCalledWith(expect.objectContaining({ parameters: expect.objectContaining({ planning_start_at: "2026-01-15T07:30:00+01:00" }), orders: [expect.objectContaining({ earliest_pickup_at: "2026-01-15T08:00:00+01:00" })] }), { optimization_strategy: "BALANCED", require_all_selected_vehicles: true });
  });
});
