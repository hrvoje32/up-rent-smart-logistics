"use client";

import { useMemo, useState } from "react";

import {
  SCENARIO_SCHEMA_VERSION, type MachineType, type OrderStatus, type PlanningScenario, type SavedRouteSnapshot, type ScenarioCollection, type ScenarioMachine, type ScenarioOrder, type ScenarioRecord, type ScenarioVehicle, type ScenarioLocation,
  deleteScenarioRecord, duplicateScenario, exportScenario, importScenario, resetScenarioFromCanonical, updateOptimizationSelection, upsertScenarioRecord,
} from "@/lib/planning-scenarios";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";
import { locationLabel } from "@/lib/location-label";

type Draft = Record<string, string>;
const collections: Array<{ value: ScenarioCollection; label: string }> = [
  { value: "vehicles", label: "Vozila" }, { value: "locations", label: "Lokacije" }, { value: "machine_types", label: "Vrste strojeva" }, { value: "machines", label: "Strojevi" }, { value: "orders", label: "Transportni nalozi" },
];

const fields: Record<ScenarioCollection, Array<[string, string, "text" | "number" | "boolean" | "status"]>> = {
  vehicles: [["id", "ID vozila", "text"], ["display_name", "Naziv", "text"], ["max_payload_kg", "Nosivost (kg)", "number"], ["max_simultaneous_machines", "Kapacitet strojeva", "number"], ["average_speed_kmh", "Prosječna brzina (km/h)", "number"], ["active", "Aktivno", "boolean"], ["registration_number", "Registracija (neobavezno)", "text"], ["description", "Opis (neobavezno)", "text"], ["notes", "Napomena (neobavezno)", "text"]],
  locations: [["id", "ID lokacije", "text"], ["display_name", "Naziv", "text"], ["x", "X koordinata", "number"], ["y", "Y koordinata", "number"], ["is_depot", "Baza", "boolean"]],
  machine_types: [["id", "ID vrste", "text"], ["name", "Naziv vrste", "text"], ["default_weight_kg", "Zadana masa (kg, neobavezno)", "number"], ["description", "Opis", "text"]],
  machines: [["id", "ID stroja", "text"], ["display_name", "Naziv", "text"], ["weight_kg", "Masa (kg)", "number"], ["machine_type_id", "ID vrste stroja (neobavezno)", "text"]],
  orders: [["id", "ID naloga", "text"], ["machine_id", "ID stroja", "text"], ["pickup_location_id", "Lokacija preuzimanja", "text"], ["delivery_location_id", "Lokacija isporuke", "text"], ["status", "Status", "status"], ["notes", "Napomena (neobavezno)", "text"]],
};

function emptyDraft(collection: ScenarioCollection): Draft { return Object.fromEntries(fields[collection].map(([key, , type]) => [key, key === "status" ? "PENDING" : type === "boolean" ? "true" : ""])); }
function asDraft(record: ScenarioRecord): Draft { return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value === null ? "" : String(value)])); }
function recordsFor(scenario: PlanningScenario, collection: ScenarioCollection): ScenarioRecord[] { return scenario[collection] as ScenarioRecord[]; }
function makeRecord(collection: ScenarioCollection, draft: Draft): ScenarioRecord {
  const number = (key: string): number => Number(draft[key]); const optional = (key: string): string | null => draft[key].trim() || null;
  switch (collection) {
    case "vehicles": return { id: draft.id, display_name: draft.display_name, max_payload_kg: number("max_payload_kg"), max_simultaneous_machines: number("max_simultaneous_machines"), average_speed_kmh: number("average_speed_kmh"), active: draft.active === "true", registration_number: draft.registration_number, description: draft.description, notes: draft.notes } satisfies ScenarioVehicle;
    case "locations": return { id: draft.id, display_name: draft.display_name, x: number("x"), y: number("y"), is_depot: draft.is_depot === "true" } satisfies ScenarioLocation;
    case "machine_types": return { id: draft.id, name: draft.name, default_weight_kg: draft.default_weight_kg.trim() ? number("default_weight_kg") : null, description: draft.description } satisfies MachineType;
    case "machines": return { id: draft.id, display_name: draft.display_name, weight_kg: number("weight_kg"), machine_type_id: optional("machine_type_id") } satisfies ScenarioMachine;
    case "orders": return { id: draft.id, machine_id: draft.machine_id, pickup_location_id: draft.pickup_location_id, delivery_location_id: draft.delivery_location_id, notes: draft.notes, status: draft.status as OrderStatus } satisfies ScenarioOrder;
  }
}

