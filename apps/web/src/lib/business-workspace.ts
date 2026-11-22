import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";
import {
  ORIGINAL_SCENARIO_ID,
  SCENARIO_STORAGE_KEY,
  SAVED_PLAN_STORAGE_KEY,
  createOriginalScenario,
  loadCustomScenarios,
  loadSavedPlans,
  type OrderStatus,
  type PlanningScenario,
  type SavedRouteSnapshot,
} from "@/lib/planning-scenarios";
import { buildInfeasibilityWarnings } from "@/lib/infeasible-order-warnings";

export const BUSINESS_WORKSPACE_STORAGE_KEY = "up-rent.business-workspace.v1";
export const BUSINESS_WORKSPACE_BACKUP_KEY = "up-rent.business-workspace.backup.v1";
export const BUSINESS_WORKSPACE_VERSION = 4;

export interface BusinessVehicle {
  id: string; display_name: string; max_payload_kg: number; max_simultaneous_machines: number;
  average_speed_kmh: number; active: boolean; registration_number: string; description: string; notes: string;
}
export interface BusinessMachineType { id: string; name: string; default_weight_kg: number | null; description: string; }
export interface BusinessMachine { id: string; display_name: string; weight_kg: number; machine_type_id: string | null; description?: string; }
export interface BusinessLocation { id: string; display_name: string; x: number; y: number; is_depot: boolean; description: string; }
export interface BusinessOrder {
  id: string; machine_id: string; pickup_location_id: string; delivery_location_id: string; notes: string; status: OrderStatus;
  earliest_pickup_at: string | null; latest_pickup_at: string | null; earliest_delivery_at: string | null; delivery_deadline_at: string | null;
}
export interface PlanningDraft {
  id: string; name: string; created_at: string; updated_at: string; vehicle_ids: string[]; order_ids: string[];
  vehicle_routes: Record<string, { start_location_id: string; end_location_id: string }>;
  planning_start_at: string | null; optimization_strategy: OptimizationStrategy; require_all_selected_vehicles: boolean;
}
export type OptimizationStrategy = "FASTEST_DELIVERY" | "BALANCED" | "DISTANCE_SAVINGS";
export type OptimizationRunOutcome = "SUCCESS" | "INFEASIBLE" | "INVALID_INPUT" | "NO_SOLUTION_FOUND" | "TIMEOUT" | "TECHNICAL_ERROR";
export interface OptimizationFailureDetails {
  message: string;
  affected_order_ids: string[];
  constraint_details: string[];
  corrective_guidance: string | null;
}
export interface OptimizationRun {
  id: string;
  draft_id: string;
  draft_name: string;
  created_at: string;
  source_snapshot: DemoDataset;
  /** Present only when the optimizer returned a contract-valid response. */
  result: OptimizationResult | null;
  outcome: OptimizationRunOutcome;
  failure: OptimizationFailureDetails | null;
  optimization_strategy: OptimizationStrategy;
  require_all_selected_vehicles: boolean;
  selected_vehicle_ids: string[];
  selected_order_ids: string[];
}
export interface BusinessWorkspace {
  schema_version: number; vehicles: BusinessVehicle[]; machine_types: BusinessMachineType[]; machines: BusinessMachine[];
  locations: BusinessLocation[]; orders: BusinessOrder[]; drafts: PlanningDraft[]; runs: OptimizationRun[];
}
interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }

function clone<T>(value: T): T { return structuredClone(value); }
function timestamp(): string { return new Date().toISOString(); }
function uniqueId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }
function defaultRoute(dataset: DemoDataset, vehicleId: string): { start_location_id: string; end_location_id: string } {
  const vehicle = dataset.vehicles.find((item) => item.id === vehicleId);
  const depot = dataset.parameters.depot_location_id;
  return { start_location_id: vehicle?.start_location_id ?? depot, end_location_id: vehicle?.end_location_id ?? depot };
}

