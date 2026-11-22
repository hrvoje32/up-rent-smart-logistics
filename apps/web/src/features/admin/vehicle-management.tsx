"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DetailDrawer } from "@/features/admin/detail-drawer";
import {
  type BusinessVehicle,
  type BusinessWorkspace,
  loadBusinessWorkspace,
  saveBusinessWorkspace,
} from "@/lib/business-workspace";
import type { DemoDataset } from "@/types/optimizer-api";

type VehicleDraft = Record<keyof BusinessVehicle, string>;

const navigation = [
  ["Nadzorna ploča", "/admin/dashboard"],
  ["Transportni nalozi", "/admin/orders"],
  ["Vozila", "/admin/vehicles"],
  ["Optimizacija ruta", "/admin/optimizer"],
] as const;

const emptyDraft = (): VehicleDraft => ({
  id: "", display_name: "", max_payload_kg: "", max_simultaneous_machines: "",
  average_speed_kmh: "60", active: "true", registration_number: "", description: "", notes: "",
});

const asDraft = (vehicle: BusinessVehicle): VehicleDraft => Object.fromEntries(
  Object.entries(vehicle).map(([key, value]) => [key, String(value)]),
) as VehicleDraft;

function toVehicle(draft: VehicleDraft): BusinessVehicle {
  const numeric = (key: "max_payload_kg" | "max_simultaneous_machines" | "average_speed_kmh"): number => Number(draft[key]);
  if (!draft.id.trim() || !draft.display_name.trim()) throw new Error("ID i naziv vozila su obavezni.");
  if (![numeric("max_payload_kg"), numeric("max_simultaneous_machines"), numeric("average_speed_kmh")].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("Nosivost, kapacitet strojeva i brzina moraju biti pozitivni cijeli brojevi.");
  }
  return {
    id: draft.id.trim(), display_name: draft.display_name.trim(),
    max_payload_kg: numeric("max_payload_kg"), max_simultaneous_machines: numeric("max_simultaneous_machines"),
    average_speed_kmh: numeric("average_speed_kmh"), active: draft.active === "true",
    registration_number: draft.registration_number.trim(), description: draft.description.trim(), notes: draft.notes.trim(),
  };
}

