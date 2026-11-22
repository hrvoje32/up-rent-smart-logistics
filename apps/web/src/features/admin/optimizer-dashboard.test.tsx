import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OptimizerDashboard } from "./optimizer-dashboard";
import { BUSINESS_WORKSPACE_STORAGE_KEY, createBusinessWorkspace, saveBusinessWorkspace } from "@/lib/business-workspace";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const dataset: DemoDataset = {
  vehicles: [{ id: "A", max_payload_kg: 8000, max_simultaneous_machines: 2, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }, { id: "B", max_payload_kg: 3500, max_simultaneous_machines: 1, start_location_id: "L0", end_location_id: "L0", average_speed_kmh: 60 }],
  machines: [{ id: "M01", weight_kg: 1200 }], locations: [{ id: "L0", x: 0, y: 0 }, { id: "L1", x: 4, y: 3 }],
  orders: [{ id: "N01", machine_id: "M01", pickup_location_id: "L0", delivery_location_id: "L1" }],
  parameters: { depot_location_id: "L0", max_driving_minutes: 540, pickup_service_minutes: 15, delivery_service_minutes: 15 },
};

const result: OptimizationResult = {
  status: "FEASIBLE", solver_status: 1, solver_duration_seconds: 0.21,
  plan: { routes: [{ vehicle_id: "A", stops: [{ location_id: "L0", actions: [{ order_id: "N01", action_type: "PICKUP" }] }, { location_id: "L1", actions: [{ order_id: "N01", action_type: "DELIVERY" }] }, { location_id: "L0", actions: [] }] }, { vehicle_id: "B", stops: [] }] },
  validation_result: { is_valid: true, is_complete: true, per_vehicle_validity: { A: true, B: true }, violations: [], unserved_order_ids: [], completed_order_counts: { A: 1, B: 0 }, route_metrics: [{ vehicle_id: "A", route_index: 0, distance_tenths_km: 100, driving_time_seconds: 600, pickup_service_seconds: 900, delivery_service_seconds: 900, total_service_seconds: 1800, total_elapsed_seconds: 2400, completed_order_count: 1, is_valid: true }, { vehicle_id: "B", route_index: 1, distance_tenths_km: 0, driving_time_seconds: 0, pickup_service_seconds: 0, delivery_service_seconds: 0, total_service_seconds: 0, total_elapsed_seconds: 0, completed_order_count: 0, is_valid: true }], combined_distance_tenths_km: 100, combined_driving_time_seconds: 600, combined_pickup_service_seconds: 900, combined_delivery_service_seconds: 900, combined_total_service_seconds: 1800, combined_total_elapsed_seconds: 2400, load_snapshots: [{ vehicle_id: "A", order_id: "N01", action_type: "PICKUP", stop_index: 0, action_index: 0, load_kg: 1200, machine_count: 1 }, { vehicle_id: "A", order_id: "N01", action_type: "DELIVERY", stop_index: 1, action_index: 0, load_kg: 0, machine_count: 0 }] },
  violations: [], baseline_comparison: { baseline_distance_tenths_km: 160, optimized_distance_tenths_km: 100, distance_reduction_tenths_km: 60, distance_reduction_percentage: 37.5 }, diagnostic_message: null,
};

afterEach(() => { cleanup(); window.localStorage.clear(); vi.unstubAllGlobals(); });

async function openOriginalReference(): Promise<void> {
  await screen.findByText(/izradite prvi radni plan/i);
  fireEvent.click(screen.getAllByRole("button", { name: /učitaj originalni up rent zadatak/i })[0]!);
  await screen.findByText(/izvorni up rent zadatak/i);
}

async function openNewPlan(): Promise<void> {
  await screen.findByText(/izradite prvi radni plan/i);
  fireEvent.click(screen.getAllByRole("button", { name: /nova optimizacija/i })[0]!);
  await screen.findByLabelText("Odabir vozila radnog prostora");
}

