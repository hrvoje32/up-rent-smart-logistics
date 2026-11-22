import type { DemoDataset, Machine, TransportOrder } from "@/types/optimizer-api";

export const SCENARIO_STORAGE_KEY = "up-rent.planning-scenarios.v1";
export const SAVED_PLAN_STORAGE_KEY = "up-rent.saved-plans.v1";
export const SCENARIO_SCHEMA_VERSION = 3;
export const ORIGINAL_SCENARIO_ID = "original-assessment";

export type ScenarioKind = "ORIGINAL" | "CUSTOM";
export type OrderStatus = "PENDING" | "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

export interface MachineType { id: string; name: string; default_weight_kg: number | null; description: string; }
export interface ScenarioVehicle { id: string; display_name: string; max_payload_kg: number; max_simultaneous_machines: number; average_speed_kmh: number; active: boolean; registration_number: string; description: string; notes: string; }
export interface ScenarioLocation { id: string; display_name: string; x: number; y: number; is_depot: boolean; }
export interface ScenarioMachine extends Machine { display_name: string; machine_type_id: string | null; }
export interface ScenarioOrder extends TransportOrder { notes: string; status: OrderStatus; }

export interface OptimizationSelection {
  vehicle_ids: string[];
  order_ids: string[];
  vehicle_routes: Record<string, { start_location_id: string; end_location_id: string }>;
}

export interface PlanningScenario {
  schema_version: number;
  id: string;
  name: string;
  kind: ScenarioKind;
  revision: number;
  created_at: string;
  updated_at: string;
  vehicles: ScenarioVehicle[];
  locations: ScenarioLocation[];
  machine_types: MachineType[];
  machines: ScenarioMachine[];
  orders: ScenarioOrder[];
  parameters: DemoDataset["parameters"];
  selection: OptimizationSelection;
}

export interface SavedRouteSnapshot {
  schema_version: number;
  id: string;
  name: string;
  scenario_id: string;
  scenario_revision: number;
  created_at: string;
  result: unknown;
}

export class ScenarioValidationError extends Error {}

function now(): string { return new Date().toISOString(); }
function clone<T>(value: T): T { return structuredClone(value); }
function uniqueId(prefix: string): string { return `${prefix}-${crypto.randomUUID()}`; }

function requiredText(value: string, field: string): string {
  const text = value.trim();
  if (!text) throw new ScenarioValidationError(`Polje „${field}” je obavezno.`);
  return text;
}

function requirePositiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new ScenarioValidationError(`Polje „${field}” mora biti pozitivan cijeli broj.`);
  return value;
}

function requireFinite(value: number, field: string): number {
  if (!Number.isFinite(value)) throw new ScenarioValidationError(`Polje „${field}” mora biti konačan broj.`);
  return value;
}

function requireUnique<T extends { id: string }>(records: T[], label: string): void {
  const seen = new Set<string>();
  for (const record of records) {
    const id = requiredText(record.id, `${label} ID`);
    if (seen.has(id)) throw new ScenarioValidationError(`Dvostruki ID za ${label}: ${id}.`);
    seen.add(id);
  }
}

export function createOriginalScenario(dataset: DemoDataset): PlanningScenario {
  const timestamp = now();
  return {
    schema_version: SCENARIO_SCHEMA_VERSION, id: ORIGINAL_SCENARIO_ID, name: "Izvorna procjena", kind: "ORIGINAL", revision: 1, created_at: timestamp, updated_at: timestamp,
    vehicles: dataset.vehicles.map((vehicle) => ({ id: vehicle.id, display_name: `Kamion ${vehicle.id}`, max_payload_kg: vehicle.max_payload_kg, max_simultaneous_machines: vehicle.max_simultaneous_machines, average_speed_kmh: vehicle.average_speed_kmh, active: true, registration_number: "", description: "", notes: "" })),
    locations: dataset.locations.map((location) => ({ ...clone(location), display_name: location.id, is_depot: location.id === dataset.parameters.depot_location_id })),
    machine_types: [],
    machines: dataset.machines.map((machine) => ({ ...clone(machine), display_name: machine.id, machine_type_id: null })),
    orders: dataset.orders.map((order) => ({ ...clone(order), notes: "", status: "PENDING" })),
    parameters: clone(dataset.parameters),
    selection: { vehicle_ids: dataset.vehicles.map((vehicle) => vehicle.id), order_ids: dataset.orders.map((order) => order.id), vehicle_routes: Object.fromEntries(dataset.vehicles.map((vehicle) => [vehicle.id, { start_location_id: vehicle.start_location_id, end_location_id: vehicle.end_location_id }])) },
  };
}

