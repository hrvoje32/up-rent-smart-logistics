import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagementPage } from "./management-page";
import { createBusinessWorkspace, createOptimizationRun, createOriginalDraft, saveBusinessWorkspace } from "@/lib/business-workspace";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 3500, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M01", weight_kg: 800 }], locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 3, y: 8 }],
  orders: [{ id: "N01", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 20, delivery_service_minutes: 20 },
};

afterEach(() => { cleanup(); window.localStorage.clear(); });

const latestResult: OptimizationResult = {
  status: "FEASIBLE", solver_status: 1, solver_duration_seconds: 0.1, plan: null,
  validation_result: { is_valid: true, is_complete: true, per_vehicle_validity: { A: true }, violations: [], unserved_order_ids: [], completed_order_counts: { A: 1 }, route_metrics: [{ vehicle_id: "A", route_index: 0, distance_tenths_km: 100, driving_time_seconds: 600, pickup_service_seconds: 1200, delivery_service_seconds: 1200, total_service_seconds: 2400, total_elapsed_seconds: 3000, completed_order_count: 1, is_valid: true }], combined_distance_tenths_km: 100, combined_driving_time_seconds: 600, combined_pickup_service_seconds: 1200, combined_delivery_service_seconds: 1200, combined_total_service_seconds: 2400, combined_total_elapsed_seconds: 3000, load_snapshots: [] },
  violations: [], baseline_comparison: null, diagnostic_message: null,
};

describe("ManagementPage route isolation", () => {
  it("renders dashboard analytics without scenario editor controls", () => {
    render(<ManagementPage dataset={dataset} section="dashboard" />);
    expect(screen.getByRole("heading", { name: "Nadzorna ploča" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pokazatelji scenarija")).toBeInTheDocument();
    expect(screen.queryByText("Scenariji planiranja · lokalna pohrana preglednika")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist", { name: "Podaci scenarija" })).not.toBeInTheDocument();
  });

  it("shows the latest immutable optimization run from the real workspace", async () => {
    const workspace = createBusinessWorkspace(dataset);
    const draft = createOriginalDraft(workspace, dataset);
    workspace.runs = [createOptimizationRun(draft, dataset, latestResult)];
    saveBusinessWorkspace(window.localStorage, workspace);
    render(<ManagementPage dataset={dataset} section="dashboard" />);
    expect(await screen.findByText("Originalni UP RENT zadatak")).toBeInTheDocument();
    expect(screen.getByText("10,0 km")).toBeInTheDocument();
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByLabelText("Pokazatelji scenarija")).toHaveTextContent(/Pokretanja plana.*1/is);
  });

  it("renders independent vehicle management without scenario controls", async () => {
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    expect(await screen.findByRole("heading", { name: "Vozila", level: 1 })).toBeInTheDocument();
    expect(screen.getByLabelText("Kartice vozila")).toHaveTextContent(/Kamion A.*3.500 kg/is);
    expect(screen.queryByRole("heading", { name: "Transportni nalozi", level: 3 })).not.toBeInTheDocument();
    expect(screen.queryByText("Odabir za optimizaciju")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dodaj vozilo" })).toBeInTheDocument();
  });

  it("opens and closes accessible vehicle details in the reusable drawer", async () => {
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    fireEvent.click(screen.getByRole("button", { name: "Detalji" }));
    expect(screen.getByRole("dialog", { name: "Kamion A" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Kamion A" })).not.toBeInTheDocument();
  });

  it("renders only transport orders on the orders route", async () => {
    render(<ManagementPage dataset={dataset} section="orders" />);
    expect((await screen.findAllByRole("heading", { name: "Transportni nalozi" })).length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Vozila", level: 3 })).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Optimizacija ruta" }).every((link) => link.getAttribute("href") === "/admin/optimizer")).toBe(true);
  });

  it("creates, edits, deactivates and persists an independent vehicle", async () => {
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj vozilo" }));
    fireEvent.change(screen.getByLabelText("ID vozila"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Naziv vozila"), { target: { value: "Kamion B" } });
    fireEvent.change(screen.getByLabelText("Nosivost (kg)"), { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText("Najviše strojeva"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Prosječna brzina (km/h)"), { target: { value: "55" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi vozilo" }));
    expect(await screen.findByText("Kamion B", { selector: "h2" })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Uredi" })[1]);
    fireEvent.change(screen.getByLabelText("Nosivost (kg)"), { target: { value: "7500" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi promjene" }));
    expect(screen.getByText("7.500 kg")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Promijeni dostupnost Kamion B" }));
    expect(screen.getAllByText("Neaktivno").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Promijeni dostupnost Kamion B" }));
    await waitFor(() => expect(window.localStorage.getItem("up-rent.business-workspace.v1")).toContain("Kamion B"));
    const stored = JSON.parse(String(window.localStorage.getItem("up-rent.business-workspace.v1"))) as { vehicles: Array<{ id: string; max_payload_kg: number }> };
    expect(stored.vehicles.find((vehicle) => vehicle.id === "A")?.max_payload_kg).toBe(3500);
    expect(stored.vehicles.find((vehicle) => vehicle.id === "B")?.max_payload_kg).toBe(7500);
    cleanup();
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    expect(screen.getByText("Kamion B", { selector: "h2" })).toBeInTheDocument();
    expect(screen.getByText("7.500 kg")).toBeInTheDocument();
  });

  it("shows validation feedback and preserves an unsaved edit when dismissal is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj vozilo" }));
    fireEvent.change(screen.getByLabelText("ID vozila"), { target: { value: "C" } });
    fireEvent.change(screen.getByLabelText("Naziv vozila"), { target: { value: "Kamion C" } });
    fireEvent.change(screen.getByLabelText("Nosivost (kg)"), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText("Najviše strojeva"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Spremi vozilo" }));
    expect(screen.getByRole("status")).toHaveTextContent(/moraju biti pozitivni cijeli brojevi/i);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Kamion A", { selector: "h2" })).toBeInTheDocument();
    confirm.mockRestore();
  });

  it("keeps the vehicle name input focused across continuous edits", async () => {
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    fireEvent.click(screen.getByRole("button", { name: "Dodaj vozilo" }));
    const name = screen.getByLabelText("Naziv vozila");
    name.focus();
    fireEvent.change(name, { target: { value: "K" } });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Kamion Mercedes Actros" } });
    expect(name).toHaveValue("Kamion Mercedes Actros");
    expect(document.activeElement).toBe(name);
  });

  it("filters vehicles and deletes only after a confirmed action", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ManagementPage dataset={dataset} section="vehicles" />);
    await screen.findByLabelText("Kartice vozila");
    fireEvent.change(screen.getByLabelText("Pretraži vozila"), { target: { value: "ne postoji" } });
    expect(screen.getByText("Nema vozila za odabrani prikaz.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pretraži vozila"), { target: { value: "Kamion A" } });
    fireEvent.change(screen.getByLabelText("Dostupnost"), { target: { value: "INACTIVE" } });
    expect(screen.getByText("Nema vozila za odabrani prikaz.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Dostupnost"), { target: { value: "ALL" } });
    fireEvent.click(screen.getByRole("button", { name: "Detalji" }));
    confirm.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Obriši vozilo" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("Kamion A", { selector: "h2" })).toHaveLength(2);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Obriši vozilo" }));
    await waitFor(() => expect(screen.queryAllByText("Kamion A", { selector: "h2" })).toHaveLength(0));
    expect(screen.getByText("Nema vozila za odabrani prikaz.")).toBeInTheDocument();
    confirm.mockRestore();
  });
});
