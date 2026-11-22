export type ActionType = "PICKUP" | "DELIVERY";
export type OptimizationStatus =
  | "FEASIBLE"
  | "INFEASIBLE"
  | "NO_SOLUTION_FOUND"
  | "VALIDATION_FAILED"
  | "ERROR";

export interface Vehicle {
  id: string;
  max_payload_kg: number;
  max_simultaneous_machines: number;
  start_location_id: string;
  end_location_id: string;
  average_speed_kmh: number;
}

export interface Machine {
  id: string;
  weight_kg: number;
}

export interface Location {
  id: string;
  x: number;
  y: number;
}

export interface TransportOrder {
  id: string;
  machine_id: string;
  pickup_location_id: string;
  delivery_location_id: string;
  earliest_pickup_at?: string | null;
  latest_pickup_at?: string | null;
  earliest_delivery_at?: string | null;
  delivery_deadline_at?: string | null;
}

export interface DemoDataset {
  vehicles: Vehicle[];
  machines: Machine[];
  locations: Location[];
  orders: TransportOrder[];
  parameters: {
    depot_location_id: string;
    max_driving_minutes: number;
    pickup_service_minutes: number;
    delivery_service_minutes: number;
    planning_start_at?: string | null;
  };
}

export interface OptimizerSettings {
  time_limit_seconds?: number;
  optimization_strategy?: "FASTEST_DELIVERY" | "BALANCED" | "DISTANCE_SAVINGS";
  require_all_selected_vehicles?: boolean;
}

export interface RouteAction {
  order_id: string;
  action_type: ActionType;
}

export interface RouteStop {
  location_id: string;
  actions: RouteAction[];
}

export interface VehicleRoute {
  vehicle_id: string;
  stops: RouteStop[];
}

export interface LoadSnapshot {
  vehicle_id: string;
  order_id: string;
  action_type: ActionType;
  stop_index: number;
  action_index: number;
  load_kg: number;
  machine_count: number;
}

export interface RouteMetrics {
  vehicle_id: string;
  route_index: number;
  distance_tenths_km: number;
  driving_time_seconds: number;
  pickup_service_seconds: number;
  delivery_service_seconds: number;
  waiting_time_seconds?: number;
  total_service_seconds: number;
  total_elapsed_seconds: number;
  completed_order_count: number;
  is_valid: boolean;
}

export interface ValidationViolation {
  code: string;
  description: string;
  vehicle_id: string | null;
  order_id: string | null;
  stop_index: number | null;
  action_index: number | null;
}

export interface OptimizationResult {
  status: OptimizationStatus;
  solver_status: number | null;
  solver_duration_seconds: number;
  plan: { routes: VehicleRoute[] } | null;
  validation_result: {
    is_valid: boolean;
    is_complete: boolean;
    per_vehicle_validity: Record<string, boolean>;
    violations: ValidationViolation[];
    unserved_order_ids: string[];
    completed_order_counts: Record<string, number>;
    route_metrics: RouteMetrics[];
    combined_distance_tenths_km: number;
    combined_driving_time_seconds: number;
    combined_pickup_service_seconds: number;
    combined_delivery_service_seconds: number;
    combined_waiting_time_seconds?: number;
    combined_total_service_seconds: number;
    combined_total_elapsed_seconds: number;
    load_snapshots: LoadSnapshot[];
  } | null;
  violations: ValidationViolation[];
  baseline_comparison: {
    baseline_distance_tenths_km: number;
    optimized_distance_tenths_km: number;
    distance_reduction_tenths_km: number;
    distance_reduction_percentage: number;
  } | null;
  diagnostic_message: string | null;
}

type ApiRecord = Record<string, unknown>;

export class OptimizerContractError extends Error {}

function asRecord(value: unknown, name: string): ApiRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new OptimizerContractError(`${name} is not an object.`);
  }
  return value as ApiRecord;
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new OptimizerContractError(`${name} is not a string.`);
  }
  return value;
}

function asNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new OptimizerContractError(`${name} is not a finite number.`);
  }
  return value;
}

function asBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new OptimizerContractError(`${name} is not a boolean.`);
  }
  return value;
}

function asArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new OptimizerContractError(`${name} is not an array.`);
  }
  return value;
}

