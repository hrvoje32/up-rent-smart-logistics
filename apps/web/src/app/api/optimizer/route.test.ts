import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/optimizer-api", () => ({
  OptimizerApiError: class OptimizerApiError extends Error {},
  getDemoDataset: vi.fn(),
  optimizeDataset: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({
  AuthConfigurationError: class AuthConfigurationError extends Error {},
  AuthenticationError: class AuthenticationError extends Error {},
  requireAuthenticatedUser: vi.fn(),
}));
vi.mock("@/lib/workspace-access", () => ({
  WorkspaceAccessError: class WorkspaceAccessError extends Error {},
  requireWorkspaceAccess: vi.fn(),
}));
vi.mock("@/lib/optimizer-rate-limit", () => ({
  OptimizerRateLimitError: class OptimizerRateLimitError extends Error {},
  assertOptimizerRateLimit: vi.fn(),
}));

import { POST } from "./route";
import { optimizeDataset } from "@/lib/optimizer-api";
import { AuthenticationError, requireAuthenticatedUser } from "@/lib/auth";
import { WorkspaceAccessError, requireWorkspaceAccess } from "@/lib/workspace-access";

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/optimizer", () => {
  it("rejects an unauthenticated production request", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(requireAuthenticatedUser).mockRejectedValue(new AuthenticationError("Potrebna je prijava."));
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));
    expect(response.status).toBe(401);
  });

  it("rejects a request from another origin", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "https://untrusted.example", host: "localhost:3000" } }));
    expect(response.status).toBe(403);
  });

  it("explains how an authenticated user creates their protected workspace", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ id: "user-1", email: "demo@example.test" });
    vi.mocked(requireWorkspaceAccess).mockRejectedValue(new WorkspaceAccessError("Workspace is absent."));

    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000" } }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("Potvrdi uvoz u cloud") });
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

  it("allows a server-verified user with workspace access in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.mocked(requireAuthenticatedUser).mockResolvedValue({ id: "user-1", email: "demo@example.test" });
    vi.mocked(requireWorkspaceAccess).mockResolvedValue();
    vi.mocked(optimizeDataset).mockResolvedValue({ status: "FEASIBLE" } as never);
    const dataset = { vehicles: [{ id: "C", max_payload_kg: 1000, max_simultaneous_machines: 1, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 40 }], machines: [{ id: "M1", weight_kg: 500 }], locations: [{ id: "L0", x: 0, y: 0 }], orders: [], parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 } };
    const response = await POST(new Request("http://localhost:3000/api/optimizer", { method: "POST", headers: { origin: "http://localhost:3000", host: "localhost:3000", "content-type": "application/json" }, body: JSON.stringify(dataset) }));
    expect(response.status).toBe(200);
    expect(requireWorkspaceAccess).toHaveBeenCalledWith("user-1");
  });
});