export function createCustomScenario(canonical: DemoDataset, name: string): PlanningScenario {
  const original = createOriginalScenario(canonical);
  const timestamp = now();
  return { ...original, id: uniqueId("scenario"), name: requiredText(name, "Naziv scenarija"), kind: "CUSTOM", revision: 1, created_at: timestamp, updated_at: timestamp };
}

export function duplicateScenario(source: PlanningScenario, name: string): PlanningScenario {
  const timestamp = now();
  return { ...clone(source), id: uniqueId("scenario"), name: requiredText(name, "Naziv scenarija"), kind: "CUSTOM", revision: 1, created_at: timestamp, updated_at: timestamp };
}

export function withScenarioUpdate(scenario: PlanningScenario, update: Omit<PlanningScenario, "schema_version" | "id" | "kind" | "revision" | "created_at" | "updated_at">): PlanningScenario {
  if (scenario.kind === "ORIGINAL") throw new ScenarioValidationError("Izvorna procjena je samo za čitanje.");
  const next = { ...scenario, ...clone(update), revision: scenario.revision + 1, updated_at: now() };
  validateScenario(next);
  return next;
}

export function resetScenarioFromCanonical(scenario: PlanningScenario, canonical: DemoDataset): PlanningScenario {
  if (scenario.kind === "ORIGINAL") return createOriginalScenario(canonical);
  const reset = createOriginalScenario(canonical);
  return { ...reset, id: scenario.id, name: scenario.name, kind: "CUSTOM", revision: scenario.revision + 1, created_at: scenario.created_at, updated_at: now() };
}

export function updateOptimizationSelection(scenario: PlanningScenario, selection: Omit<OptimizationSelection, "vehicle_routes"> & Partial<Pick<OptimizationSelection, "vehicle_routes">>): PlanningScenario {
  return withScenarioUpdate(scenario, { ...scenario, selection: { vehicle_ids: [...new Set(selection.vehicle_ids)], order_ids: [...new Set(selection.order_ids)], vehicle_routes: clone(selection.vehicle_routes ?? scenario.selection.vehicle_routes) } });
}

export function scenarioToOptimizerDataset(scenario: PlanningScenario): DemoDataset {
  validateScenario(scenario);
  const selectedVehicleIds = new Set(scenario.selection.vehicle_ids);
  const selectedOrderIds = new Set(scenario.selection.order_ids);
  const activeVehicles = scenario.vehicles.filter((vehicle) => vehicle.active && selectedVehicleIds.has(vehicle.id)).map((vehicle) => {
    const route = scenario.selection.vehicle_routes[vehicle.id];
    if (!route) throw new ScenarioValidationError(`Nedostaju postavke vožnje za vozilo ${vehicle.id}.`);
    return { id: vehicle.id, max_payload_kg: vehicle.max_payload_kg, max_simultaneous_machines: vehicle.max_simultaneous_machines, start_location_id: route.start_location_id, end_location_id: route.end_location_id, average_speed_kmh: vehicle.average_speed_kmh };
  });
  if (activeVehicles.length === 0) throw new ScenarioValidationError("Aktivirajte barem jedno vozilo prije optimizacije.");
  const selectedOrders = scenario.orders.filter((order) => selectedOrderIds.has(order.id) && order.status !== "CANCELLED" && order.status !== "COMPLETED");
  if (selectedOrders.length === 0) throw new ScenarioValidationError("Odaberite barem jedan aktivan transportni nalog prije optimizacije.");
  return {
    vehicles: activeVehicles,
    locations: scenario.locations.map((location) => ({ id: location.id, x: location.x, y: location.y })),
    machines: scenario.machines.map((machine) => ({ id: machine.id, weight_kg: machine.weight_kg })),
    orders: selectedOrders.map((order) => ({ id: order.id, machine_id: order.machine_id, pickup_location_id: order.pickup_location_id, delivery_location_id: order.delivery_location_id })),
    parameters: clone(scenario.parameters),
  };
}

