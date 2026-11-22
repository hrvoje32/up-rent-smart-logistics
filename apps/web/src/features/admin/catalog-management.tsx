"use client";

import { useMemo, useState } from "react";

import { DetailDrawer } from "@/features/admin/detail-drawer";
import type { BusinessLocation, BusinessMachine, BusinessWorkspace } from "@/lib/business-workspace";
import { locationLabel } from "@/lib/location-label";

type CatalogTab = "machines" | "locations";
type MachineDraft = { id: string; display_name: string; weight_kg: string; machine_type_id: string; description: string };
type LocationDraft = { id: string; display_name: string; x: string; y: string; is_depot: string; description: string };
type PendingDeletion = { kind: CatalogTab; id: string } | null;

const emptyMachine = (): MachineDraft => ({ id: "", display_name: "", weight_kg: "", machine_type_id: "", description: "" });
const emptyLocation = (): LocationDraft => ({ id: "", display_name: "", x: "", y: "", is_depot: "false", description: "" });

interface CatalogManagementProps {
  open: boolean;
  workspace: BusinessWorkspace;
  onClose: () => void;
  onWorkspaceChange: (workspace: BusinessWorkspace) => void;
}

export function CatalogManagement({ open, workspace, onClose, onWorkspaceChange }: CatalogManagementProps) {
  const [tab, setTab] = useState<CatalogTab>("machines");
  const [query, setQuery] = useState("");
  const [machineDraft, setMachineDraft] = useState<MachineDraft>(emptyMachine);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(emptyLocation);
  const [editingMachineId, setEditingMachineId] = useState<string | null>(null);
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editor, setEditor] = useState<CatalogTab | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion>(null);
  const [message, setMessage] = useState<string | null>(null);

  const normalizedQuery = query.trim().toLocaleLowerCase("hr-HR");
  const machines = useMemo(() => workspace.machines.filter((machine) => `${machine.id} ${machine.display_name}`.toLocaleLowerCase("hr-HR").includes(normalizedQuery)).sort((left, right) => left.display_name.localeCompare(right.display_name, "hr-HR") || left.id.localeCompare(right.id, "hr-HR")), [normalizedQuery, workspace.machines]);
  const locations = useMemo(() => workspace.locations.filter((location) => `${location.id} ${location.display_name}`.toLocaleLowerCase("hr-HR").includes(normalizedQuery)).sort((left, right) => locationLabel(left, workspace.locations).localeCompare(locationLabel(right, workspace.locations), "hr-HR") || left.id.localeCompare(right.id, "hr-HR")), [normalizedQuery, workspace.locations]);

  function openMachineEditor(machine?: BusinessMachine): void {
    setMessage(null);
    setEditingMachineId(machine?.id ?? null);
    setMachineDraft(machine ? { id: machine.id, display_name: machine.display_name, weight_kg: String(machine.weight_kg), machine_type_id: machine.machine_type_id ?? "", description: machine.description ?? "" } : emptyMachine());
    setEditor("machines");
  }
  function openLocationEditor(location?: BusinessLocation): void {
    setMessage(null);
    setEditingLocationId(location?.id ?? null);
    setLocationDraft(location ? { id: location.id, display_name: location.display_name, x: String(location.x), y: String(location.y), is_depot: String(location.is_depot), description: location.description } : emptyLocation());
    setEditor("locations");
  }
  function saveMachine(): void {
    const id = machineDraft.id.trim(); const weight = Number(machineDraft.weight_kg);
    if (!id || !machineDraft.display_name.trim() || !Number.isFinite(weight) || weight <= 0) { setMessage("ID, naziv i pozitivna masa stroja su obavezni."); return; }
    if (!editingMachineId && workspace.machines.some((machine) => machine.id === id)) { setMessage("Stroj s tim ID-om već postoji."); return; }
    const next: BusinessMachine = { id, display_name: machineDraft.display_name.trim(), weight_kg: weight, machine_type_id: machineDraft.machine_type_id || null, description: machineDraft.description.trim() };
    onWorkspaceChange({ ...workspace, machines: editingMachineId ? workspace.machines.map((machine) => machine.id === editingMachineId ? next : machine) : [...workspace.machines, next] });
    setEditor(null); setMessage(editingMachineId ? "Stroj je ažuriran." : "Stroj je dodan.");
  }
  function saveLocation(): void {
    const id = locationDraft.id.trim(); const x = Number(locationDraft.x); const y = Number(locationDraft.y);
    if (!id || !locationDraft.display_name.trim() || !Number.isFinite(x) || !Number.isFinite(y)) { setMessage("ID, naziv te konačne X i Y koordinate su obavezni."); return; }
    if (!editingLocationId && workspace.locations.some((location) => location.id === id)) { setMessage("Lokacija s tim ID-om već postoji."); return; }
    const next: BusinessLocation = { id, display_name: locationDraft.display_name.trim(), x, y, is_depot: locationDraft.is_depot === "true", description: locationDraft.description.trim() };
    onWorkspaceChange({ ...workspace, locations: editingLocationId ? workspace.locations.map((location) => location.id === editingLocationId ? next : location) : [...workspace.locations, next] });
    setEditor(null); setMessage(editingLocationId ? "Lokacija je ažurirana." : "Lokacija je dodana.");
  }
  function machineReferences(id: string): string[] { return workspace.orders.filter((order) => order.machine_id === id).map((order) => order.id); }
  function locationReferences(id: string): string[] {
    const orderIds = workspace.orders.filter((order) => order.pickup_location_id === id || order.delivery_location_id === id).map((order) => order.id);
    const draftIds = workspace.drafts.filter((draft) => Object.values(draft.vehicle_routes).some((route) => route.start_location_id === id || route.end_location_id === id)).map((draft) => draft.name);
    return [...orderIds.map((orderId) => `nalog ${orderId}`), ...draftIds.map((draftName) => `plan „${draftName}”`)];
  }
  function confirmDeletion(): void {
    if (!pendingDeletion) return;
    const references = pendingDeletion.kind === "machines" ? machineReferences(pendingDeletion.id) : locationReferences(pendingDeletion.id);
    if (references.length > 0) { setMessage(`${pendingDeletion.kind === "machines" ? "Stroj" : "Lokaciju"} ${pendingDeletion.id} nije moguće obrisati jer se koristi u: ${references.join(", ")}.`); setPendingDeletion(null); return; }
    onWorkspaceChange(pendingDeletion.kind === "machines" ? { ...workspace, machines: workspace.machines.filter((machine) => machine.id !== pendingDeletion.id) } : { ...workspace, locations: workspace.locations.filter((location) => location.id !== pendingDeletion.id) });
    setMessage(pendingDeletion.kind === "machines" ? "Stroj je obrisan." : "Lokacija je obrisana."); setPendingDeletion(null);
  }

  const deletionReferences = pendingDeletion ? pendingDeletion.kind === "machines" ? machineReferences(pendingDeletion.id) : locationReferences(pendingDeletion.id) : [];
  const pendingTitle = pendingDeletion?.kind === "machines" ? "Obrisati stroj?" : "Obrisati lokaciju?";
  return <>
    <DetailDrawer open={open} onClose={onClose} title="Upravljanje katalozima" description="Izmjene vrijede za buduće naloge i optimizacije; povijesni planovi ostaju nepromijenjeni.">
      <div className="catalog-manager">
        <div className="catalog-manager__tabs" role="tablist" aria-label="Katalozi"><button type="button" role="tab" aria-selected={tab === "machines"} className={tab === "machines" ? "catalog-manager__tab catalog-manager__tab--active" : "catalog-manager__tab"} onClick={() => setTab("machines")}>Strojevi ({workspace.machines.length})</button><button type="button" role="tab" aria-selected={tab === "locations"} className={tab === "locations" ? "catalog-manager__tab catalog-manager__tab--active" : "catalog-manager__tab"} onClick={() => setTab("locations")}>Lokacije ({workspace.locations.length})</button></div>
        {message && <p className="notice notice--warning" role="status">{message}</p>}
        <div className="catalog-manager__toolbar"><label>Pretraži<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tab === "machines" ? "ID ili naziv stroja" : "ID ili naziv lokacije"} /></label><button type="button" className="primary-button" onClick={() => tab === "machines" ? openMachineEditor() : openLocationEditor()}>{tab === "machines" ? "Dodaj stroj" : "Dodaj lokaciju"}</button></div>
        {tab === "machines" ? <ul className="catalog-manager__list">{machines.map((machine) => { const references = machineReferences(machine.id); return <li key={machine.id}><div><strong>{machine.display_name}</strong><small>{machine.id} · {machine.weight_kg.toLocaleString("hr-HR")} kg · {references.length} {references.length === 1 ? "nalog" : "naloga"}</small></div><div><button type="button" className="table-button" onClick={() => openMachineEditor(machine)}>Uredi</button><button type="button" className="table-button table-button--danger" onClick={() => setPendingDeletion({ kind: "machines", id: machine.id })}>Obriši</button></div></li>; })}{machines.length === 0 && <li className="catalog-manager__empty">Nema strojeva koji odgovaraju pretrazi.</li>}</ul> : <ul className="catalog-manager__list">{locations.map((location) => { const references = locationReferences(location.id); return <li key={location.id}><div><strong>{locationLabel(location, workspace.locations)}</strong><small>{location.id} · X {location.x} · Y {location.y}{location.is_depot ? " · baza/depo" : ""} · {references.length} poveznica</small></div><div><button type="button" className="table-button" onClick={() => openLocationEditor(location)}>Uredi</button><button type="button" className="table-button table-button--danger" onClick={() => setPendingDeletion({ kind: "locations", id: location.id })}>Obriši</button></div></li>; })}{locations.length === 0 && <li className="catalog-manager__empty">Nema lokacija koje odgovaraju pretrazi.</li>}</ul>}
      </div>
    </DetailDrawer>
    <DetailDrawer open={editor === "machines"} onClose={() => setEditor(null)} title={editingMachineId ? `Uredi stroj ${editingMachineId}` : "Dodaj stroj"} description={editingMachineId ? "ID stroja ostaje nepromijenjen radi povezanih naloga." : "Novi stroj bit će odmah dostupan u obrascu naloga."} footer={<><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Odustani</button><button type="button" className="primary-button" onClick={saveMachine}>Spremi stroj</button></>}><form className="drawer-form" onSubmit={(event) => { event.preventDefault(); saveMachine(); }}><fieldset><legend>Podaci o stroju</legend><label>ID stroja<input value={machineDraft.id} disabled={editingMachineId !== null} onChange={(event) => setMachineDraft((current) => ({ ...current, id: event.target.value }))} /></label><label>Naziv stroja<input value={machineDraft.display_name} onChange={(event) => setMachineDraft((current) => ({ ...current, display_name: event.target.value }))} /></label><label>Masa (kg)<input type="number" min="1" step="any" value={machineDraft.weight_kg} onChange={(event) => setMachineDraft((current) => ({ ...current, weight_kg: event.target.value }))} /></label><label>Opis<input value={machineDraft.description} onChange={(event) => setMachineDraft((current) => ({ ...current, description: event.target.value }))} /></label></fieldset></form></DetailDrawer>
    <DetailDrawer open={editor === "locations"} onClose={() => setEditor(null)} title={editingLocationId ? `Uredi lokaciju ${editingLocationId}` : "Dodaj lokaciju"} description={editingLocationId ? "ID lokacije ostaje nepromijenjen radi naloga i planova." : "Koordinate su sintetičke kartezijske vrijednosti, ne GPS."} footer={<><button type="button" className="secondary-button" onClick={() => setEditor(null)}>Odustani</button><button type="button" className="primary-button" onClick={saveLocation}>Spremi lokaciju</button></>}><form className="drawer-form" onSubmit={(event) => { event.preventDefault(); saveLocation(); }}><fieldset><legend>Podaci o lokaciji</legend><label>ID lokacije<input value={locationDraft.id} disabled={editingLocationId !== null} onChange={(event) => setLocationDraft((current) => ({ ...current, id: event.target.value }))} /></label><label>Naziv lokacije<input value={locationDraft.display_name} onChange={(event) => setLocationDraft((current) => ({ ...current, display_name: event.target.value }))} /></label><label>X koordinata<input type="number" step="any" value={locationDraft.x} onChange={(event) => setLocationDraft((current) => ({ ...current, x: event.target.value }))} /></label><label>Y koordinata<input type="number" step="any" value={locationDraft.y} onChange={(event) => setLocationDraft((current) => ({ ...current, y: event.target.value }))} /></label><label>Baza/depo<select value={locationDraft.is_depot} onChange={(event) => setLocationDraft((current) => ({ ...current, is_depot: event.target.value }))}><option value="false">Ne</option><option value="true">Da</option></select></label><label>Opis<input value={locationDraft.description} onChange={(event) => setLocationDraft((current) => ({ ...current, description: event.target.value }))} /></label></fieldset></form></DetailDrawer>
    <DetailDrawer open={pendingDeletion !== null} onClose={() => setPendingDeletion(null)} title={pendingTitle} description={pendingDeletion ? `Stabilni ID: ${pendingDeletion.id}` : undefined} footer={<><button type="button" className="secondary-button" onClick={() => setPendingDeletion(null)}>Odustani</button><button type="button" className="danger-button" disabled={deletionReferences.length > 0} onClick={confirmDeletion}>Obriši</button></>}>{deletionReferences.length > 0 ? <p>Brisanje nije sigurno jer zapis koriste: {deletionReferences.join(", ")}.</p> : <p>Zapis nema živih poveznica u nalozima ili planovima. Povijesne snimke se ne mijenjaju.</p>}</DetailDrawer>
  </>;
}