export function createBusinessWorkspace(dataset: DemoDataset): BusinessWorkspace {
  return {
    schema_version: BUSINESS_WORKSPACE_VERSION,
    vehicles: dataset.vehicles.map((item) => ({ id: item.id, display_name: `Kamion ${item.id}`, max_payload_kg: item.max_payload_kg, max_simultaneous_machines: item.max_simultaneous_machines, average_speed_kmh: item.average_speed_kmh, active: true, registration_number: "", description: "", notes: "" })),
    machine_types: [],
    machines: dataset.machines.map((item) => ({ id: item.id, display_name: item.id, weight_kg: item.weight_kg, machine_type_id: null })),
    locations: dataset.locations.map((item) => ({ id: item.id, display_name: item.id === dataset.parameters.depot_location_id ? "Baza / depo" : item.id, x: item.x, y: item.y, is_depot: item.id === dataset.parameters.depot_location_id, description: "" })),
    orders: dataset.orders.map((item) => ({ ...item, notes: "", status: "PENDING" as OrderStatus, earliest_pickup_at: null, latest_pickup_at: null, earliest_delivery_at: null, delivery_deadline_at: null })),
    drafts: [], runs: [],
  };
}

export function createNewDraft(workspace: BusinessWorkspace, name = "Nova optimizacija"): PlanningDraft {
  const now = timestamp();
  return { id: uniqueId("draft"), name, created_at: now, updated_at: now, vehicle_ids: [], order_ids: [], vehicle_routes: {}, planning_start_at: null, optimization_strategy: "BALANCED", require_all_selected_vehicles: false };
}

export function createOriginalDraft(workspace: BusinessWorkspace, dataset: DemoDataset): PlanningDraft {
  const now = timestamp();
  return { id: uniqueId("draft"), name: "Originalni UP RENT zadatak", created_at: now, updated_at: now, vehicle_ids: dataset.vehicles.map((item) => item.id), order_ids: dataset.orders.map((item) => item.id), vehicle_routes: Object.fromEntries(dataset.vehicles.map((item) => [item.id, defaultRoute(dataset, item.id)])), planning_start_at: null, optimization_strategy: "DISTANCE_SAVINGS", require_all_selected_vehicles: false };
}

export function duplicateDraft(draft: PlanningDraft, name = `${draft.name} kopija`): PlanningDraft {
  const now = timestamp();
  return { ...clone(draft), id: uniqueId("draft"), name, created_at: now, updated_at: now };
}

/** Store an immutable local record of the exact request and result shown to the operator. */
export function createOptimizationRun(draft: PlanningDraft, sourceSnapshot: DemoDataset, result: OptimizationResult): OptimizationRun {
  const outcome = outcomeFromResult(result);
  return {
    id: uniqueId("run"),
    draft_id: draft.id,
    draft_name: draft.name,
    created_at: timestamp(),
    source_snapshot: clone(sourceSnapshot),
    result: clone(result),
    outcome,
    failure: outcome === "SUCCESS" ? null : failureFromResult(sourceSnapshot, result, outcome),
    optimization_strategy: draft.optimization_strategy,
    require_all_selected_vehicles: draft.require_all_selected_vehicles,
    selected_vehicle_ids: [...draft.vehicle_ids],
    selected_order_ids: [...draft.order_ids],
  };
}

/** Records an explicit failed run without inventing a route result or its metrics. */
export function createFailedOptimizationRun(
  draft: PlanningDraft,
  sourceSnapshot: DemoDataset,
  outcome: Exclude<OptimizationRunOutcome, "SUCCESS">,
  failure: OptimizationFailureDetails,
): OptimizationRun {
  return {
    id: uniqueId("run"),
    draft_id: draft.id,
    draft_name: draft.name,
    created_at: timestamp(),
    source_snapshot: clone(sourceSnapshot),
    result: null,
    outcome,
    failure: clone(failure),
    optimization_strategy: draft.optimization_strategy,
    require_all_selected_vehicles: draft.require_all_selected_vehicles,
    selected_vehicle_ids: [...draft.vehicle_ids],
    selected_order_ids: [...draft.order_ids],
  };
}

export function draftSnapshot(workspace: BusinessWorkspace, draft: PlanningDraft, parameters: DemoDataset["parameters"]): DemoDataset {
  const selectedVehicles = new Set(draft.vehicle_ids);
  const selectedOrders = new Set(draft.order_ids);
  return {
    vehicles: workspace.vehicles.filter((vehicle) => selectedVehicles.has(vehicle.id)).map((vehicle) => ({
      id: vehicle.id,
      max_payload_kg: vehicle.max_payload_kg,
      max_simultaneous_machines: vehicle.max_simultaneous_machines,
      average_speed_kmh: vehicle.average_speed_kmh,
      ...(draft.vehicle_routes[vehicle.id] ?? { start_location_id: parameters.depot_location_id, end_location_id: parameters.depot_location_id }),
    })),
    machines: workspace.machines.map(({ id, weight_kg }) => ({ id, weight_kg })),
    locations: workspace.locations.map(({ id, x, y }) => ({ id, x, y })),
    orders: workspace.orders.filter((order) => selectedOrders.has(order.id)).map(({ id, machine_id, pickup_location_id, delivery_location_id, earliest_pickup_at, latest_pickup_at, earliest_delivery_at, delivery_deadline_at }) => ({ id, machine_id, pickup_location_id, delivery_location_id, earliest_pickup_at, latest_pickup_at, earliest_delivery_at, delivery_deadline_at })),
    parameters: { ...parameters, planning_start_at: draft.planning_start_at },
  };
}