interface ScenarioManagerProps {
  canonical: DemoDataset;
  scenario: PlanningScenario;
  scenarios: PlanningScenario[];
  savedPlans: SavedRouteSnapshot[];
  result: OptimizationResult | null;
  onSelect: (id: string) => void;
  onSaveScenario: (scenario: PlanningScenario) => void;
  onCreateScenario: (scenario: PlanningScenario) => void;
  onDeleteScenario: (id: string) => void;
  onSavePlan: (plan: SavedRouteSnapshot) => void;
  onDeletePlan: (id: string) => void;
  onOpenPlan: (plan: SavedRouteSnapshot) => void;
  initialCollection?: ScenarioCollection;
  isolatedCollection?: ScenarioCollection;
  planningOnly?: boolean;
  hideVehicleSelection?: boolean;
  hideOrderSelection?: boolean;
}

export function ScenarioManager({ canonical, scenario, scenarios, savedPlans, result, onSelect, onSaveScenario, onCreateScenario, onDeleteScenario, onSavePlan, onDeletePlan, onOpenPlan, initialCollection = "vehicles", isolatedCollection, planningOnly = false, hideVehicleSelection = false, hideOrderSelection = false }: ScenarioManagerProps) {
  const visibleCollection = isolatedCollection ?? initialCollection;
  const [collection, setCollection] = useState<ScenarioCollection>(visibleCollection);
  const [draft, setDraft] = useState<Draft>(emptyDraft(visibleCollection));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [transfer, setTransfer] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"id" | "name">("id");
  const [statusFilter, setStatusFilter] = useState<"ALL" | OrderStatus>("ALL");
  const isOriginal = scenario.kind === "ORIGINAL";
  const visiblePlans = useMemo(() => savedPlans.filter((plan) => plan.scenario_id === scenario.id), [savedPlans, scenario.id]);
  const visibleRecords = useMemo(() => recordsFor(scenario, collection).filter((record) => {
    const matchesSearch = Object.values(record).some((value) => String(value ?? "").toLocaleLowerCase("hr-HR").includes(search.trim().toLocaleLowerCase("hr-HR")));
    const matchesStatus = collection !== "orders" || statusFilter === "ALL" || (record as ScenarioOrder).status === statusFilter;
    return matchesSearch && matchesStatus;
  }).sort((left, right) => {
    const leftText = sort === "id" ? left.id : String((left as { display_name?: string; name?: string }).display_name ?? (left as { name?: string }).name ?? left.id);
    const rightText = sort === "id" ? right.id : String((right as { display_name?: string; name?: string }).display_name ?? (right as { name?: string }).name ?? right.id);
    return leftText.localeCompare(rightText, "hr-HR", { numeric: true });
  }), [collection, scenario, search, sort, statusFilter]);

  function setCollectionAndReset(next: ScenarioCollection): void { if (isolatedCollection && !(isolatedCollection === "machines" && next === "machine_types")) return; setCollection(next); setDraft(emptyDraft(next)); setEditingId(null); setMessage(null); setSearch(""); setStatusFilter("ALL"); }
  function edit(record: ScenarioRecord): void { setDraft(asDraft(record)); setEditingId(record.id); setMessage(null); }
  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    try { onSaveScenario(upsertScenarioRecord(scenario, collection, makeRecord(collection, draft))); setDraft(emptyDraft(collection)); setEditingId(null); setMessage("Spremljeno."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Zapis nije moguće spremiti."); }
  }
  function remove(id: string): void {
    if (!window.confirm(`Obrisati ${id}? Radnju nije moguće poništiti.`)) return;
    try { onSaveScenario(deleteScenarioRecord(scenario, collection, id)); setMessage("Obrisano."); } catch (error) { setMessage(error instanceof Error ? error.message : "Zapis nije moguće obrisati."); }
  }
  function duplicate(): void { const name = window.prompt("Naziv kopiranog scenarija", `${scenario.name} kopija`); if (name) { try { onCreateScenario(duplicateScenario(scenario, name)); } catch (error) { setMessage(error instanceof Error ? error.message : "Scenarij nije moguće kopirati."); } } }
  function removeScenario(): void { if (window.confirm(`Obrisati scenarij „${scenario.name}”?`)) onDeleteScenario(scenario.id); }
  function savePlan(): void { if (!result) return; const name = window.prompt("Naziv spremljene rute", `${scenario.name} ruta`); if (name) onSavePlan({ schema_version: SCENARIO_SCHEMA_VERSION, id: crypto.randomUUID(), name, scenario_id: scenario.id, scenario_revision: scenario.revision, created_at: new Date().toISOString(), result }); }
  function importTransfer(): void { try { onCreateScenario(importScenario(transfer)); setTransfer(""); setMessage("Uvezen je novi prilagođeni scenarij."); } catch (error) { setMessage(error instanceof Error ? error.message : "Neispravan uvoz scenarija."); } }

  return <section className="scenario-manager" aria-labelledby="scenario-title">
    {!isolatedCollection && <><div className="scenario-manager__header"><div><p className="eyebrow">Scenariji planiranja · lokalna pohrana preglednika</p><h2 id="scenario-title">{scenario.name}</h2><p>{isOriginal ? "Izvorna procjena · nepromjenjivi kanonski izvor" : `Prilagođeni scenarij · revizija ${scenario.revision}`}</p></div><span className={isOriginal ? "pill" : "pill pill--success"}>{isOriginal ? "Samo za čitanje" : "Uredivo"}</span></div>
    <div className="scenario-toolbar"><label>Aktivni scenarij<select aria-label="Aktivni scenarij" value={scenario.id} onChange={(event) => onSelect(event.target.value)}>{scenarios.map((item) => <option key={item.id} value={item.id}>{item.name}{item.kind === "ORIGINAL" ? " (izvorni)" : ""}</option>)}</select></label><button type="button" className="secondary-button" onClick={() => { const name = window.prompt("Naziv novog prilagođenog scenarija", "Novi scenarij"); if (name) { try { onCreateScenario(duplicateScenario(createScenarioFromCanonical(canonical), name)); } catch (error) { setMessage(error instanceof Error ? error.message : "Scenarij nije moguće izraditi."); } } }}>Dodaj scenarij</button><button type="button" className="secondary-button" onClick={duplicate}>Dupliciraj</button>{!isOriginal && <><button type="button" className="secondary-button" onClick={() => onSaveScenario(resetScenarioFromCanonical(scenario, canonical))}>Vrati na izvorno</button><button type="button" className="danger-button" onClick={removeScenario}>Obriši scenarij</button></>}</div>
    <p className="scenario-manager__note">Prilagođeni podaci ostaju samo u ovom pregledniku. Koordinate su simulirane kartezijske vrijednosti, a ne GPS koordinate. Rokovi isporuke još nisu podržani.</p>
    {(!hideVehicleSelection || !hideOrderSelection) && <section className="scenario-selection" aria-label="Odabir za optimizaciju"><div><h3>Odabir za optimizaciju</h3><p>{hideVehicleSelection ? `Odabrano: ${scenario.selection.order_ids.length} naloga.` : `Odabrano: ${scenario.selection.vehicle_ids.length} vozila i ${scenario.selection.order_ids.length} naloga.`} Neodabrani zapisi nisu dio ovog izračuna.</p></div><div className="scenario-selection__lists">{!hideVehicleSelection && <fieldset disabled={isOriginal}><legend>Vozila</legend>{scenario.vehicles.map((vehicle) => <label key={vehicle.id}><input type="checkbox" checked={scenario.selection.vehicle_ids.includes(vehicle.id)} onChange={() => onSaveScenario(updateOptimizationSelection(scenario, { ...scenario.selection, vehicle_ids: scenario.selection.vehicle_ids.includes(vehicle.id) ? scenario.selection.vehicle_ids.filter((id) => id !== vehicle.id) : [...scenario.selection.vehicle_ids, vehicle.id] }))} />{vehicle.display_name} {!vehicle.active && "(neaktivno)"}</label>)}</fieldset>}{!hideOrderSelection && <fieldset disabled={isOriginal}><legend>Transportni nalozi</legend>{scenario.orders.map((order) => <label key={order.id}><input type="checkbox" checked={scenario.selection.order_ids.includes(order.id)} onChange={() => onSaveScenario(updateOptimizationSelection(scenario, { ...scenario.selection, order_ids: scenario.selection.order_ids.includes(order.id) ? scenario.selection.order_ids.filter((id) => id !== order.id) : [...scenario.selection.order_ids, order.id] }))} />{order.id} · {order.status === "PENDING" ? "Na čekanju" : order.status === "PLANNED" ? "Planiran" : order.status === "IN_PROGRESS" ? "U tijeku" : order.status === "COMPLETED" ? "Izvršen" : "Otkazan"}</label>)}</fieldset>}</div></section>}</>}
    {!isolatedCollection && !hideVehicleSelection && <section className="scenario-selection" aria-label="Postavke vožnje"><div><h3>Postavke vožnje</h3><p>Početak i završetak pripadaju ovom planu, a ne master zapisu vozila.</p></div><div className="scenario-selection__lists">{scenario.vehicles.filter((vehicle) => scenario.selection.vehicle_ids.includes(vehicle.id)).map((vehicle) => { const route = scenario.selection.vehicle_routes[vehicle.id]; return <fieldset key={vehicle.id} disabled={isOriginal}><legend>{vehicle.display_name}</legend><label>Početna lokacija<select value={route?.start_location_id ?? ""} onChange={(event) => onSaveScenario(updateOptimizationSelection(scenario, { ...scenario.selection, vehicle_routes: { ...scenario.selection.vehicle_routes, [vehicle.id]: { start_location_id: event.target.value, end_location_id: route?.end_location_id ?? event.target.value } } }))}>{scenario.locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, scenario.locations)}</option>)}</select></label><label>Završna lokacija<select value={route?.end_location_id ?? ""} onChange={(event) => onSaveScenario(updateOptimizationSelection(scenario, { ...scenario.selection, vehicle_routes: { ...scenario.selection.vehicle_routes, [vehicle.id]: { start_location_id: route?.start_location_id ?? event.target.value, end_location_id: event.target.value } } }))}>{scenario.locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, scenario.locations)}</option>)}</select></label></fieldset>; })}</div></section>}
    {message && <p className="notice notice--warning" role="status">{message}</p>}
    {isolatedCollection && <section className="management-record-toolbar" aria-label="Alati za upravljanje zapisima"><div><label htmlFor="record-search">Pretraži zapise</label><input id="record-search" type="search" placeholder="ID, naziv ili pojedinost" value={search} onChange={(event) => setSearch(event.target.value)} /></div><div><label htmlFor="record-sort">Poredaj prema</label><select id="record-sort" value={sort} onChange={(event) => setSort(event.target.value as "id" | "name")}><option value="id">ID-u</option><option value="name">nazivu</option></select></div>{collection === "orders" && <div><label htmlFor="status-filter">Status</label><select id="status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | OrderStatus)}><option value="ALL">Svi statusi</option><option value="PENDING">Na čekanju</option><option value="PLANNED">Planiran</option><option value="IN_PROGRESS">U tijeku</option><option value="COMPLETED">Izvršen</option><option value="CANCELLED">Otkazan</option></select></div>}{isolatedCollection === "machines" && <div className="management-subtabs" role="tablist" aria-label="Strojevi i vrste"><button type="button" role="tab" aria-selected={collection === "machines"} className={collection === "machines" ? "scenario-tab scenario-tab--active" : "scenario-tab"} onClick={() => setCollectionAndReset("machines")}>Strojevi</button><button type="button" role="tab" aria-selected={collection === "machine_types"} className={collection === "machine_types" ? "scenario-tab scenario-tab--active" : "scenario-tab"} onClick={() => setCollectionAndReset("machine_types")}>Vrste strojeva</button></div>}</section>}
    {!isolatedCollection && !planningOnly && <div className="scenario-tabs" role="tablist" aria-label="Podaci scenarija">{collections.map((item) => <button key={item.value} type="button" role="tab" aria-selected={collection === item.value} className={collection === item.value ? "scenario-tab scenario-tab--active" : "scenario-tab"} onClick={() => setCollectionAndReset(item.value)}>{item.label} ({recordsFor(scenario, item.value).length})</button>)}<button type="button" role="tab" aria-selected={false} className="scenario-tab" onClick={() => setCollectionAndReset("orders")}>Spremljene rute ({visiblePlans.length})</button></div>}
    {!planningOnly && <div className="scenario-crud-grid"><section className="scenario-records"><div className="records-heading"><div><h3>{collections.find((item) => item.value === collection)?.label}</h3>{isolatedCollection && <p>{visibleRecords.length} od {recordsFor(scenario, collection).length} zapisa</p>}</div>{!isOriginal && <button type="button" className="primary-button" onClick={() => { setDraft(emptyDraft(collection)); setEditingId(null); setMessage(null); }}>Novi zapis</button>}</div><div className="table-wrap"><table><thead><tr><th>ID</th><th>Pojedinosti</th>{!isOriginal && <th>Radnje</th>}</tr></thead><tbody>{visibleRecords.map((record) => <tr key={record.id}><th scope="row">{record.id}</th><td>{Object.entries(record).filter(([key]) => key !== "id").map(([key, value]) => `${key.replaceAll("_", " ")}: ${value ?? "—"}`).join(" · ")}</td>{!isOriginal && <td><button type="button" className="table-button" onClick={() => edit(record)}>Prikaži / uredi</button><button type="button" className="table-button table-button--danger" onClick={() => remove(record.id)}>Obriši</button></td>}</tr>)}{visibleRecords.length === 0 && <tr><td colSpan={isOriginal ? 2 : 3}>{recordsFor(scenario, collection).length ? "Nema zapisa koji odgovaraju odabranim filtrima." : "Još nema zapisa."}</td></tr>}</tbody></table></div></section>
      {!isOriginal && <form className="scenario-form" onSubmit={submit}><h3>{editingId ? `Uredi ${editingId}` : `Dodaj ${collections.find((item) => item.value === collection)?.label.slice(0, -1)}`}</h3>{fields[collection].map(([key, label, type]) => <label key={key}>{label}{type === "boolean" ? <select value={draft[key] ?? "true"} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="true">Da</option><option value="false">Ne</option></select> : type === "status" ? <select value={draft[key] ?? "PENDING"} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}><option value="PENDING">Na čekanju</option><option value="PLANNED">Planiran</option><option value="IN_PROGRESS">U tijeku</option><option value="COMPLETED">Izvršen</option><option value="CANCELLED">Otkazan</option></select> : <input type={type} step={type === "number" ? "any" : undefined} value={draft[key] ?? ""} disabled={key === "id" && editingId !== null} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} />}</label>)}<div><button type="submit" className="primary-button">{editingId ? "Spremi promjene" : "Dodaj zapis"}</button>{editingId && <button type="button" className="secondary-button" onClick={() => { setDraft(emptyDraft(collection)); setEditingId(null); }}>Odustani</button>}</div></form>}</div>}
    {!isolatedCollection && <><section className="scenario-transfer"><h3>Uvoz / izvoz</h3><p>Izvoz koristi verzionirani JSON. Uvezeni se zapisi provjeravaju i uvijek postaju novi prilagođeni scenarij.</p><div><button type="button" className="secondary-button" onClick={() => setTransfer(exportScenario(scenario))}>Pripremi JSON za izvoz</button><button type="button" className="secondary-button" onClick={importTransfer}>Uvezi JSON</button></div><textarea aria-label="JSON za uvoz ili izvoz scenarija" value={transfer} onChange={(event) => setTransfer(event.target.value)} placeholder="Ovdje zalijepite verzionirani izvoz scenarija." rows={5} /></section>
    <section className="saved-routes"><div><h3>Spremljene rute</h3><p>Snimke čuvaju izlaz rješavača i reviziju izvornog scenarija. Promjena scenarija označava ih zastarjelima.</p></div><button type="button" className="secondary-button" disabled={!result} onClick={savePlan}>Spremi trenutačnu rutu</button>{visiblePlans.length === 0 ? <p className="muted">Nema spremljenih ruta za ovaj scenarij.</p> : <ul>{visiblePlans.map((plan) => { const stale = plan.scenario_revision !== scenario.revision; return <li key={plan.id}><strong>{plan.name}</strong><span>{new Date(plan.created_at).toLocaleString("hr-HR")} · {stale ? "Starija revizija scenarija" : "Trenutačna revizija"}</span><div><button type="button" className="table-button" onClick={() => onOpenPlan(plan)}>Otvori</button><button type="button" className="table-button table-button--danger" onClick={() => onDeletePlan(plan.id)}>Obriši</button></div></li>; })}</ul>}</section></>}
  </section>;
}

