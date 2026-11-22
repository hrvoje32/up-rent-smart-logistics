import { distance, duration } from "@/lib/format";
import { buildSimulatedRouteTimeline, formatSimulatedTime } from "@/lib/route-timeline";
import type { DemoDataset, OptimizationResult, VehicleRoute } from "@/types/optimizer-api";

const headers = [
  "Vozilo",
  "Stajanje",
  "Lokacija",
  "Dionica",
  "Trajanje vožnje",
  "Dolazak (simulirano)",
  "Radnja",
  "Nalog",
  "Stroj",
  "Početak usluge (simulirano)",
  "Završetak usluge (simulirano)",
  "Polazak (simulirano)",
  "Teret nakon radnje",
  "Strojeva nakon radnje",
] as const;

type CsvRow = readonly string[];

export function buildTransportPlanCsv({
  dataset,
  result,
  startTime,
}: {
  dataset: DemoDataset;
  result: OptimizationResult;
  startTime: string;
}): string {
  const ordersById = new Map(dataset.orders.map((order) => [order.id, order]));
  const snapshots = result.validation_result?.load_snapshots ?? [];
  const rows: CsvRow[] = [];

  for (const vehicle of dataset.vehicles) {
    const route = result.plan?.routes.find((item) => item.vehicle_id === vehicle.id);
    if (!route || route.stops.length === 0) {
      rows.push([vehicle.id, "—", vehicle.start_location_id, "0,0 km", "0 min", "—", "Nije korišten u ovom planu", "—", "—", "—", "—", "—", "0 kg", "0"]);
      continue;
    }
    rows.push(...routeRows(dataset, route, snapshots, ordersById, startTime));
  }

  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(";")).join("\r\n");
}

export function downloadTransportPlanCsv(input: {
  dataset: DemoDataset;
  result: OptimizationResult;
  startTime: string;
}): void {
  const blob = new Blob(["\uFEFF", buildTransportPlanCsv(input)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "up-rent-plan-prijevoza.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function routeRows(
  dataset: DemoDataset,
  route: VehicleRoute,
  snapshots: NonNullable<OptimizationResult["validation_result"]>["load_snapshots"],
  ordersById: Map<string, DemoDataset["orders"][number]>,
  startTime: string,
): CsvRow[] {
  const timeline = buildSimulatedRouteTimeline({ dataset, route, snapshots, startTime });
  return timeline.stops.flatMap((stop) => {
    const shared = [
      route.vehicle_id,
      String(stop.sequence),
      stop.locationId,
      distance(stop.travelDistanceTenthsKm),
      duration(stop.travelDurationSeconds),
      formatSimulatedTime(stop.arrivalSeconds),
    ];
    if (stop.actions.length === 0) {
      return [[...shared, "Putovanje / baza", "—", "—", "—", "—", formatSimulatedTime(stop.departureSeconds), "—", "—"]];
    }
    return stop.actions.map((scheduledAction) => {
      const order = ordersById.get(scheduledAction.action.order_id);
      const snapshot = scheduledAction.loadSnapshot;
      return [
        ...shared,
        scheduledAction.action.action_type === "PICKUP" ? "Preuzimanje" : "Isporuka",
        scheduledAction.action.order_id,
        order?.machine_id ?? "—",
        formatSimulatedTime(scheduledAction.serviceStartSeconds),
        formatSimulatedTime(scheduledAction.serviceFinishSeconds),
        formatSimulatedTime(stop.departureSeconds),
        snapshot ? `${snapshot.load_kg} kg` : "—",
        snapshot ? String(snapshot.machine_count) : "—",
      ];
    });
  });
}

function escapeCsvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