export function VehicleManagement({ dataset }: { dataset: DemoDataset }) {
  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [draft, setDraft] = useState<VehicleDraft>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [query, setQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [message, setMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<BusinessVehicle | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setWorkspace(loadBusinessWorkspace(window.localStorage, dataset));
      setReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [dataset]);

  useEffect(() => {
    if (ready && workspace) saveBusinessWorkspace(window.localStorage, workspace);
  }, [ready, workspace]);

  const vehicles = useMemo(() => (workspace?.vehicles ?? [])
    .filter((vehicle) => (activeFilter === "ALL" || (activeFilter === "ACTIVE" ? vehicle.active : !vehicle.active))
      && `${vehicle.id} ${vehicle.display_name} ${vehicle.registration_number}`.toLocaleLowerCase("hr-HR").includes(query.toLocaleLowerCase("hr-HR")))
    .sort((left, right) => left.display_name.localeCompare(right.display_name, "hr-HR")), [workspace, query, activeFilter]);

  function updateDraft(key: keyof VehicleDraft, value: string): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }

  function openCreate(): void {
    setEditingId(null); setDraft(emptyDraft()); setIsDirty(false); setMessage(null); setIsFormOpen(true);
  }

  function openEdit(vehicle: BusinessVehicle): void {
    setEditingId(vehicle.id); setDraft(asDraft(vehicle)); setIsDirty(false); setDetail(null); setIsFormOpen(true);
  }

  function discardForm(): void {
    setIsFormOpen(false); setEditingId(null); setDraft(emptyDraft()); setIsDirty(false);
  }

  function requestCloseForm(): void {
    if (!isDirty || window.confirm("Odbaciti nespremljene izmjene vozila?")) discardForm();
  }

  function save(): boolean {
    try {
      if (!workspace) return false;
      const vehicle = toVehicle(draft);
      const exists = workspace.vehicles.some((item) => item.id === vehicle.id);
      if (!editingId && exists) throw new Error(`Vozilo s ID-om „${vehicle.id}” već postoji.`);
      if (editingId && editingId !== vehicle.id) throw new Error("ID postojećeg vozila nije moguće promijeniti.");
      setWorkspace({
        ...workspace,
        vehicles: exists ? workspace.vehicles.map((item) => item.id === vehicle.id ? vehicle : item) : [...workspace.vehicles, vehicle],
      });
      setMessage(editingId ? "Vozilo je ažurirano." : "Vozilo je dodano.");
      discardForm();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Vozilo nije moguće spremiti.");
      return false;
    }
  }

  function toggleAvailability(vehicle: BusinessVehicle): void {
    if (!workspace) return;
    const updated = { ...vehicle, active: !vehicle.active };
    setWorkspace({ ...workspace, vehicles: workspace.vehicles.map((item) => item.id === vehicle.id ? updated : item) });
    setDetail((current) => current?.id === vehicle.id ? updated : current);
    setMessage(vehicle.active ? "Vozilo je deaktivirano." : "Vozilo je aktivirano.");
  }

  function remove(vehicle: BusinessVehicle): void {
    if (!workspace || !window.confirm(`Obrisati vozilo „${vehicle.display_name}”?`)) return;
    setWorkspace({ ...workspace, vehicles: workspace.vehicles.filter((item) => item.id !== vehicle.id) });
    setDetail(null);
    setMessage("Vozilo je obrisano.");
  }

  if (!workspace) return <main className="optimizer-shell"><section className="workspace"><section className="notice" role="status">Učitavanje vozila…</section></section></main>;

  const detailFooter = detail ? <>
    <button type="button" className="table-button table-button--danger" onClick={() => remove(detail)}>Obriši vozilo</button>
    <button type="button" className="secondary-button" onClick={() => toggleAvailability(detail)}>{detail.active ? "Deaktiviraj" : "Aktiviraj"}</button>
    <button type="button" className="primary-button" onClick={() => openEdit(detail)}>Uredi vozilo</button>
  </> : undefined;

  return <main className="optimizer-shell">
    <aside className="sidebar" aria-label="Glavna navigacija">
      <div className="brand"><span>UP</span><div><strong>UP RENT</strong><small>Operacije</small></div></div>
      <nav><p>Planiranje</p>{navigation.map(([label, href]) => <Link key={href} href={href} className={href === "/admin/vehicles" ? "nav-active" : ""}>{label}</Link>)}</nav>
    </aside>
    <section className="workspace fleet-workspace">
      <header className="topbar">
        <div><p className="eyebrow">FLOTA</p><h1>Vozila</h1><p>Pregledajte raspoloživost i kapacitet flote; podaci rute postavljaju se tek u pojedinom planu.</p></div>
        <button type="button" className="primary-button" onClick={openCreate}>Dodaj vozilo</button>
      </header>
      {message && <p className="notice notice--warning" role="status">{message}</p>}
      <section className="fleet-overview" aria-label="Sažetak flote">
        <article><span>Ukupno vozila</span><strong>{workspace.vehicles.length}</strong></article>
        <article><span>Aktivna vozila</span><strong>{workspace.vehicles.filter((item) => item.active).length}</strong></article>
        <article><span>Raspoloživa nosivost</span><strong>{workspace.vehicles.filter((item) => item.active).reduce((total, item) => total + item.max_payload_kg, 0).toLocaleString("hr-HR")} kg</strong></article>
      </section>
      <section className="management-record-toolbar" aria-label="Pretraživanje vozila">
        <div><label htmlFor="vehicle-search">Pretraži vozila</label><input id="vehicle-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, naziv ili registracija" /></div>
        <div><label htmlFor="vehicle-filter">Dostupnost</label><select id="vehicle-filter" value={activeFilter} onChange={(event) => setActiveFilter(event.target.value as "ALL" | "ACTIVE" | "INACTIVE")}><option value="ALL">Sva vozila</option><option value="ACTIVE">Aktivna</option><option value="INACTIVE">Neaktivna</option></select></div>
      </section>
      <section className="vehicle-card-grid" aria-label="Kartice vozila">
        {vehicles.map((vehicle) => <article className="vehicle-card" key={vehicle.id}>
          <header><div><p>{vehicle.id}</p><h2>{vehicle.display_name}</h2><span>{vehicle.registration_number || "Registracija nije unesena"}</span></div><span className={vehicle.active ? "pill pill--success" : "pill"}>{vehicle.active ? "Aktivno" : "Neaktivno"}</span></header>
          <dl><div><dt>Nosivost</dt><dd>{vehicle.max_payload_kg.toLocaleString("hr-HR")} kg</dd></div><div><dt>Kapacitet</dt><dd>{vehicle.max_simultaneous_machines} stroja</dd></div><div><dt>Brzina</dt><dd>{vehicle.average_speed_kmh} km/h</dd></div></dl>
          <footer><button type="button" className="secondary-button" onClick={() => setDetail(vehicle)}>Detalji</button><button type="button" className="table-button" onClick={() => openEdit(vehicle)}>Uredi</button><button type="button" className="table-button" aria-label={`Promijeni dostupnost ${vehicle.display_name}`} onClick={() => toggleAvailability(vehicle)}>{vehicle.active ? "Deaktiviraj" : "Aktiviraj"}</button></footer>
        </article>)}
        {vehicles.length === 0 && <div className="fleet-empty"><strong>Nema vozila za odabrani prikaz.</strong><span>Promijenite filter ili dodajte prvo vozilo u flotu.</span></div>}
      </section>
      <DetailDrawer open={detail !== null} onClose={() => setDetail(null)} title={detail?.display_name ?? "Detalji vozila"} description={detail ? `${detail.id} · ${detail.registration_number || "bez registracije"}` : undefined} footer={detailFooter}>
        {detail && <dl className="drawer-details"><div><dt>Nosivost</dt><dd>{detail.max_payload_kg.toLocaleString("hr-HR")} kg</dd></div><div><dt>Najviše strojeva</dt><dd>{detail.max_simultaneous_machines}</dd></div><div><dt>Prosječna brzina</dt><dd>{detail.average_speed_kmh} km/h</dd></div><div><dt>Opis</dt><dd>{detail.description || "Nema opisa."}</dd></div><div><dt>Napomena</dt><dd>{detail.notes || "Nema napomene."}</dd></div></dl>}
      </DetailDrawer>
      <DetailDrawer open={isFormOpen} onClose={requestCloseForm} title={editingId ? `Uredi ${editingId}` : "Dodaj vozilo"} description="Podaci vozila ostaju neovisni o pojedinim planovima ruta." footer={<><button type="button" className="secondary-button" onClick={discardForm}>Odustani</button><button type="button" className="primary-button" onClick={save}>{editingId ? "Spremi promjene" : "Spremi vozilo"}</button></>}>
        <form className="drawer-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <fieldset><legend>Identitet</legend><label>ID vozila<input value={draft.id} disabled={editingId !== null} onChange={(event) => updateDraft("id", event.target.value)} /></label><label>Naziv vozila<input value={draft.display_name} onChange={(event) => updateDraft("display_name", event.target.value)} /></label><label>Registracija<input value={draft.registration_number} onChange={(event) => updateDraft("registration_number", event.target.value)} /></label></fieldset>
          <fieldset><legend>Kapacitet i dostupnost</legend><label>Nosivost (kg)<input type="number" value={draft.max_payload_kg} onChange={(event) => updateDraft("max_payload_kg", event.target.value)} /></label><label>Najviše strojeva<input type="number" value={draft.max_simultaneous_machines} onChange={(event) => updateDraft("max_simultaneous_machines", event.target.value)} /></label><label>Prosječna brzina (km/h)<input type="number" value={draft.average_speed_kmh} onChange={(event) => updateDraft("average_speed_kmh", event.target.value)} /></label><label>Aktivno<select value={draft.active} onChange={(event) => updateDraft("active", event.target.value)}><option value="true">Da</option><option value="false">Ne</option></select></label></fieldset>
          <fieldset><legend>Dodatne informacije</legend><label>Opis<input value={draft.description} onChange={(event) => updateDraft("description", event.target.value)} /></label><label>Napomena<input value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} /></label></fieldset>
        </form>
      </DetailDrawer>
    </section>
  </main>;
}