function outcomeFromResult(result: OptimizationResult): OptimizationRunOutcome {
  if (result.status === "FEASIBLE" && result.validation_result?.is_valid && result.validation_result.is_complete) return "SUCCESS";
  if (result.status === "INFEASIBLE") return "INFEASIBLE";
  if (result.status === "NO_SOLUTION_FOUND") return "NO_SOLUTION_FOUND";
  if (result.status === "VALIDATION_FAILED") return "INVALID_INPUT";
  return "TECHNICAL_ERROR";
}

function failureFromResult(sourceSnapshot: DemoDataset, result: OptimizationResult, outcome: Exclude<OptimizationRunOutcome, "SUCCESS">): OptimizationFailureDetails {
  const violations = [...result.violations, ...(result.validation_result?.violations ?? [])];
  const affected = [...new Set([...violations.flatMap((violation) => violation.order_id ? [violation.order_id] : []), ...(result.validation_result?.unserved_order_ids ?? [])])];
  const warnings = buildInfeasibilityWarnings(sourceSnapshot, result);
  const warningDetails = [...warnings.orders.map((warning) => warning.explanation), ...warnings.global.map((warning) => warning.explanation)];
  const warningGuidance = [...warnings.orders.map((warning) => warning.correctiveAction), ...warnings.global.map((warning) => warning.correctiveAction)][0] ?? null;
  const fallback = outcome === "INFEASIBLE" ? "Dostupna provjera potvrdila je da odabrani plan nije izvediv." : outcome === "NO_SOLUTION_FOUND" ? "Pretraga nije pronašla rješenje unutar dopuštenog vremena; neizvedivost nije dokazana." : outcome === "INVALID_INPUT" ? "Dostupna provjera je odbila neispravan ulaz ili rezultat koji krši pravila." : "Optimizator nije vratio upotrebljiv rezultat.";
  return {
    message: result.diagnostic_message ?? fallback,
    affected_order_ids: [...new Set([...affected, ...warnings.orders.map((warning) => warning.order.id)])],
    constraint_details: warningDetails.length ? warningDetails : violations.map((violation) => violation.description),
    corrective_guidance: warningGuidance ?? (outcome === "INFEASIBLE" ? "Pregledajte kapacitet flote, vremenska ograničenja i navedene provjerene povrede." : outcome === "NO_SOLUTION_FOUND" ? "Provjerite globalna ograničenja ili pokušajte ponovno; ne uklanjajte naloge bez potvrđene dijagnostike." : outcome === "INVALID_INPUT" ? "Ispravite navedene reference ili ograničenja, zatim ponovno pokrenite optimizaciju." : null),
  };
}

/** A historical run is never edited. This creates a separate, editable copy of its selection. */
export function createDraftFromOptimizationRun(run: OptimizationRun): PlanningDraft {
  const now = timestamp();
  return {
    id: uniqueId("draft"),
    name: `${run.draft_name} · kopija`,
    created_at: now,
    updated_at: now,
    vehicle_ids: [...run.selected_vehicle_ids],
    order_ids: [...run.selected_order_ids],
    vehicle_routes: Object.fromEntries(run.source_snapshot.vehicles.map((vehicle) => [vehicle.id, {
      start_location_id: vehicle.start_location_id,
      end_location_id: vehicle.end_location_id,
    }])),
    planning_start_at: run.source_snapshot.parameters.planning_start_at ?? null,
    optimization_strategy: run.optimization_strategy,
    require_all_selected_vehicles: run.require_all_selected_vehicles,
  };
}

export function updateDraft(draft: PlanningDraft, update: Partial<Omit<PlanningDraft, "id" | "created_at">>): PlanningDraft {
  return { ...draft, ...clone(update), updated_at: timestamp() };
}

