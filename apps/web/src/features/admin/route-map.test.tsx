import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteMap } from "./route-map";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 2, average_speed_kmh: 60, start_location_id: "DEP", end_location_id: "DEP" }, { id: "B", max_payload_kg: 10000, max_simultaneous_machines: 3, average_speed_kmh: 60, start_location_id: "DEP", end_location_id: "DEP" }],
  machines: [{ id: "M1", weight_kg: 1200 }, { id: "M2", weight_kg: 800 }],
  locations: [{ id: "DEP", x: -2, y: 0 }, { id: "L1", x: 0, y: 0 }, { id: "L2", x: 5, y: 3 }],
  orders: [{ id: "N1", machine_id: "M1", pickup_location_id: "DEP", delivery_location_id: "L2" }, { id: "N2", machine_id: "M2", pickup_location_id: "L2", delivery_location_id: "L2" }],
  parameters: { depot_location_id: "DEP", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

const result: OptimizationResult = {
  status: "FEASIBLE", solver_status: 1, solver_duration_seconds: 0.1,
  plan: { routes: [{ vehicle_id: "A", stops: [] }, { vehicle_id: "B", stops: [{ location_id: "DEP", actions: [{ order_id: "N1", action_type: "PICKUP" }] }, { location_id: "L2", actions: [{ order_id: "N1", action_type: "DELIVERY" }, { order_id: "N2", action_type: "PICKUP" }, { order_id: "N2", action_type: "DELIVERY" }] }, { location_id: "DEP", actions: [] }] }] },
  validation_result: { is_valid: true, is_complete: true, per_vehicle_validity: { A: true, B: true }, violations: [], unserved_order_ids: [], completed_order_counts: { A: 0, B: 2 }, route_metrics: [{ vehicle_id: "A", route_index: 0, distance_tenths_km: 0, driving_time_seconds: 0, pickup_service_seconds: 0, delivery_service_seconds: 0, total_service_seconds: 0, total_elapsed_seconds: 0, completed_order_count: 0, is_valid: true }, { vehicle_id: "B", route_index: 1, distance_tenths_km: 120, driving_time_seconds: 720, pickup_service_seconds: 2400, delivery_service_seconds: 2400, total_service_seconds: 4800, total_elapsed_seconds: 5520, completed_order_count: 2, is_valid: true }], combined_distance_tenths_km: 120, combined_driving_time_seconds: 720, combined_pickup_service_seconds: 2400, combined_delivery_service_seconds: 2400, combined_total_service_seconds: 4800, combined_total_elapsed_seconds: 5520, load_snapshots: [{ vehicle_id: "B", order_id: "N1", action_type: "PICKUP", stop_index: 0, action_index: 0, load_kg: 1200, machine_count: 1 }, { vehicle_id: "B", order_id: "N1", action_type: "DELIVERY", stop_index: 1, action_index: 0, load_kg: 0, machine_count: 0 }, { vehicle_id: "B", order_id: "N2", action_type: "PICKUP", stop_index: 1, action_index: 1, load_kg: 800, machine_count: 1 }, { vehicle_id: "B", order_id: "N2", action_type: "DELIVERY", stop_index: 1, action_index: 2, load_kg: 0, machine_count: 0 }] },
  violations: [], baseline_comparison: null, diagnostic_message: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RouteMap", () => {
  it("shows submitted Cartesian locations, an idle vehicle and one grouped marker for same-location actions", () => {
    render(<RouteMap dataset={dataset} result={result} />);
    expect(screen.getByRole("heading", { name: "Shematski prikaz ruta (X/Y)" })).toBeInTheDocument();
    expect(screen.getByText("Nije korišten u ovom planu")).toBeInTheDocument();
    expect(screen.getByLabelText("Kamion B, stajanje 2, L2: 1 preuzimanje, 2 isporuka")).toBeInTheDocument();
    expect(screen.getByText("↕")).toBeInTheDocument();
    expect(screen.getByText("početni/završni depo")).toBeInTheDocument();
    expect(screen.getByText("↑↓ 3 radnje")).toBeInTheDocument();
  });

  it("makes route visibility and action details keyboard-accessible", () => {
    render(<RouteMap dataset={dataset} result={result} />);
    fireEvent.click(screen.getByRole("button", { name: "Sakrij sve rute" }));
    expect(screen.getByRole("status")).toHaveTextContent("Sve aktivne rute su skrivene.");
    fireEvent.click(screen.getByRole("button", { name: "Prikaži sve rute" }));
    const stop = screen.getByLabelText("Kamion B, stajanje 2, L2: 1 preuzimanje, 2 isporuka");
    fireEvent.keyDown(stop, { key: "Enter" });
    expect(screen.getAllByText(/800 kg · nalog N2/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Teret nakon radnje")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Povećaj kartu" }));
    fireEvent.click(screen.getByRole("button", { name: "Vrati prikaz" }));
  });

  it("keeps repeated visits in an ordered stop list synchronized with the selected map marker", () => {
    render(<RouteMap dataset={dataset} result={result} />);
    const stopList = screen.getByLabelText("Slijed stajanja za Kamion B");
    expect(within(stopList).getAllByRole("button")).toHaveLength(3);
    fireEvent.click(within(stopList).getByRole("button", { name: /2.*L2.*3 radnje/i }));
    expect(screen.getByText(/Stajanje 2 · L2 · Kamion B/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Odaberi Kamion A" }));
    expect(screen.getByText("Nije korišten u ovom planu")).toBeInTheDocument();
  });

  it("scales controls and legend to ten vehicles without hardcoded IDs", () => {
    const fleet = Array.from({ length: 10 }, (_, index) => ({ id: `V${index + 1}`, max_payload_kg: 5000, max_simultaneous_machines: 2, average_speed_kmh: 50, start_location_id: "DEP", end_location_id: "DEP" }));
    const largeDataset: DemoDataset = { ...dataset, vehicles: fleet };
    const largeResult: OptimizationResult = { ...result, plan: { routes: fleet.map((vehicle) => ({ vehicle_id: vehicle.id, stops: [] })) }, validation_result: { ...result.validation_result!, per_vehicle_validity: Object.fromEntries(fleet.map((vehicle) => [vehicle.id, true])), completed_order_counts: Object.fromEntries(fleet.map((vehicle) => [vehicle.id, 0])), route_metrics: fleet.map((vehicle, index) => ({ ...result.validation_result!.route_metrics[0]!, vehicle_id: vehicle.id, route_index: index })) } };
    render(<RouteMap dataset={largeDataset} result={largeResult} />);
    expect(within(screen.getByLabelText("Vozila i vidljivost ruta")).getAllByRole("checkbox")).toHaveLength(10);
  });

  it("does not draw a fictional map for a non-feasible result", () => {
    render(<RouteMap dataset={dataset} result={{ ...result, status: "INFEASIBLE", plan: null, validation_result: null }} />);
    expect(screen.getByText("Karta nije dostupna jer optimizacija nije proizvela valjanu rutu.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Shematska animacija izračunate rute")).not.toBeInTheDocument();
  });

  it("supports deterministic playback, pause, speed, step navigation and restart", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    render(<RouteMap dataset={dataset} result={result} />);

    fireEvent.change(screen.getByLabelText("Brzina reprodukcije"), { target: { value: "2" } });
    expect(screen.getByLabelText("Brzina reprodukcije")).toHaveValue("2");
    fireEvent.click(screen.getByRole("button", { name: "Pokreni reprodukciju" }));
    expect(screen.getByRole("button", { name: "Pauziraj reprodukciju" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Pauziraj reprodukciju" }));
    expect(cancelAnimationFrame).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Sljedeće stajanje" }));
    expect(screen.getByText(/korak 2 \/ 3/i)).toBeInTheDocument();
    expect(screen.getByText(/Stajanje 2 · L2 · Kamion B/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prethodno stajanje" }));
    expect(screen.getByText(/korak 1 \/ 3/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ponovno pokreni reprodukciju" }));
    expect(screen.getByText(/korak 1 \/ 3/i)).toBeInTheDocument();
  });

  it("finishes the animated route and cancels its animation frame on unmount", () => {
    const frames: FrameRequestCallback[] = [];
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    const view = render(<RouteMap dataset={dataset} result={result} historical />);
    fireEvent.click(screen.getByRole("button", { name: "Pokreni reprodukciju" }));
    expect(screen.getByText(/Nalog N1 · M1 · 1.200 kg/i)).toBeInTheDocument();
    act(() => { frames.shift()?.(0); });
    act(() => { frames.shift()?.(420); });
    act(() => { frames.shift()?.(421); });
    act(() => { frames.shift()?.(1_521); });
    act(() => { frames.shift()?.(1_522); });
    act(() => { frames.shift()?.(1_942); });
    act(() => { frames.shift()?.(1_943); });
    act(() => { frames.shift()?.(2_363); });
    act(() => { frames.shift()?.(2_364); });
    act(() => { frames.shift()?.(2_784); });
    act(() => { frames.shift()?.(2_785); });
    act(() => { frames.shift()?.(3_885); });
    expect(screen.getByText("Simulacija završena.")).toBeInTheDocument();
    view.unmount();
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  it("keeps playback manual when reduced motion is requested and disables an idle vehicle", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    render(<RouteMap dataset={dataset} result={result} />);
    expect(screen.getByText(/Smanjeno kretanje je uključeno/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokreni reprodukciju" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Sljedeće stajanje" }));
    expect(screen.getByText(/korak 2 \/ 3/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Odaberi Kamion A" }));
    expect(screen.getByRole("button", { name: "Pokreni reprodukciju" })).toBeDisabled();
  });

  it("reconstructs each cargo state in solver order and validates it against the snapshot", () => {
    render(<RouteMap dataset={dataset} result={result} />);
    fireEvent.click(screen.getByLabelText("Kamion B, stajanje 2, L2: 1 preuzimanje, 2 isporuka"));
    expect(screen.getByText(/2\.1 ·/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Nema strojeva u vozilu/i)).toHaveLength(2);
    expect(screen.getByText(/2\.2 ·/i)).toBeInTheDocument();
    expect(screen.getAllByText(/M2/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/800 kg · nalog N2/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Ukupno strojeva: 1 / 3")).toBeInTheDocument();
    expect(screen.getAllByText("Stanje nakon isporuke")).toHaveLength(2);
    expect(screen.getAllByText("Teret nakon radnje")).toHaveLength(3);
    expect(screen.getByText("8%")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sažetak tereta nakon stajanja 2" })).toHaveClass("route-map__cargo-action", "route-map__stop-cargo-summary");
    expect(screen.getByText("Isporučeno na ovom stajanju")).toBeInTheDocument();
    expect(screen.getByText("Natovareno na ovom stajanju")).toBeInTheDocument();
    expect(screen.getByText("Trenutačno u kamionu")).toBeInTheDocument();
    expect(screen.getByLabelText("Slobodna nosivost: 10000 kg")).toBeInTheDocument();
  });

  it("shows a diagnostic instead of an unverified cargo list when a snapshot disagrees", () => {
    const mismatched: OptimizationResult = { ...result, validation_result: { ...result.validation_result!, load_snapshots: result.validation_result!.load_snapshots.map((snapshot) => snapshot.order_id === "N2" && snapshot.action_type === "PICKUP" ? { ...snapshot, load_kg: 999 } : snapshot) } };
    render(<RouteMap dataset={dataset} result={mismatched} />);
    fireEvent.click(screen.getByLabelText("Kamion B, stajanje 2, L2: 1 preuzimanje, 2 isporuka"));
    expect(screen.getByText(/Rekonstruirani teret \(800 kg · 1\) ne odgovara provjerenoj snimci/i)).toBeInTheDocument();
  });

  it("shows verified segment distance, relative planning time and remaining route distance", () => {
    const verified: OptimizationResult = { ...result, validation_result: { ...result.validation_result!, route_metrics: result.validation_result!.route_metrics.map((metric) => metric.vehicle_id === "B" ? { ...metric, distance_tenths_km: 152, driving_time_seconds: 912, total_elapsed_seconds: 5712 } : metric), combined_distance_tenths_km: 152, combined_driving_time_seconds: 912, combined_total_elapsed_seconds: 5712 } };
    render(<RouteMap dataset={dataset} result={verified} />);
    fireEvent.click(screen.getByLabelText("Kamion B, stajanje 2, L2: 1 preuzimanje, 2 isporuka"));
    expect(screen.getByText("Od prethodnog: 7,6 km · 7 min 36 s")).toBeInTheDocument();
    expect(screen.getByText("Prijeđeno: 7,6 km")).toBeInTheDocument();
    expect(screen.getByText(/Ruta: 15,2 km · preostaje 7,6 km/i)).toBeInTheDocument();
    expect(screen.getByText(/Planirano: \+ 27 min 36 s · ukupno 1 h 35 min 12 s/i)).toBeInTheDocument();
  });

  it("uses the supplied historical snapshot dataset for cargo reconstruction", () => {
    const historicalDataset: DemoDataset = { ...dataset, machines: dataset.machines.map((machine) => machine.id === "M1" ? { ...machine, weight_kg: 1200 } : machine) };
    render(<RouteMap dataset={historicalDataset} result={result} historical />);
    fireEvent.click(screen.getByLabelText("Kamion B, stajanje 1, DEP: 1 preuzimanje"));
    expect(screen.getByText(/Nalog N1 · M1 · 1.200 kg/i)).toBeInTheDocument();
  });

  it("keeps cargo and details synchronized while jumping, restarting and switching vehicles", () => {
    const twoActiveResult: OptimizationResult = { ...result, plan: { routes: [{ vehicle_id: "A", stops: [{ location_id: "DEP", actions: [{ order_id: "N1", action_type: "PICKUP" }] }] }, result.plan!.routes[1]!] }, validation_result: { ...result.validation_result!, route_metrics: result.validation_result!.route_metrics.map((metric) => metric.vehicle_id === "A" ? { ...metric, completed_order_count: 1 } : metric), load_snapshots: [...result.validation_result!.load_snapshots, { vehicle_id: "A", order_id: "N1", action_type: "PICKUP", stop_index: 0, action_index: 0, load_kg: 1200, machine_count: 1 }] } };
    render(<RouteMap dataset={dataset} result={twoActiveResult} />);
    fireEvent.click(screen.getByRole("button", { name: "Odaberi Kamion B" }));
    fireEvent.click(screen.getByRole("button", { name: "Sljedeće stajanje" }));
    expect(screen.getByText(/Stajanje 2 · L2 · Kamion B/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Ponovno pokreni reprodukciju" }));
    expect(screen.queryByText(/Stajanje 2 · L2 · Kamion B/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Kamion A, stajanje 1, DEP: 1 preuzimanje"));
    expect(screen.getByText(/Stajanje 1 · DEP · Kamion A/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1.200 kg · nalog N1/i).length).toBeGreaterThan(0);
  });
});