function required(record: ApiRecord, key: string, name: string): unknown {
  if (!(key in record)) {
    throw new OptimizerContractError(`${name}.${key} is missing.`);
  }
  return record[key];
}

function optionalDateTime(record: ApiRecord, key: string, name: string): string | null | undefined {
  const value = record[key];
  if (value === undefined || value === null) return value;
  return asString(value, `${name}.${key}`);
}

function parseAction(value: unknown): RouteAction {
  const record = asRecord(value, "action");
  const actionType = asString(required(record, "action_type", "action"), "action.action_type");
  if (actionType !== "PICKUP" && actionType !== "DELIVERY") {
    throw new OptimizerContractError("action.action_type is unsupported.");
  }
  return { order_id: asString(required(record, "order_id", "action"), "action.order_id"), action_type: actionType };
}

function parseStop(value: unknown): RouteStop {
  const record = asRecord(value, "stop");
  return {
    location_id: asString(required(record, "location_id", "stop"), "stop.location_id"),
    actions: asArray(required(record, "actions", "stop"), "stop.actions").map(parseAction),
  };
}

function parseRoute(value: unknown): VehicleRoute {
  const record = asRecord(value, "route");
  return {
    vehicle_id: asString(required(record, "vehicle_id", "route"), "route.vehicle_id"),
    stops: asArray(required(record, "stops", "route"), "route.stops").map(parseStop),
  };
}

export function parseDemoDataset(value: unknown): DemoDataset {
  const record = asRecord(value, "dataset");
  const parseVehicle = (item: unknown): Vehicle => {
    const vehicle = asRecord(item, "vehicle");
    return {
      id: asString(required(vehicle, "id", "vehicle"), "vehicle.id"),
      max_payload_kg: asNumber(required(vehicle, "max_payload_kg", "vehicle"), "vehicle.max_payload_kg"),
      max_simultaneous_machines: asNumber(required(vehicle, "max_simultaneous_machines", "vehicle"), "vehicle.max_simultaneous_machines"),
      start_location_id: asString(required(vehicle, "start_location_id", "vehicle"), "vehicle.start_location_id"),
      end_location_id: asString(required(vehicle, "end_location_id", "vehicle"), "vehicle.end_location_id"),
      average_speed_kmh: asNumber(required(vehicle, "average_speed_kmh", "vehicle"), "vehicle.average_speed_kmh"),
    };
  };
  const parseMachine = (item: unknown): Machine => {
    const machine = asRecord(item, "machine");
    return { id: asString(required(machine, "id", "machine"), "machine.id"), weight_kg: asNumber(required(machine, "weight_kg", "machine"), "machine.weight_kg") };
  };
  const parseLocation = (item: unknown): Location => {
    const location = asRecord(item, "location");
    return { id: asString(required(location, "id", "location"), "location.id"), x: asNumber(required(location, "x", "location"), "location.x"), y: asNumber(required(location, "y", "location"), "location.y") };
  };
  const parseOrder = (item: unknown): TransportOrder => {
    const order = asRecord(item, "order");
    return {
      id: asString(required(order, "id", "order"), "order.id"),
      machine_id: asString(required(order, "machine_id", "order"), "order.machine_id"),
      pickup_location_id: asString(required(order, "pickup_location_id", "order"), "order.pickup_location_id"),
      delivery_location_id: asString(required(order, "delivery_location_id", "order"), "order.delivery_location_id"),
      earliest_pickup_at: optionalDateTime(order, "earliest_pickup_at", "order"),
      latest_pickup_at: optionalDateTime(order, "latest_pickup_at", "order"),
      earliest_delivery_at: optionalDateTime(order, "earliest_delivery_at", "order"),
      delivery_deadline_at: optionalDateTime(order, "delivery_deadline_at", "order"),
    };
  };
  const parameters = asRecord(required(record, "parameters", "dataset"), "dataset.parameters");
  return {
    vehicles: asArray(required(record, "vehicles", "dataset"), "dataset.vehicles").map(parseVehicle),
    machines: asArray(required(record, "machines", "dataset"), "dataset.machines").map(parseMachine),
    locations: asArray(required(record, "locations", "dataset"), "dataset.locations").map(parseLocation),
    orders: asArray(required(record, "orders", "dataset"), "dataset.orders").map(parseOrder),
    parameters: {
      depot_location_id: asString(required(parameters, "depot_location_id", "parameters"), "parameters.depot_location_id"),
      max_driving_minutes: asNumber(required(parameters, "max_driving_minutes", "parameters"), "parameters.max_driving_minutes"),
      pickup_service_minutes: asNumber(required(parameters, "pickup_service_minutes", "parameters"), "parameters.pickup_service_minutes"),
      delivery_service_minutes: asNumber(required(parameters, "delivery_service_minutes", "parameters"), "parameters.delivery_service_minutes"),
      planning_start_at: optionalDateTime(parameters, "planning_start_at", "parameters"),
    },
  };
}