export function draftToDataset(workspace: BusinessWorkspace, draft: PlanningDraft, parameters: DemoDataset["parameters"]): DemoDataset {
  const vehicleIds = new Set(draft.vehicle_ids); const orderIds = new Set(draft.order_ids);
  const locations = workspace.locations.map(({ id, x, y }) => ({ id, x, y }));
  const locationIds = new Set(locations.map((item) => item.id));
  const vehicles = workspace.vehicles.filter((item) => item.active && vehicleIds.has(item.id)).map((item) => {
    const route = draft.vehicle_routes[item.id] ?? { start_location_id: parameters.depot_location_id, end_location_id: parameters.depot_location_id };
    if (!locationIds.has(route.start_location_id) || !locationIds.has(route.end_location_id)) throw new Error("Plan sadrži nepoznatu početnu ili završnu lokaciju vozila.");
    return { id: item.id, max_payload_kg: item.max_payload_kg, max_simultaneous_machines: item.max_simultaneous_machines, average_speed_kmh: item.average_speed_kmh, ...route };
  });
  const machines = workspace.machines.map(({ id, weight_kg }) => ({ id, weight_kg }));
  const machineIds = new Set(machines.map((item) => item.id));
  const orders = workspace.orders.filter((item) => orderIds.has(item.id) && item.status !== "CANCELLED" && item.status !== "COMPLETED").map((item) => {
    if (!machineIds.has(item.machine_id) || !locationIds.has(item.pickup_location_id) || !locationIds.has(item.delivery_location_id)) throw new Error(`Nalog ${item.id} upućuje na izbrisani zapis.`);
    return { id: item.id, machine_id: item.machine_id, pickup_location_id: item.pickup_location_id, delivery_location_id: item.delivery_location_id, earliest_pickup_at: item.earliest_pickup_at, latest_pickup_at: item.latest_pickup_at, earliest_delivery_at: item.earliest_delivery_at, delivery_deadline_at: item.delivery_deadline_at };
  });
  if (!vehicles.length) throw new Error("Odaberite barem jedno aktivno vozilo.");
  if (!orders.length) throw new Error("Odaberite barem jedan aktivan transportni nalog.");
  return { vehicles, machines, locations, orders, parameters: { ...parameters, planning_start_at: draft.planning_start_at } };
}

function migrateScenario(workspace: BusinessWorkspace, scenario: PlanningScenario, dataset: DemoDataset): PlanningDraft {
  const draft = createNewDraft(workspace, scenario.name);
  draft.vehicle_ids = scenario.selection.vehicle_ids;
  draft.order_ids = scenario.selection.order_ids;
  draft.vehicle_routes = clone(scenario.selection.vehicle_routes);
  draft.optimization_strategy = scenario.id === ORIGINAL_SCENARIO_ID ? "DISTANCE_SAVINGS" : "BALANCED";
  for (const vehicle of scenario.vehicles) if (!workspace.vehicles.some((item) => item.id === vehicle.id)) workspace.vehicles.push(clone(vehicle));
  for (const machine of scenario.machines) if (!workspace.machines.some((item) => item.id === machine.id)) workspace.machines.push(clone(machine));
  for (const location of scenario.locations) if (!workspace.locations.some((item) => item.id === location.id)) workspace.locations.push({ ...clone(location), description: "" });
  for (const order of scenario.orders) if (!workspace.orders.some((item) => item.id === order.id)) workspace.orders.push({ ...clone(order), earliest_pickup_at: null, latest_pickup_at: null, earliest_delivery_at: null, delivery_deadline_at: null });
  if (scenario.id === ORIGINAL_SCENARIO_ID) return createOriginalDraft(workspace, dataset);
  return draft;
}

function isWorkspace(value: unknown): value is BusinessWorkspace {
  return typeof value === "object" && value !== null && !Array.isArray(value) && ([1, 2, 3, BUSINESS_WORKSPACE_VERSION] as unknown[]).includes((value as { schema_version?: unknown }).schema_version);
}