export function validateScenario(scenario: PlanningScenario): void {
  if (scenario.schema_version !== SCENARIO_SCHEMA_VERSION) throw new ScenarioValidationError("Nepodržana verzija pohrane scenarija.");
  requiredText(scenario.id, "ID scenarija"); requiredText(scenario.name, "Naziv scenarija");
  if (scenario.kind !== "ORIGINAL" && scenario.kind !== "CUSTOM") throw new ScenarioValidationError("Nepodržana vrsta scenarija.");
  requirePositiveInteger(scenario.revision, "Revizija scenarija");
  if (scenario.vehicles.length > 20) throw new ScenarioValidationError("Scenarij može sadržavati najviše 20 vozila.");
  if (scenario.locations.length > 100) throw new ScenarioValidationError("Scenarij može sadržavati najviše 100 lokacija.");
  if (scenario.orders.length > 100) throw new ScenarioValidationError("Scenarij može sadržavati najviše 100 transportnih naloga.");
  requireUnique(scenario.vehicles, "vehicle"); requireUnique(scenario.locations, "location"); requireUnique(scenario.machines, "machine"); requireUnique(scenario.machine_types, "machine type"); requireUnique(scenario.orders, "order");
  const locationIds = new Set(scenario.locations.map((location) => location.id));
  const machineIds = new Set(scenario.machines.map((machine) => machine.id));
  const machineTypeIds = new Set(scenario.machine_types.map((type) => type.id));
  const vehicleIds = new Set(scenario.vehicles.map((vehicle) => vehicle.id));
  const orderIds = new Set(scenario.orders.map((order) => order.id));
  if (scenario.selection.vehicle_ids.some((id) => !vehicleIds.has(id))) throw new ScenarioValidationError("Odabir sadrži nepoznato vozilo.");
  if (scenario.selection.order_ids.some((id) => !orderIds.has(id))) throw new ScenarioValidationError("Odabir sadrži nepoznati transportni nalog.");
  for (const [vehicleId, route] of Object.entries(scenario.selection.vehicle_routes)) { if (!vehicleIds.has(vehicleId) || !locationIds.has(route.start_location_id) || !locationIds.has(route.end_location_id)) throw new ScenarioValidationError("Postavke vožnje upućuju na nepoznato vozilo ili lokaciju."); }
  if (!locationIds.has(scenario.parameters.depot_location_id)) throw new ScenarioValidationError("Baza scenarija mora upućivati na lokaciju.");
  scenario.locations.forEach((location) => { requiredText(location.display_name, "Naziv lokacije"); requireFinite(location.x, "X lokacije"); requireFinite(location.y, "Y lokacije"); });
  scenario.vehicles.forEach((vehicle) => { requiredText(vehicle.display_name, "Naziv vozila"); requirePositiveInteger(vehicle.max_payload_kg, "Nosivost vozila"); requirePositiveInteger(vehicle.max_simultaneous_machines, "Kapacitet strojeva vozila"); requirePositiveInteger(vehicle.average_speed_kmh, "Brzina vozila"); });
  scenario.machine_types.forEach((type) => { requiredText(type.name, "Naziv vrste stroja"); if (type.default_weight_kg !== null) requirePositiveInteger(type.default_weight_kg, "Zadana masa vrste stroja"); });
  scenario.machines.forEach((machine) => { requiredText(machine.display_name, "Naziv stroja"); requirePositiveInteger(machine.weight_kg, "Masa stroja"); if (machine.machine_type_id !== null && !machineTypeIds.has(machine.machine_type_id)) throw new ScenarioValidationError(`Stroj ${machine.id} upućuje na nepoznatu vrstu stroja.`); });
  scenario.orders.forEach((order) => { if (!machineIds.has(order.machine_id)) throw new ScenarioValidationError(`Nalog ${order.id} upućuje na nepoznati stroj.`); if (!locationIds.has(order.pickup_location_id) || !locationIds.has(order.delivery_location_id)) throw new ScenarioValidationError(`Nalog ${order.id} upućuje na nepoznatu lokaciju.`); if (!["PENDING", "PLANNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"].includes(order.status)) throw new ScenarioValidationError(`Nalog ${order.id} ima neispravan status.`); });
}