export function parseOptimizationResult(value: unknown): OptimizationResult {
  const record = asRecord(value, "optimization result");
  const status = asString(required(record, "status", "optimization result"), "optimization result.status");
  if (!["FEASIBLE", "INFEASIBLE", "NO_SOLUTION_FOUND", "VALIDATION_FAILED", "ERROR"].includes(status)) {
    throw new OptimizerContractError("optimization result.status is unsupported.");
  }
  const optimizationStatus = status as OptimizationStatus;
  const planValue = record.plan;
  const validationValue = record.validation_result;
  const baselineValue = record.baseline_comparison;
  const parseViolation = (item: unknown): ValidationViolation => {
    const violation = asRecord(item, "violation");
    return {
      code: asString(required(violation, "code", "violation"), "violation.code"),
      description: asString(required(violation, "description", "violation"), "violation.description"),
      vehicle_id: typeof violation.vehicle_id === "string" ? violation.vehicle_id : null,
      order_id: typeof violation.order_id === "string" ? violation.order_id : null,
      stop_index: typeof violation.stop_index === "number" ? violation.stop_index : null,
      action_index: typeof violation.action_index === "number" ? violation.action_index : null,
    };
  };
  const parseMetric = (item: unknown): RouteMetrics => {
    const metric = asRecord(item, "route metric");
    return {
      vehicle_id: asString(required(metric, "vehicle_id", "route metric"), "route metric.vehicle_id"),
      route_index: asNumber(required(metric, "route_index", "route metric"), "route metric.route_index"),
      distance_tenths_km: asNumber(required(metric, "distance_tenths_km", "route metric"), "route metric.distance_tenths_km"),
      driving_time_seconds: asNumber(required(metric, "driving_time_seconds", "route metric"), "route metric.driving_time_seconds"),
      pickup_service_seconds: asNumber(required(metric, "pickup_service_seconds", "route metric"), "route metric.pickup_service_seconds"),
      delivery_service_seconds: asNumber(required(metric, "delivery_service_seconds", "route metric"), "route metric.delivery_service_seconds"),
      waiting_time_seconds: typeof metric.waiting_time_seconds === "number" ? asNumber(metric.waiting_time_seconds, "route metric.waiting_time_seconds") : 0,
      total_service_seconds: asNumber(required(metric, "total_service_seconds", "route metric"), "route metric.total_service_seconds"),
      total_elapsed_seconds: asNumber(required(metric, "total_elapsed_seconds", "route metric"), "route metric.total_elapsed_seconds"),
      completed_order_count: asNumber(required(metric, "completed_order_count", "route metric"), "route metric.completed_order_count"),
      is_valid: asBoolean(required(metric, "is_valid", "route metric"), "route metric.is_valid"),
    };
  };
  const parseSnapshot = (item: unknown): LoadSnapshot => {
    const snapshot = asRecord(item, "load snapshot");
    const actionType = asString(required(snapshot, "action_type", "load snapshot"), "load snapshot.action_type");
    if (actionType !== "PICKUP" && actionType !== "DELIVERY") throw new OptimizerContractError("load snapshot.action_type is unsupported.");
    return {
      vehicle_id: asString(required(snapshot, "vehicle_id", "load snapshot"), "load snapshot.vehicle_id"),
      order_id: asString(required(snapshot, "order_id", "load snapshot"), "load snapshot.order_id"),
      action_type: actionType,
      stop_index: asNumber(required(snapshot, "stop_index", "load snapshot"), "load snapshot.stop_index"),
      action_index: asNumber(required(snapshot, "action_index", "load snapshot"), "load snapshot.action_index"),
      load_kg: asNumber(required(snapshot, "load_kg", "load snapshot"), "load snapshot.load_kg"),
      machine_count: asNumber(required(snapshot, "machine_count", "load snapshot"), "load snapshot.machine_count"),
    };
  };
  const plan = planValue === null ? null : { routes: asArray(required(asRecord(planValue, "plan"), "routes", "plan"), "plan.routes").map(parseRoute) };
  const validation = validationValue === null ? null : asRecord(validationValue, "validation result");
  const counts = validation === null ? null : asRecord(required(validation, "completed_order_counts", "validation result"), "validation result.completed_order_counts");
  const completedOrderCounts = counts === null ? null : Object.fromEntries(Object.entries(counts).map(([key, item]) => [key, asNumber(item, `completed_order_counts.${key}`)]));
  const validity = validation === null ? null : asRecord(required(validation, "per_vehicle_validity", "validation result"), "validation result.per_vehicle_validity");
  const perVehicleValidity = validity === null ? null : Object.fromEntries(Object.entries(validity).map(([key, item]) => [key, asBoolean(item, `per_vehicle_validity.${key}`)]));
  const baseline = baselineValue === null ? null : asRecord(baselineValue, "baseline comparison");
  return {
    status: optimizationStatus,
    solver_status: typeof record.solver_status === "number" ? record.solver_status : null,
    solver_duration_seconds: asNumber(required(record, "solver_duration_seconds", "optimization result"), "optimization result.solver_duration_seconds"),
    plan,
    validation_result: validation === null ? null : {
      is_valid: asBoolean(required(validation, "is_valid", "validation result"), "validation result.is_valid"),
      is_complete: asBoolean(required(validation, "is_complete", "validation result"), "validation result.is_complete"),
      per_vehicle_validity: perVehicleValidity ?? {},
      violations: asArray(required(validation, "violations", "validation result"), "validation result.violations").map(parseViolation),
      unserved_order_ids: asArray(required(validation, "unserved_order_ids", "validation result"), "validation result.unserved_order_ids").map((item) => asString(item, "unserved order id")),
      completed_order_counts: completedOrderCounts ?? {},
      route_metrics: asArray(required(validation, "route_metrics", "validation result"), "validation result.route_metrics").map(parseMetric),
      combined_distance_tenths_km: asNumber(required(validation, "combined_distance_tenths_km", "validation result"), "validation result.combined_distance_tenths_km"),
      combined_driving_time_seconds: asNumber(required(validation, "combined_driving_time_seconds", "validation result"), "validation result.combined_driving_time_seconds"),
      combined_pickup_service_seconds: asNumber(required(validation, "combined_pickup_service_seconds", "validation result"), "validation result.combined_pickup_service_seconds"),
      combined_delivery_service_seconds: asNumber(required(validation, "combined_delivery_service_seconds", "validation result"), "validation result.combined_delivery_service_seconds"),
      combined_waiting_time_seconds: typeof validation.combined_waiting_time_seconds === "number" ? asNumber(validation.combined_waiting_time_seconds, "validation result.combined_waiting_time_seconds") : 0,
      combined_total_service_seconds: asNumber(required(validation, "combined_total_service_seconds", "validation result"), "validation result.combined_total_service_seconds"),
      combined_total_elapsed_seconds: asNumber(required(validation, "combined_total_elapsed_seconds", "validation result"), "validation result.combined_total_elapsed_seconds"),
      load_snapshots: asArray(required(validation, "load_snapshots", "validation result"), "validation result.load_snapshots").map(parseSnapshot),
    },
    violations: asArray(required(record, "violations", "optimization result"), "optimization result.violations").map(parseViolation),
    baseline_comparison: baseline === null ? null : {
      baseline_distance_tenths_km: asNumber(required(baseline, "baseline_distance_tenths_km", "baseline comparison"), "baseline_distance_tenths_km"),
      optimized_distance_tenths_km: asNumber(required(baseline, "optimized_distance_tenths_km", "baseline comparison"), "optimized_distance_tenths_km"),
      distance_reduction_tenths_km: asNumber(required(baseline, "distance_reduction_tenths_km", "baseline comparison"), "distance_reduction_tenths_km"),
      distance_reduction_percentage: asNumber(required(baseline, "distance_reduction_percentage", "baseline comparison"), "distance_reduction_percentage"),
    },
    diagnostic_message: typeof record.diagnostic_message === "string" ? record.diagnostic_message : null,
  };
}
