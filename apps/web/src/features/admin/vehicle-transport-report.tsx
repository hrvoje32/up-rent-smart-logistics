import { distance, duration, plural } from "@/lib/format";
import { estimateRoadMetrics, formatCircuityFactor } from "@/lib/road-distance-estimate";
import { formatSimulationDate } from "@/lib/simulation-date";
import { formatSimulatedTime, type SimulatedRouteTimeline } from "@/lib/route-timeline";
import { t } from "@/lib/i18n";
import type { LoadSnapshot, RouteMetrics, Vehicle, VehicleRoute } from "@/types/optimizer-api";

interface VehicleTransportReportProps {
  vehicle: Vehicle;
  route: VehicleRoute;
  metric: RouteMetrics | undefined;
  snapshots: LoadSnapshot[];
  timeline: SimulatedRouteTimeline;
  simulatedStartDate: string;
  circuityScale: number;
  unservedOrderIds: string[];
}

function ReportSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="report-section"><h5>{title}</h5>{children}</section>;
}

function ReportList({ items }: { items: Array<[string, string]> }) {
  return <dl className="report-list">{items.map(([term, value]) => <div key={term}><dt>{term}</dt><dd>{value}</dd></div>)}</dl>;
}

export function ReportValidationStatus({ isValid, unservedOrderIds }: { isValid: boolean; unservedOrderIds: string[] }) {
  return <ReportSection title="Status provjere"><p className={isValid ? "report-status report-status--success" : "report-status report-status--warning"}>{isValid ? "Raspored je provjeren" : "Potrebna je provjera rasporeda"}</p><p>{unservedOrderIds.length === 0 ? "Nema neizvršenih naloga." : `Neizvršeni nalozi: ${unservedOrderIds.join(", ")}`}</p></ReportSection>;
}