export function assertSafeDeletion(scenario: PlanningScenario, kind: "vehicle" | "location" | "machine" | "machine_type" | "order", id: string): void {
  if (scenario.kind === "ORIGINAL") throw new ScenarioValidationError("Izvorna procjena je samo za čitanje.");
  if (kind === "location" && (scenario.parameters.depot_location_id === id || Object.values(scenario.selection.vehicle_routes).some((route) => route.start_location_id === id || route.end_location_id === id) || scenario.orders.some((order) => order.pickup_location_id === id || order.delivery_location_id === id))) throw new ScenarioValidationError(`Lokacija ${id} se još koristi i nije ju moguće obrisati.`);
  if (kind === "machine" && scenario.orders.some((order) => order.machine_id === id)) throw new ScenarioValidationError(`Stroj ${id} se još koristi u nalogu.`);
  if (kind === "machine_type" && scenario.machines.some((machine) => machine.machine_type_id === id)) throw new ScenarioValidationError(`Vrsta stroja ${id} se još koristi u stroju.`);
}

export type ScenarioCollection = "vehicles" | "locations" | "machine_types" | "machines" | "orders";
export type ScenarioRecord = ScenarioVehicle | ScenarioLocation | MachineType | ScenarioMachine | ScenarioOrder;

export function upsertScenarioRecord(scenario: PlanningScenario, collection: ScenarioCollection, record: ScenarioRecord): PlanningScenario {
  if (scenario.kind === "ORIGINAL") throw new ScenarioValidationError("Izvorna procjena je samo za čitanje.");
  const records = scenario[collection] as ScenarioRecord[];
  const existingIndex = records.findIndex((item) => item.id === record.id);
  const nextRecords = existingIndex === -1 ? [...records, clone(record)] : records.map((item, index) => index === existingIndex ? clone(record) : item);
  return withScenarioUpdate(scenario, { ...scenario, [collection]: nextRecords } as Omit<PlanningScenario, "schema_version" | "id" | "kind" | "revision" | "created_at" | "updated_at">);
}

export function deleteScenarioRecord(scenario: PlanningScenario, collection: ScenarioCollection, id: string): PlanningScenario {
  const kind = collection === "machine_types" ? "machine_type" : collection.slice(0, -1) as "vehicle" | "location" | "machine" | "order";
  assertSafeDeletion(scenario, kind, id);
  const records = scenario[collection] as ScenarioRecord[];
  if (!records.some((record) => record.id === id)) throw new ScenarioValidationError(`Nepoznati ID za ${kind}: ${id}.`);
  return withScenarioUpdate(scenario, { ...scenario, [collection]: records.filter((record) => record.id !== id) } as Omit<PlanningScenario, "schema_version" | "id" | "kind" | "revision" | "created_at" | "updated_at">);
}

interface LocalStorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }

function parseStoredScenario(value: unknown): PlanningScenario {
  if (!isRecord(value)) throw new ScenarioValidationError("Stored scenario is invalid.");
  const stored = value as Record<string, unknown>;
  const scenario = stored.schema_version === 1 || stored.schema_version === 2
    ? {
      ...stored,
      schema_version: SCENARIO_SCHEMA_VERSION,
      vehicles: Array.isArray(stored.vehicles) ? stored.vehicles.map((vehicle) => isRecord(vehicle) ? (() => { const master = Object.fromEntries(Object.entries(vehicle).filter(([key]) => key !== "start_location_id" && key !== "end_location_id")); return { ...master, registration_number: typeof master.registration_number === "string" ? master.registration_number : "", description: typeof master.description === "string" ? master.description : "", notes: typeof master.notes === "string" ? master.notes : "" }; })() : vehicle) : stored.vehicles,
      orders: Array.isArray(stored.orders) ? stored.orders.map((order) => isRecord(order) ? { ...order, status: typeof order.status === "string" ? order.status : "PENDING" } : order) : stored.orders,
      selection: {
        vehicle_ids: Array.isArray(stored.vehicles) ? stored.vehicles.filter(isRecord).map((vehicle) => vehicle.id).filter((id): id is string => typeof id === "string") : [],
        order_ids: Array.isArray(stored.orders) ? stored.orders.filter(isRecord).map((order) => order.id).filter((id): id is string => typeof id === "string") : [],
        vehicle_routes: Array.isArray(stored.vehicles) ? Object.fromEntries(stored.vehicles.filter(isRecord).map((vehicle) => [vehicle.id, { start_location_id: typeof vehicle.start_location_id === "string" ? vehicle.start_location_id : "L0", end_location_id: typeof vehicle.end_location_id === "string" ? vehicle.end_location_id : "L0" }]).filter(([id]) => typeof id === "string")) : {},
      },
    } as unknown as PlanningScenario
    : stored as unknown as PlanningScenario;
  validateScenario(scenario);
  if (scenario.kind !== "CUSTOM") throw new ScenarioValidationError("Only custom scenarios may be stored locally.");
  return clone(scenario);
}

