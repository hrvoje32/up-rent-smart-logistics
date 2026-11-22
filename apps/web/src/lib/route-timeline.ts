import type {
  DemoDataset,
  LoadSnapshot,
  RouteAction,
  VehicleRoute,
} from "@/types/optimizer-api";

export interface SimulatedActionTimeline {
  action: RouteAction;
  serviceStartSeconds: number;
  serviceFinishSeconds: number;
  loadSnapshot: LoadSnapshot | undefined;
}

export interface SimulatedStopTimeline {
  sequence: number;
  locationId: string;
  travelDistanceTenthsKm: number;
  travelDurationSeconds: number;
  arrivalSeconds: number;
  departureSeconds: number;
  actions: SimulatedActionTimeline[];
}

export interface SimulatedRouteTimeline {
  vehicleId: string;
  startSeconds: number;
  completionSeconds: number;
  elapsedSeconds: number;
  stops: SimulatedStopTimeline[];
}

export function parseSimulatedStartTime(value: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return 8 * 3600;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours <= 23 && minutes <= 59 ? hours * 3600 + minutes * 60 : 8 * 3600;
}

export function formatSimulatedTime(totalSeconds: number): string {
  const dayOffset = Math.floor(totalSeconds / 86_400);
  const timeOfDay = ((totalSeconds % 86_400) + 86_400) % 86_400;
  const hours = Math.floor(timeOfDay / 3600);
  const minutes = Math.floor((timeOfDay % 3600) / 60);
  const seconds = timeOfDay % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return dayOffset === 0 ? clock : `Dan +${dayOffset} · ${clock}`;
}

export function buildSimulatedRouteTimeline({
  dataset,
  route,
  snapshots,
  startTime,
}: {
  dataset: DemoDataset;
  route: VehicleRoute;
  snapshots: LoadSnapshot[];
  startTime: string;
}): SimulatedRouteTimeline {
  const vehicle = dataset.vehicles.find((item) => item.id === route.vehicle_id);
  if (!vehicle) throw new Error(`Route references unknown vehicle '${route.vehicle_id}'.`);

  const locations = new Map(dataset.locations.map((location) => [location.id, location]));
  const snapshotByAction = new Map(snapshots.map((snapshot) => [`${snapshot.vehicle_id}:${snapshot.stop_index}:${snapshot.action_index}`, snapshot]));
  const startSeconds = parseSimulatedStartTime(startTime);
  let cursor = startSeconds;
  let previousLocationId: string | undefined;
  const stops = route.stops.map((stop, stopIndex) => {
    const travelDistanceTenthsKm = previousLocationId === undefined ? 0 : segmentDistanceTenthsKm(locations, previousLocationId, stop.location_id);
    const travelDurationSeconds = drivingTimeSeconds(travelDistanceTenthsKm, vehicle.average_speed_kmh);
    cursor += travelDurationSeconds;
    const arrivalSeconds = cursor;
    const actions = stop.actions.map((action, actionIndex) => {
      const serviceStartSeconds = cursor;
      cursor += action.action_type === "PICKUP" ? dataset.parameters.pickup_service_minutes * 60 : dataset.parameters.delivery_service_minutes * 60;
      return {
        action,
        serviceStartSeconds,
        serviceFinishSeconds: cursor,
        loadSnapshot: snapshotByAction.get(`${route.vehicle_id}:${stopIndex}:${actionIndex}`),
      };
    });
    previousLocationId = stop.location_id;
    return {
      sequence: stopIndex + 1,
      locationId: stop.location_id,
      travelDistanceTenthsKm,
      travelDurationSeconds,
      arrivalSeconds,
      departureSeconds: cursor,
      actions,
    };
  });

  return { vehicleId: route.vehicle_id, startSeconds, completionSeconds: cursor, elapsedSeconds: cursor - startSeconds, stops };
}

function segmentDistanceTenthsKm(
  locations: Map<string, { x: number; y: number }>,
  fromLocationId: string,
  toLocationId: string,
): number {
  const from = locations.get(fromLocationId);
  const to = locations.get(toLocationId);
  if (!from || !to) throw new Error(`Route references an unknown location '${!from ? fromLocationId : toLocationId}'.`);
  return Math.floor(Math.hypot(to.x - from.x, to.y - from.y) * 10 + 0.5);
}

function drivingTimeSeconds(distanceTenthsKm: number, speedKmh: number): number {
  const numerator = distanceTenthsKm * 360;
  return Math.floor((numerator * 2 + speedKmh) / (2 * speedKmh));
}