function createScenarioFromCanonical(canonical: DemoDataset): PlanningScenario {
  const timestamp = new Date().toISOString();
  return { schema_version: 3, id: "canonical-copy", name: "Kopija kanonskih podataka", kind: "CUSTOM", revision: 1, created_at: timestamp, updated_at: timestamp, vehicles: canonical.vehicles.map((vehicle) => ({ id: vehicle.id, display_name: `Kamion ${vehicle.id}`, max_payload_kg: vehicle.max_payload_kg, max_simultaneous_machines: vehicle.max_simultaneous_machines, average_speed_kmh: vehicle.average_speed_kmh, active: true, registration_number: "", description: "", notes: "" })), locations: canonical.locations.map((location) => ({ ...location, display_name: location.id, is_depot: location.id === canonical.parameters.depot_location_id })), machine_types: [], machines: canonical.machines.map((machine) => ({ ...machine, display_name: machine.id, machine_type_id: null })), orders: canonical.orders.map((order) => ({ ...order, notes: "", status: "PENDING" })), parameters: structuredClone(canonical.parameters), selection: { vehicle_ids: canonical.vehicles.map((vehicle) => vehicle.id), order_ids: canonical.orders.map((order) => order.id), vehicle_routes: Object.fromEntries(canonical.vehicles.map((vehicle) => [vehicle.id, { start_location_id: vehicle.start_location_id, end_location_id: vehicle.end_location_id }])) } };
}