export function loadBusinessWorkspace(storage: StorageLike, dataset: DemoDataset): BusinessWorkspace {
  const stored = storage.getItem(BUSINESS_WORKSPACE_STORAGE_KEY);
  if (stored) { try { const parsed: unknown = JSON.parse(stored); if (isWorkspace(parsed)) return migrateWorkspace(clone(parsed)); } catch { /* fall through to recoverable migration */ } }
  const workspace = createBusinessWorkspace(dataset);
  const oldScenarios = [createOriginalScenario(dataset), ...loadCustomScenarios(storage)];
  workspace.drafts = oldScenarios.map((scenario) => migrateScenario(workspace, scenario, dataset));
  const scenarioById = new Map(oldScenarios.map((scenario) => [scenario.id, scenario]));
  workspace.runs = loadSavedPlans(storage).map((plan: SavedRouteSnapshot) => {
    const sourceSnapshot = scenarioById.has(plan.scenario_id) ? legacySnapshot(scenarioById.get(plan.scenario_id)!) : dataset;
    return {
      id: plan.id,
      draft_id: plan.scenario_id,
      draft_name: scenarioById.get(plan.scenario_id)?.name ?? "Migrirani plan",
      created_at: plan.created_at,
      source_snapshot: sourceSnapshot,
      result: plan.result as OptimizationResult,
      outcome: "SUCCESS" as OptimizationRunOutcome,
      failure: null,
      optimization_strategy: "BALANCED" as OptimizationStrategy,
      require_all_selected_vehicles: false,
      selected_vehicle_ids: sourceSnapshot.vehicles.map((vehicle) => vehicle.id),
      selected_order_ids: sourceSnapshot.orders.map((order) => order.id),
    };
  });
  storage.setItem(BUSINESS_WORKSPACE_BACKUP_KEY, JSON.stringify({ scenarios: storage.getItem(SCENARIO_STORAGE_KEY), saved_plans: storage.getItem(SAVED_PLAN_STORAGE_KEY), migrated_at: timestamp() }));
  return workspace;
}

function legacySnapshot(scenario: PlanningScenario): DemoDataset {
  const routes = scenario.selection.vehicle_routes;
  return { vehicles: scenario.vehicles.filter((vehicle) => scenario.selection.vehicle_ids.includes(vehicle.id)).map((vehicle) => ({ id: vehicle.id, max_payload_kg: vehicle.max_payload_kg, max_simultaneous_machines: vehicle.max_simultaneous_machines, average_speed_kmh: vehicle.average_speed_kmh, ...(routes[vehicle.id] ?? { start_location_id: scenario.parameters.depot_location_id, end_location_id: scenario.parameters.depot_location_id }) })), machines: scenario.machines.map(({ id, weight_kg }) => ({ id, weight_kg })), locations: scenario.locations.map(({ id, x, y }) => ({ id, x, y })), orders: scenario.orders.filter((order) => scenario.selection.order_ids.includes(order.id)).map(({ id, machine_id, pickup_location_id, delivery_location_id }) => ({ id, machine_id, pickup_location_id, delivery_location_id })), parameters: clone(scenario.parameters) };
}

export function saveBusinessWorkspace(storage: StorageLike, workspace: BusinessWorkspace): void { storage.setItem(BUSINESS_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace)); }

function migrateWorkspace(workspace: BusinessWorkspace): BusinessWorkspace {
  return {
    ...workspace,
    schema_version: BUSINESS_WORKSPACE_VERSION,
    drafts: workspace.drafts.map((draft) => ({
      ...draft,
      optimization_strategy: draft.optimization_strategy ?? "BALANCED",
      require_all_selected_vehicles: draft.require_all_selected_vehicles ?? false,
    })),
    runs: (workspace.runs ?? []).map((run) => ({
      ...run,
      outcome: run.outcome ?? (run.result ? outcomeFromResult(run.result) : "TECHNICAL_ERROR"),
      failure: run.failure ?? (run.result ? (outcomeFromResult(run.result) === "SUCCESS" ? null : failureFromResult(run.source_snapshot, run.result, outcomeFromResult(run.result) as Exclude<OptimizationRunOutcome, "SUCCESS">)) : { message: "Detaljan razlog nije dostupan.", affected_order_ids: [], constraint_details: [], corrective_guidance: null }),
      optimization_strategy: run.optimization_strategy ?? "BALANCED",
      require_all_selected_vehicles: run.require_all_selected_vehicles ?? false,
      selected_vehicle_ids: run.selected_vehicle_ids ?? run.source_snapshot.vehicles.map((vehicle) => vehicle.id),
      selected_order_ids: run.selected_order_ids ?? run.source_snapshot.orders.map((order) => order.id),
    })),
  };
}