export function VehicleTransportReport({ vehicle, route, metric, snapshots, timeline, simulatedStartDate, circuityScale, unservedOrderIds }: VehicleTransportReportProps) {
  const vehicleSnapshots = snapshots.filter((snapshot) => snapshot.vehicle_id === vehicle.id);
  const isIdle = route.stops.every((stop) => stop.actions.length === 0);
  const actions = route.stops.flatMap((stop) => stop.actions);
  const pickupCount = actions.filter((action) => action.action_type === "PICKUP").length;
  const deliveryCount = actions.filter((action) => action.action_type === "DELIVERY").length;
  const maxLoad = Math.max(0, ...vehicleSnapshots.map((snapshot) => snapshot.load_kg));
  const maxMachineCount = Math.max(0, ...vehicleSnapshots.map((snapshot) => snapshot.machine_count));
  const finalSnapshot = vehicleSnapshots.at(-1);
  const estimated = estimateRoadMetrics({ distance_tenths_km: metric?.distance_tenths_km ?? 0, driving_time_seconds: metric?.driving_time_seconds ?? 0, pickup_service_seconds: metric?.pickup_service_seconds ?? 0, delivery_service_seconds: metric?.delivery_service_seconds ?? 0 }, circuityScale);
  const finalLocation = route.stops.at(-1)?.location_id ?? vehicle.end_location_id;
  const startsAtDepot = route.stops.at(0)?.location_id === vehicle.start_location_id;
  const returnsToDepot = !isIdle && finalLocation === vehicle.end_location_id;
  const activeStartDate = isIdle ? t.notApplicable : formatSimulationDate(simulatedStartDate, timeline.startSeconds);
  const activeFinishDate = isIdle ? t.notApplicable : formatSimulationDate(simulatedStartDate, timeline.completionSeconds);
  const activeStartTime = isIdle ? t.notApplicable : formatSimulatedTime(timeline.startSeconds);
  const activeFinishTime = isIdle ? t.notApplicable : formatSimulatedTime(timeline.completionSeconds);
  const routeStatus = isIdle ? "Nije korišten u ovom planu" : t.active;

  return <section className="transport-report" aria-labelledby={`report-${vehicle.id}`}>
    <div className="transport-report__heading"><div><p className="eyebrow">Završni transportni izvještaj · simulacija</p><h4 id={`report-${vehicle.id}`}>Kamion {vehicle.id}</h4></div><span className={isIdle ? "pill" : "pill pill--success"}>{routeStatus}</span></div>
    <p className="transport-report__intro">Vremenska zona simulacije: lokalni planski prikaz. Pauze nisu planirane; izvještaj nije procjena radnog vremena vozača ni zakonske usklađenosti.</p>
    <div className="transport-report__grid">
      <ReportSection title="Identifikacija"><ReportList items={[["ID vozila", vehicle.id], ["Status", routeStatus], ["Nosivost", `${vehicle.max_payload_kg} kg`], ["Kapacitet strojeva", plural(vehicle.max_simultaneous_machines, "machine")]]} /></ReportSection>
      <ReportSection title="Raspored"><ReportList items={[["Datum početka simulacije", activeStartDate], ["Vrijeme početka simulacije", activeStartTime], ["Datum završetka simulacije", activeFinishDate], ["Vrijeme završetka simulacije", activeFinishTime], ["Početna baza", vehicle.start_location_id], ["Završna baza", vehicle.end_location_id], ["Ukupno planirano trajanje", metric ? duration(metric.total_elapsed_seconds) : t.notReported]]} /></ReportSection>
      <ReportSection title="Raspodjela vremena"><ReportList items={[["Vrijeme vožnje", metric ? duration(metric.driving_time_seconds) : t.notReported], ["Preuzimanje / utovar", metric ? duration(metric.pickup_service_seconds) : t.notReported], ["Isporuka / istovar", metric ? duration(metric.delivery_service_seconds) : t.notReported], ["Ukupno vrijeme usluge", metric ? duration(metric.total_service_seconds) : t.notReported], ["Planirane pauze", "Pauze nisu planirane"], ["Simulirano radno trajanje", metric ? duration(metric.total_elapsed_seconds) : t.notReported], ["Ukupno trajanje", metric ? duration(metric.total_elapsed_seconds) : t.notReported]]} /></ReportSection>
      <ReportSection title="Udaljenost"><ReportList items={[["Valjana euklidska udaljenost", metric ? distance(metric.distance_tenths_km) : t.notReported], ["Procijenjena cestovna udaljenost", `${distance(estimated.estimatedDistanceTenthsKm)} (neobavezna simulacija)`], ["Faktor zaobilaznosti", `${formatCircuityFactor(circuityScale)}×`]]} /></ReportSection>
      <ReportSection title="Prijevoz"><ReportList items={[["Izvršeni nalozi", metric ? plural(metric.completed_order_count, "order") : t.notReported], ["Ukupno preuzimanja", plural(pickupCount, "action")], ["Ukupno isporuka", plural(deliveryCount, "action")], ["Maksimalno opterećenje", `${maxLoad} kg`], ["Maksimalan broj strojeva", plural(maxMachineCount, "machine")], ["Preostali teret", `${finalSnapshot?.load_kg ?? 0} kg · ${finalSnapshot?.machine_count ?? 0} strojeva`]]} /></ReportSection>
      <ReportSection title="Operacije"><ReportList items={[["Posjećene lokacije", route.stops.map((stop) => stop.location_id).join(" → ") || "Nema aktivne rute"], ["Izvršene radnje", actions.length === 0 ? "Nema radnji preuzimanja/isporuke" : `${plural(pickupCount, "action")} preuzimanja · ${plural(deliveryCount, "action")} isporuke`], ["Polazak iz baze", startsAtDepot || isIdle ? "Potvrđeno" : "Nedostaje / nevaljano"], ["Povratak u bazu", returnsToDepot || isIdle ? "Potvrđeno" : "Nedostaje / nevaljano"]]} /></ReportSection>
      <ReportValidationStatus isValid={metric?.is_valid ?? false} unservedOrderIds={unservedOrderIds} />
      <ReportSection title="Upozorenja i nedostajući podaci"><p>{isIdle ? "Vozilo ostaje u bazi s 0 km i bez aktivne smjene vozača." : estimated.exceedsOriginalDrivingLimit ? "Procijenjeni scenarij vožnje premašuje izvorno ograničenje od 9 sati; to ne potvrđuje izvedivost." : "Nema posebnih upozorenja za izvještaj. Vremenska crta i metrike temelje se na valjanoj euklidskoj simulaciji."}</p></ReportSection>
    </div>
  </section>;
}
import type { ReactNode } from "react";

