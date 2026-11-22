"use client";

import { useMemo, useState } from "react";

import type { BusinessVehicle } from "@/lib/business-workspace";
import { locationLabel } from "@/lib/location-label";

export interface VehicleRouteSelection { start_location_id: string; end_location_id: string; }
interface WorkspaceVehicleSelectionProps {
  vehicles: BusinessVehicle[];
  selectedVehicleIds: string[];
  vehicleRoutes: Record<string, VehicleRouteSelection>;
  locations: Array<{ id: string; display_name: string }>;
  invalidSelectedVehicleIds: string[];
  onSelectedVehicleIdsChange: (vehicleIds: string[]) => void;
  onVehicleRoutesChange: (vehicleRoutes: Record<string, VehicleRouteSelection>) => void;
}

export function WorkspaceVehicleSelection({ vehicles, selectedVehicleIds, vehicleRoutes, locations, invalidSelectedVehicleIds, onSelectedVehicleIdsChange, onVehicleRoutesChange }: WorkspaceVehicleSelectionProps) {
  const [query, setQuery] = useState("");
  const activeVehicles = useMemo(() => vehicles.filter((vehicle) => vehicle.active), [vehicles]);
  const visibleVehicles = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("hr-HR");
    return normalized ? activeVehicles.filter((vehicle) => `${vehicle.id} ${vehicle.display_name} ${vehicle.registration_number}`.toLocaleLowerCase("hr-HR").includes(normalized)) : activeVehicles;
  }, [activeVehicles, query]);
  const selected = activeVehicles.filter((vehicle) => selectedVehicleIds.includes(vehicle.id));

  function toggle(vehicleId: string): void {
    onSelectedVehicleIdsChange(selectedVehicleIds.includes(vehicleId) ? selectedVehicleIds.filter((id) => id !== vehicleId) : [...selectedVehicleIds, vehicleId]);
  }
  function updateRoute(vehicleId: string, update: Partial<VehicleRouteSelection>): void {
    const fallback = locations[0]?.id ?? "";
    const current = vehicleRoutes[vehicleId] ?? { start_location_id: fallback, end_location_id: fallback };
    onVehicleRoutesChange({ ...vehicleRoutes, [vehicleId]: { ...current, ...update } });
  }

  return <section className="scenario-selection planner-section" aria-label="Odabir vozila radnog prostora">
    <header className="planner-section__heading"><div><p className="eyebrow">1 · VOZILA</p><h2>Radna flota</h2><p>Odaberite aktivna vozila. Početak i završetak rute primjenjuju se samo na ovaj plan.</p></div><strong>{selected.length} / {activeVehicles.length} odabrano</strong></header>
    {invalidSelectedVehicleIds.length > 0 && <p className="notice notice--warning" role="alert">Odabir sadrži neaktivno ili obrisano vozilo: {invalidSelectedVehicleIds.join(", ")}. Uklonite ga prije optimizacije.</p>}
    {activeVehicles.length === 0 ? <p className="notice" role="status">Nema aktivnih vozila. Aktivirajte barem jedno vozilo u Floti.</p> : <div className="planner-choice-grid">
      <fieldset className="planner-choice-list"><legend>Aktivna vozila iz Flote</legend><div className="selection-tools"><label>Pretraži vozila<input type="search" aria-label="Pretraži vozila" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, naziv ili registracija" /></label><button type="button" className="text-button" onClick={() => onSelectedVehicleIdsChange([...new Set([...selectedVehicleIds, ...activeVehicles.map((vehicle) => vehicle.id)])])}>Odaberi sva aktivna</button><button type="button" className="text-button" onClick={() => onSelectedVehicleIdsChange([])}>Očisti odabir</button></div><div className="planner-selectable-list">{visibleVehicles.map((vehicle) => <label className={selectedVehicleIds.includes(vehicle.id) ? "planner-selectable-row planner-selectable-row--selected" : "planner-selectable-row"} key={vehicle.id}><input type="checkbox" checked={selectedVehicleIds.includes(vehicle.id)} onChange={() => toggle(vehicle.id)} /><span><strong>{vehicle.display_name}</strong><small>{vehicle.id}{vehicle.registration_number ? ` · ${vehicle.registration_number}` : ""}</small></span><span>{vehicle.max_payload_kg.toLocaleString("hr-HR")} kg<small>najviše {vehicle.max_simultaneous_machines} stroja</small></span></label>)}</div>{visibleVehicles.length === 0 && <span className="muted">Nema vozila koja odgovaraju pretrazi.</span>}</fieldset>
      <aside className="planner-route-settings" aria-label="Postavke rute odabranih vozila"><p className="eyebrow">RUTE VOZILA</p>{selected.length === 0 ? <p>Odaberite vozilo za postavljanje polazišta i odredišta.</p> : selected.map((vehicle) => { const route = vehicleRoutes[vehicle.id] ?? { start_location_id: locations[0]?.id ?? "", end_location_id: locations[0]?.id ?? "" }; return <fieldset key={vehicle.id}><legend>{vehicle.display_name}</legend><label>Početna lokacija<select value={route.start_location_id} onChange={(event) => updateRoute(vehicle.id, { start_location_id: event.target.value })}>{locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, locations)}</option>)}</select></label><label>Završna lokacija<select value={route.end_location_id} onChange={(event) => updateRoute(vehicle.id, { end_location_id: event.target.value })}>{locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, locations)}</option>)}</select></label></fieldset>; })}</aside>
    </div>}
  </section>;
}