async function renderResult(optimizationResult: OptimizationResult): Promise<void> {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(optimizationResult), { status: 200, headers: { "content-type": "application/json" } })));
  render(<OptimizerDashboard dataset={dataset} initialError={null} />);
  await openOriginalReference();
  fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));
}

function truckAIdleResult(): OptimizationResult {
  const scenario = structuredClone(result);
  scenario.plan = { routes: [{ vehicle_id: "A", stops: [] }, { vehicle_id: "B", stops: result.plan?.routes[0].stops ?? [] }] };
  scenario.validation_result!.route_metrics = [
    { ...result.validation_result!.route_metrics[1], vehicle_id: "A" },
    { ...result.validation_result!.route_metrics[0], vehicle_id: "B" },
  ];
  scenario.validation_result!.completed_order_counts = { A: 0, B: 1 };
  scenario.validation_result!.load_snapshots = result.validation_result!.load_snapshots.map((snapshot) => ({ ...snapshot, vehicle_id: "B" }));
  return scenario;
}

function bothActiveResult(): OptimizationResult {
  const scenario = structuredClone(result);
  const activeStops = result.plan?.routes[0].stops ?? [];
  scenario.plan = { routes: [{ vehicle_id: "A", stops: activeStops }, { vehicle_id: "B", stops: activeStops }] };
  scenario.validation_result!.route_metrics = [
    result.validation_result!.route_metrics[0],
    { ...result.validation_result!.route_metrics[0], vehicle_id: "B", distance_tenths_km: 80, completed_order_count: 1, driving_time_seconds: 480, total_elapsed_seconds: 2280 },
  ];
  scenario.validation_result!.completed_order_counts = { A: 1, B: 1 };
  scenario.validation_result!.combined_distance_tenths_km = 180;
  scenario.validation_result!.combined_driving_time_seconds = 1080;
  scenario.validation_result!.combined_pickup_service_seconds = 1800;
  scenario.validation_result!.combined_delivery_service_seconds = 1800;
  scenario.validation_result!.combined_total_service_seconds = 3600;
  scenario.validation_result!.combined_total_elapsed_seconds = 4680;
  scenario.validation_result!.load_snapshots = [
    ...result.validation_result!.load_snapshots,
    ...result.validation_result!.load_snapshots.map((snapshot) => ({ ...snapshot, vehicle_id: "B" })),
  ];
  return scenario;
}