export function loadCustomScenarios(storage: LocalStorageLike): PlanningScenario[] {
  const raw = storage.getItem(SCENARIO_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new ScenarioValidationError("Stored scenario list is invalid.");
    return parsed.map(parseStoredScenario);
  } catch { storage.removeItem(SCENARIO_STORAGE_KEY); return []; }
}

export function saveCustomScenarios(storage: LocalStorageLike, scenarios: PlanningScenario[]): void {
  scenarios.forEach((scenario) => { if (scenario.kind !== "CUSTOM") throw new ScenarioValidationError("Only custom scenarios may be stored locally."); validateScenario(scenario); });
  storage.setItem(SCENARIO_STORAGE_KEY, JSON.stringify(scenarios));
}

export function exportScenario(scenario: PlanningScenario): string { validateScenario(scenario); return JSON.stringify({ schema_version: SCENARIO_SCHEMA_VERSION, scenario }, null, 2); }

export function importScenario(value: string): PlanningScenario {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed) || parsed.schema_version !== SCENARIO_SCHEMA_VERSION || !("scenario" in parsed)) throw new ScenarioValidationError("Unsupported scenario import format.");
    const scenario = parseStoredScenario(parsed.scenario);
    return { ...scenario, id: uniqueId("scenario"), kind: "CUSTOM", revision: 1, created_at: now(), updated_at: now() };
  } catch (error) { throw error instanceof ScenarioValidationError ? error : new ScenarioValidationError("Uvezeni JSON nije ispravan."); }
}

export function loadSavedPlans(storage: LocalStorageLike): SavedRouteSnapshot[] {
  const raw = storage.getItem(SAVED_PLAN_STORAGE_KEY); if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw); if (!Array.isArray(value)) throw new ScenarioValidationError("Stored route list is invalid.");
    return value.map((item): SavedRouteSnapshot => {
      if (!isRecord(item) || (item.schema_version !== 1 && item.schema_version !== 2 && item.schema_version !== SCENARIO_SCHEMA_VERSION) || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.scenario_id !== "string" || typeof item.scenario_revision !== "number" || typeof item.created_at !== "string" || !isRecord(item.result)) throw new ScenarioValidationError("Stored route snapshot is invalid.");
      requirePositiveInteger(item.scenario_revision, "Saved route scenario revision");
      requiredText(item.id, "Saved route ID"); requiredText(item.name, "Saved route name"); requiredText(item.scenario_id, "Saved route scenario ID");
      if (Number.isNaN(Date.parse(item.created_at))) throw new ScenarioValidationError("Saved route timestamp is invalid.");
      return clone({ ...item, schema_version: SCENARIO_SCHEMA_VERSION } as unknown as SavedRouteSnapshot);
    });
  } catch { storage.removeItem(SAVED_PLAN_STORAGE_KEY); return []; }
}

export function saveSavedPlans(storage: LocalStorageLike, plans: SavedRouteSnapshot[]): void { storage.setItem(SAVED_PLAN_STORAGE_KEY, JSON.stringify(plans)); }

export function createSavedPlan(name: string, scenario: PlanningScenario, result: unknown): SavedRouteSnapshot { return { schema_version: SCENARIO_SCHEMA_VERSION, id: uniqueId("plan"), name: requiredText(name, "Saved plan name"), scenario_id: scenario.id, scenario_revision: scenario.revision, created_at: now(), result: clone(result) }; }