describe("OptimizerDashboard", () => {
  it("keeps Povijest discoverable before a plan exists and preserves the planner when switching back", async () => {
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await screen.findByText(/izradite prvi radni plan/i);
    fireEvent.click(screen.getByRole("tab", { name: /^Povijest/ }));
    expect(await screen.findByText("Još nema spremljenih optimizacija.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Planiranje" }));
    expect(screen.getByText(/izradite prvi radni plan/i)).toBeInTheDocument();
  });

  it("shows canonical data and a validated, separately assigned route", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } })));
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openOriginalReference();
    expect(screen.getAllByText(/2 vozila/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Sažetak trenutačnog plana")).toHaveTextContent(/N01/);
    fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Pronađen valjan raspored" })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "Rezultati" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("37,5%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preuzmi CSV plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ispis / spremi PDF" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Zašto je plan ovakav?" })).toBeInTheDocument();
    expect(screen.getByText(/Nije korišten u ovom planu.*ostaje u bazi L0/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Sažetak provjerenog plana")).toHaveTextContent(/Ukupna udaljenost ruta/i);
    expect(screen.getByLabelText("Metrike rute za Kamion B")).toHaveTextContent(/0,0 km.*0 naloga.*0 min/s);
    expect(screen.getByLabelText("Simulirana planirana vremenska crta za Kamion A")).toHaveTextContent(/Kronološka vremenska crta rute.*Završetak: 08:40:00.*Preuzimanje.*N01.*08:00:00.*08:15:00.*Isporuka/is);
    fireEvent.click(screen.getByText("Analiza udaljenosti"));
    expect(screen.getByLabelText("Mogućnosti faktora zaobilaska")).toHaveValue("130");
    expect(screen.getByText(/Procijenjena cestovna udaljenost \(simulacija\)/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mogućnosti faktora zaobilaska"), { target: { value: "100" } });
    expect(screen.getAllByText("10,0 km").length).toBeGreaterThan(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("region", { name: "Kamion A" })).toHaveTextContent(/Datum početka simulacije.*01\. 01\. 2026\..*Vrijeme završetka simulacije.*08:40:00.*Pauze nisu planirane.*Preostali teret.*0 kg/i);
    expect(screen.getByRole("region", { name: "Kamion B" })).toHaveTextContent(/Nije korišten.*Datum početka simulacije.*Nije primjenjivo.*0,0 km.*Izvršeni nalozi.*0 naloga/i);
    expect(screen.getAllByText("1200 kg · 1").length).toBeGreaterThan(0);
    expect(fetch).toHaveBeenCalledWith("/api/optimizer", expect.objectContaining({ method: "POST" }));
  });

  it("shows an accessible backend failure and does not pretend a plan exists", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Local service is offline." }), { status: 502, headers: { "content-type": "application/json" } })));
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openOriginalReference();
    fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/local service is offline/i);
    expect(screen.queryByRole("heading", { name: "Pronađen valjan raspored" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Rezultati" })).toHaveAttribute("aria-selected", "true");
    const stored = JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { runs: Array<{ outcome: string; result: unknown }> };
    expect(stored.runs).toEqual([expect.objectContaining({ outcome: "TECHNICAL_ERROR", result: null })]);
  });

  it("shows prominent per-order warnings only for diagnosed unserviceable orders", async () => {
    const infeasible: OptimizationResult = { ...result, status: "INFEASIBLE", plan: null, validation_result: null, violations: [{ code: "UNSERVICEABLE_ORDER", description: "order 'N01' machine weight 1200 kg exceeds every vehicle capacity", vehicle_id: null, order_id: "N01", stop_index: null, action_index: null }], baseline_comparison: null, diagnostic_message: "One or more orders cannot fit on any available vehicle." };
    await renderResult(infeasible);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Nije moguće izvršiti sve naloge uz zadana ograničenja" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Upozorenja za neizvedive naloge" })).toBeInTheDocument();
    expect(screen.getByText(/N01 · M01 · Nalog ne stane u odabranu flotu/i)).toBeInTheDocument();
    expect(screen.getAllByText(/1.200 kg/).length).toBeGreaterThan(0);
  });

  it("shows Truck A as idle with zero metrics while Truck B remains active", async () => {
    await renderResult(truckAIdleResult());
    await waitFor(() => expect(screen.getByLabelText("Metrike rute za Kamion A")).toBeInTheDocument());
    expect(screen.getByLabelText("Metrike rute za Kamion A")).toHaveTextContent(/0,0 km.*0 naloga.*0 min/s);
    expect(screen.getByRole("article", { name: "Raspored za Kamion B" })).toHaveTextContent(/Aktivan.*10,0 km.*1 nalog/is);
    expect(screen.getByLabelText("Dodatne metrike provjerenog plana")).toHaveTextContent(/Udaljenost kamiona A.*0,0 km.*Udaljenost kamiona B.*10,0 km/is);
  });

  it("keeps both active vehicles and all separate time fields visible", async () => {
    await renderResult(bothActiveResult());
    await waitFor(() => expect(screen.getByRole("article", { name: "Raspored za Kamion B" })).toHaveTextContent(/Aktivan/i));
    expect(screen.getByLabelText("Metrike rute za Kamion A")).toHaveTextContent(/Vrijeme vožnje.*10 min.*Preuzimanje.*15 min.*Isporuka.*15 min.*Ukupno vrijeme usluge.*30 min.*Ukupno planirano trajanje.*40 min/is);
    expect(screen.getByLabelText("Metrike rute za Kamion B")).toHaveTextContent(/8,0 km.*1 nalog.*8 min/is);
    expect(screen.getByLabelText("Dodatne metrike provjerenog plana")).toHaveTextContent(/Ukupna udaljenost svih vozila.*18,0 km.*Udaljenost kamiona A.*10,0 km.*Udaljenost kamiona B.*8,0 km/is);
    expect(screen.getByLabelText("Dodatne metrike provjerenog plana")).toHaveTextContent(/Ukupno vrijeme vožnje.*18 min.*Ukupno preuzimanje.*30 min.*Ukupno isporuka.*30 min.*Ukupno vrijeme usluge.*1 h/is);
    expect(screen.getByLabelText("Sažetak provjerenog plana")).toHaveTextContent(/Ukupna udaljenost ruta.*18,0 km.*2 naloga/is);
  });

  it("handles an optional baseline and a missing idle route metric without fabricated route values", async () => {
    const scenario = truckAIdleResult();
    scenario.baseline_comparison = null;
    scenario.validation_result!.route_metrics = scenario.validation_result!.route_metrics.filter((metric) => metric.vehicle_id !== "A");
    await renderResult(scenario);
    await waitFor(() => expect(screen.getByLabelText("Metrike rute za Kamion A")).toBeInTheDocument());
    expect(screen.getByLabelText("Metrike rute za Kamion A")).toHaveTextContent(/0,0 km.*0 naloga.*0 min/s);
    expect(screen.getByLabelText("Dodatne metrike provjerenog plana")).toHaveTextContent(/Početna udaljenost.*Nije dostupno.*Smanjenje udaljenosti.*Nije dostupno/is);
  });

  it("selects the current workspace vehicles and sends their current capacities to the optimizer", async () => {
    const workspace = createBusinessWorkspace(dataset);
    workspace.vehicles = workspace.vehicles.map((vehicle) => vehicle.id === "A" ? { ...vehicle, max_payload_kg: 9000 } : vehicle);
    workspace.vehicles.push({ id: "C", display_name: "Kamion C", max_payload_kg: 8000, max_simultaneous_machines: 3, average_speed_kmh: 55, active: true, registration_number: "ZG-C-01", description: "", notes: "" });
    saveBusinessWorkspace(window.localStorage, workspace);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openNewPlan();
    const selection = screen.getByLabelText("Odabir vozila radnog prostora");
    expect(selection).toHaveTextContent(/Kamion C.*8\.000 kg.*najviše 3 stroja/is);
    fireEvent.click(screen.getByRole("button", { name: /odaberi sva aktivna/i }));
    await waitFor(() => expect(screen.getByLabelText(/Kamion C/)).toBeChecked());
    fireEvent.click(screen.getByLabelText(/Kamion B/));
    await waitFor(() => expect(screen.getByLabelText(/Kamion B/)).not.toBeChecked());
    await waitFor(() => expect(screen.getByLabelText(/Kamion C/)).toBeChecked());
    fireEvent.click(screen.getByLabelText(/N01/));
    fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { dataset: DemoDataset };
    expect(body.dataset.vehicles).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "A", max_payload_kg: 9000 }),
      expect.objectContaining({ id: "C", max_payload_kg: 8000, max_simultaneous_machines: 3, start_location_id: "L0", end_location_id: "L0" }),
    ]));
    expect(body.dataset.vehicles.some((vehicle) => vehicle.id === "B")).toBe(false);
    expect(dataset.vehicles[0]?.max_payload_kg).toBe(8000);
  });

  it("uses selected workspace orders, current machine weights and time windows in a new request", async () => {
    const workspace = createBusinessWorkspace(dataset);
    workspace.machines.push({ id: "M02", display_name: "Stroj 2", weight_kg: 2200, machine_type_id: null });
    workspace.orders.push({ id: "N02", machine_id: "M02", pickup_location_id: "L0", delivery_location_id: "L1", notes: "", status: "PLANNED", earliest_pickup_at: "2026-01-15T08:00:00+01:00", latest_pickup_at: "2026-01-15T09:00:00+01:00", earliest_delivery_at: null, delivery_deadline_at: "2026-01-15T12:00:00+01:00" });
    saveBusinessWorkspace(window.localStorage, workspace);
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openNewPlan();
    fireEvent.click(screen.getByRole("button", { name: /odaberi sva aktivna/i }));
    await screen.findByLabelText("Odabir naloga radnog prostora");
    fireEvent.click(screen.getByLabelText(/N01/));
    fireEvent.click(screen.getByLabelText(/N02/));
    fireEvent.change(screen.getByLabelText("Filtriraj prema statusu"), { target: { value: "PLANNED" } });
    expect(screen.queryByLabelText(/N01/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/N02/)).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { dataset: DemoDataset };
    expect(body.dataset.orders).toEqual(expect.arrayContaining([expect.objectContaining({ id: "N02", machine_id: "M02", earliest_pickup_at: "2026-01-15T08:00:00+01:00", delivery_deadline_at: "2026-01-15T12:00:00+01:00" })]));
    expect(body.dataset.machines).toEqual(expect.arrayContaining([expect.objectContaining({ id: "M02", weight_kg: 2200 })]));
  });

  it("keeps a five-vehicle result compact until the operator opens one route detail", async () => {
    const workspace = createBusinessWorkspace(dataset);
    for (const id of ["C", "D", "E"]) workspace.vehicles.push({ id, display_name: `Kamion ${id}`, max_payload_kg: 5000, max_simultaneous_machines: 2, average_speed_kmh: 55, active: true, registration_number: "", description: "", notes: "" });
    saveBusinessWorkspace(window.localStorage, workspace);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } })));
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openNewPlan();
    fireEvent.click(screen.getByRole("button", { name: /odaberi sva aktivna/i }));
    fireEvent.click(screen.getByRole("button", { name: /odaberi sve dostupne/i }));
    fireEvent.click(screen.getByRole("button", { name: /optimiziraj rute/i }));
    await waitFor(() => expect(screen.getAllByRole("article", { name: /Raspored za Kamion/ })).toHaveLength(5));
    expect(document.querySelectorAll(".route-card__details[open]")).toHaveLength(0);
    fireEvent.click(screen.getAllByText("Detalji rute i vremenska crta")[0]!);
    expect(document.querySelectorAll(".route-card__details[open]")).toHaveLength(1);
    expect(screen.getAllByText(/Nije korišten u ovom planu/).length).toBeGreaterThan(0);
  });

  it("persists independent drafts and restores their strategy, route settings and planning time", async () => {
    const view = render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openNewPlan();
    fireEvent.change(screen.getByLabelText("Naziv plana"), { target: { value: "Plan A" } });
    fireEvent.click(screen.getByRole("button", { name: /odaberi sva aktivna/i }));
    await waitFor(() => expect(screen.getByLabelText(/Kamion A/)).toBeChecked());
    fireEvent.click(screen.getByRole("button", { name: /odaberi sve dostupne/i }));
    await waitFor(() => expect(screen.getByLabelText(/N01/)).toBeChecked());
    fireEvent.change(screen.getByLabelText("Početak planiranja (neobavezno)"), { target: { value: "2026-01-15T08:30" } });
    fireEvent.click(screen.getByRole("button", { name: /najbrža dostava/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /obavezno koristi sva odabrana vozila/i }));
    fireEvent.click(screen.getByRole("button", { name: /spremi plan/i }));

    fireEvent.click(screen.getByRole("button", { name: /^Nova optimizacija$/i }));
    await waitFor(() => expect(screen.getByLabelText(/Kamion A/)).not.toBeChecked());
    expect(screen.getByLabelText(/N01/)).not.toBeChecked();
    fireEvent.change(screen.getByLabelText("Naziv plana"), { target: { value: "Plan B" } });
    fireEvent.click(screen.getByRole("button", { name: /spremi plan/i }));

    const stored = JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { drafts: Array<{ id: string; name: string }> };
    const planA = stored.drafts.find((draft) => draft.name === "Plan A");
    expect(planA).toBeDefined();
    view.unmount();

    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await screen.findByText(/izradite prvi radni plan/i);
    fireEvent.click(screen.getAllByRole("button", { name: /nova optimizacija/i })[0]!);
    await screen.findByLabelText("Otvori spremljeni plan");
    fireEvent.change(screen.getByLabelText("Otvori spremljeni plan"), { target: { value: planA?.id } });
    expect(await screen.findByLabelText("Naziv plana")).toHaveValue("Plan A");
    expect(screen.getByLabelText("Početak planiranja (neobavezno)")).toHaveValue("2026-01-15T08:30");
    expect(screen.getByRole("button", { name: /najbrža dostava/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("checkbox", { name: /obavezno koristi sva odabrana vozila/i })).toBeChecked();
  });
  it("requires the exact active draft ID before deleting a saved plan", async () => {
    render(<OptimizerDashboard dataset={dataset} initialError={null} />);
    await openNewPlan();
    fireEvent.change(screen.getByLabelText("Naziv plana"), { target: { value: "Plan za brisanje" } });
    fireEvent.click(screen.getByRole("button", { name: /spremi plan/i }));
    const stored = JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { drafts: Array<{ id: string; name: string }> };
    const draft = stored.drafts.find((item) => item.name === "Plan za brisanje");
    expect(draft).toBeDefined();
    const prompt = vi.spyOn(window, "prompt").mockReturnValue("pogrešan-id");
    fireEvent.click(screen.getByRole("button", { name: "Obriši plan" }));
    expect(prompt).toHaveBeenCalledWith(expect.stringContaining(draft?.id ?? ""), "");
    expect(screen.getByRole("alert")).toHaveTextContent(/id plana se ne podudara/i);
    expect((JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { drafts: Array<{ id: string }> }).drafts.some((item) => item.id === draft?.id)).toBe(true);
    prompt.mockReturnValue(draft?.id ?? "");
    fireEvent.click(screen.getByRole("button", { name: "Obriši plan" }));
    await waitFor(() => expect(screen.getByText(/izradite prvi radni plan/i)).toBeInTheDocument());
    expect((JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { drafts: Array<{ id: string }> }).drafts.some((item) => item.id === draft?.id)).toBe(false);
    prompt.mockRestore();
  });
  it("stores an immutable optimization run, expands it and creates a separate draft from it", async () => {
    await renderResult(result);
    await screen.findByRole("heading", { name: "Pronađen valjan raspored" });
    fireEvent.click(screen.getByRole("tab", { name: /^Povijest/ }));
    expect(await screen.findByRole("heading", { name: "Povijest optimizacija" })).toBeInTheDocument();
    const stored = JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { runs: Array<{ draft_name: string; source_snapshot: DemoDataset }> };
    expect(stored.runs).toHaveLength(1);
    expect(stored.runs[0]?.draft_name).toBe("Originalni UP RENT zadatak");
    expect(stored.runs[0]?.source_snapshot.orders).toEqual(dataset.orders);
    fireEvent.click(within(screen.getByRole("tabpanel", { name: /^Povijest/ })).getByText("Originalni UP RENT zadatak", { selector: "strong" }));
    expect(await screen.findByText("Sažetak po vozilu")).toBeInTheDocument();
    expect(screen.getByText(/10,0 km.*10 min vožnje/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži kartu" }));
    expect(await screen.findByText("Povijesni rezultat — samo pregled.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Novi nacrt iz ovog pokretanja" }));
    await waitFor(() => {
      const next = JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { drafts: Array<{ name: string }> };
      expect(next.drafts.some((draft) => draft.name.includes("kopija"))).toBe(true);
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Obriši zapis" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect((JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { runs: unknown[] }).runs).toHaveLength(1);
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Obriši zapis" }));
    await waitFor(() => expect((JSON.parse(window.localStorage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY) ?? "{}") as { runs: unknown[] }).runs).toHaveLength(0));
    confirm.mockRestore();
  });
});
