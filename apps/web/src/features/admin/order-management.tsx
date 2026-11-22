"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { DetailDrawer } from "@/features/admin/detail-drawer";
import { CatalogManagement } from "@/features/admin/catalog-management";
import {
  type BusinessLocation,
  type BusinessMachine,
  type BusinessOrder,
  type BusinessWorkspace,
  loadBusinessWorkspace,
  saveBusinessWorkspace,
} from "@/lib/business-workspace";
import { apiDateTimeToInput, orderScheduleToApi, type OrderScheduleDraft } from "@/lib/order-scheduling";
import { locationLabel } from "@/lib/location-label";
import type { DemoDataset } from "@/types/optimizer-api";

type OrderDraft = {
  id: string; machine_id: string; pickup_location_id: string; delivery_location_id: string;
  notes: string; status: BusinessOrder["status"];
} & OrderScheduleDraft;
type MachineDraft = { id: string; display_name: string; weight_kg: string; machine_type_id: string; description: string };
type LocationDraft = { id: string; display_name: string; x: string; y: string; is_depot: string };
type LocationTarget = "pickup_location_id" | "delivery_location_id";

const navigation = [["Nadzorna ploča", "/admin/dashboard"], ["Transportni nalozi", "/admin/orders"], ["Vozila", "/admin/vehicles"], ["Optimizacija ruta", "/admin/optimizer"]] as const;
const statuses: Array<[BusinessOrder["status"], string]> = [["PENDING", "Na čekanju"], ["PLANNED", "Planiran"], ["IN_PROGRESS", "U tijeku"], ["COMPLETED", "Izvršen"], ["CANCELLED", "Otkazan"]];

const emptyOrder = (): OrderDraft => ({ id: "", machine_id: "", pickup_location_id: "L0", delivery_location_id: "L0", notes: "", status: "PENDING", earliest_pickup_at: "", latest_pickup_at: "", earliest_delivery_at: "", delivery_deadline_at: "" });
const emptyMachine = (): MachineDraft => ({ id: "", display_name: "", weight_kg: "", machine_type_id: "", description: "" });
const emptyLocation = (): LocationDraft => ({ id: "", display_name: "", x: "", y: "", is_depot: "false" });
const asOrderDraft = (order: BusinessOrder): OrderDraft => ({ ...order, earliest_pickup_at: apiDateTimeToInput(order.earliest_pickup_at), latest_pickup_at: apiDateTimeToInput(order.latest_pickup_at), earliest_delivery_at: apiDateTimeToInput(order.earliest_delivery_at), delivery_deadline_at: apiDateTimeToInput(order.delivery_deadline_at) });
const statusLabel = (status: BusinessOrder["status"]): string => statuses.find(([value]) => value === status)?.[1] ?? status;
const statusClass = (status: BusinessOrder["status"]): string => status === "CANCELLED" ? "pill pill--cancelled" : status === "COMPLETED" ? "pill" : status === "IN_PROGRESS" ? "pill pill--warning" : "pill pill--success";
const machineLabel = (machine: BusinessMachine | undefined): string => machine ? `${machine.display_name} · ${machine.weight_kg.toLocaleString("hr-HR")} kg` : "Nedostupan stroj";
const dateLabel = (value: string | null): string => value ? new Intl.DateTimeFormat("hr-HR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zagreb" }).format(new Date(value)) : "Nije zadano";

export function OrderManagement({ dataset }: { dataset: DemoDataset }) {
  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [ready, setReady] = useState(false);
  const [draft, setDraft] = useState<OrderDraft>(emptyOrder);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [detail, setDetail] = useState<BusinessOrder | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<BusinessOrder | null>(null);
  const [actionMenuId, setActionMenuId] = useState<string | null>(null);
  const [machineDialog, setMachineDialog] = useState(false);
  const [locationTarget, setLocationTarget] = useState<LocationTarget | null>(null);
  const [machineDraft, setMachineDraft] = useState<MachineDraft>(emptyMachine);
  const [locationDraft, setLocationDraft] = useState<LocationDraft>(emptyLocation);
  const [query, setQuery] = useState("");
  const [machineQuery, setMachineQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | BusinessOrder["status"]>("ALL");
  const [sort, setSort] = useState<"id" | "status" | "pickup">("id");
  const [message, setMessage] = useState<string | null>(null);
  const [isCatalogOpen, setIsCatalogOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => { setWorkspace(loadBusinessWorkspace(window.localStorage, dataset)); setReady(true); }, 0);
    return () => window.clearTimeout(timer);
  }, [dataset]);
  useEffect(() => { if (ready && workspace) saveBusinessWorkspace(window.localStorage, workspace); }, [ready, workspace]);

  const allMachines = useMemo(() => workspace?.machines ?? [], [workspace]);
  const locations = workspace?.locations ?? [];
  const machines = useMemo(() => allMachines.filter((machine) => `${machine.id} ${machine.display_name}`.toLocaleLowerCase("hr-HR").includes(machineQuery.toLocaleLowerCase("hr-HR"))).sort((left, right) => left.display_name.localeCompare(right.display_name, "hr-HR")), [allMachines, machineQuery]);
  const visibleOrders = useMemo(() => (workspace?.orders ?? [])
    .filter((order) => (statusFilter === "ALL" || order.status === statusFilter) && `${order.id} ${order.machine_id} ${order.pickup_location_id} ${order.delivery_location_id}`.toLocaleLowerCase("hr-HR").includes(query.toLocaleLowerCase("hr-HR")))
    .sort((left, right) => sort === "status" ? statusLabel(left.status).localeCompare(statusLabel(right.status), "hr-HR") : sort === "pickup" ? left.pickup_location_id.localeCompare(right.pickup_location_id, "hr-HR", { numeric: true }) : left.id.localeCompare(right.id, "hr-HR", { numeric: true })), [query, sort, statusFilter, workspace]);

  function updateDraft<K extends keyof OrderDraft>(key: K, value: OrderDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
    setIsDirty(true);
  }
  function discardForm(): void { setDraft(emptyOrder()); setEditingId(null); setIsDirty(false); setIsFormOpen(false); }
  function requestCloseForm(): void { if (!isDirty || window.confirm("Odbaciti nespremljene promjene naloga?")) discardForm(); }
  function openCreate(): void { setDraft(emptyOrder()); setEditingId(null); setIsDirty(false); setMessage(null); setIsFormOpen(true); }
  function openEdit(order: BusinessOrder): void { setDraft(asOrderDraft(order)); setEditingId(order.id); setIsDirty(false); setDetail(null); setActionMenuId(null); setIsFormOpen(true); }

  function saveOrder(): boolean {
    try {
      if (!workspace) return false;
      if (!draft.id.trim() || !draft.machine_id || !draft.pickup_location_id || !draft.delivery_location_id) throw new Error("ID naloga, stroj, preuzimanje i isporuka su obavezni.");
      if (!workspace.machines.some((machine) => machine.id === draft.machine_id)) throw new Error("Odaberite postojeći stroj.");
      if (![draft.pickup_location_id, draft.delivery_location_id].every((id) => workspace.locations.some((location) => location.id === id))) throw new Error("Odaberite postojeće lokacije.");
      const order: BusinessOrder = { id: draft.id.trim(), machine_id: draft.machine_id, pickup_location_id: draft.pickup_location_id, delivery_location_id: draft.delivery_location_id, notes: draft.notes.trim(), status: draft.status, ...orderScheduleToApi(draft) };
      const exists = workspace.orders.some((item) => item.id === order.id);
      if (!editingId && exists) throw new Error(`Nalog s ID-om „${order.id}” već postoji.`);
      if (editingId && editingId !== order.id) throw new Error("ID postojećeg naloga nije moguće promijeniti.");
      setWorkspace({ ...workspace, orders: exists ? workspace.orders.map((item) => item.id === order.id ? order : item) : [...workspace.orders, order] });
      setMessage(exists ? "Nalog je ažuriran." : "Nalog je dodan.");
      discardForm();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Nalog nije moguće spremiti.");
      return false;
    }
  }
  function updateStatus(order: BusinessOrder, status: BusinessOrder["status"]): void {
    if (!workspace) return;
    const updated = { ...order, status };
    setWorkspace({ ...workspace, orders: workspace.orders.map((item) => item.id === order.id ? updated : item) });
    setDetail((current) => current?.id === order.id ? updated : current);
    setActionMenuId(null);
    setMessage(`Status naloga ${order.id} je ažuriran.`);
  }
  function removeOrder(): void {
    if (!workspace || !confirmDelete) return;
    setWorkspace({ ...workspace, orders: workspace.orders.filter((order) => order.id !== confirmDelete.id) });
    setConfirmDelete(null); setDetail(null); setActionMenuId(null); setMessage("Nalog je obrisan.");
  }
  function saveMachine(): void {
    try {
      if (!workspace) return;
      const weight = Number(machineDraft.weight_kg);
      if (!machineDraft.id.trim() || !machineDraft.display_name.trim() || !Number.isInteger(weight) || weight <= 0) throw new Error("ID, naziv i pozitivna cijela masa stroja su obavezni.");
      if (workspace.machines.some((machine) => machine.id === machineDraft.id.trim())) throw new Error("Stroj s tim ID-om već postoji.");
      const machine: BusinessMachine = { id: machineDraft.id.trim(), display_name: machineDraft.display_name.trim(), weight_kg: weight, machine_type_id: machineDraft.machine_type_id || null, description: machineDraft.description.trim() };
      setWorkspace({ ...workspace, machines: [...workspace.machines, machine] });
      updateDraft("machine_id", machine.id); setMachineDraft(emptyMachine()); setMachineDialog(false); setMessage("Stroj je dodan i odabran za nalog.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Stroj nije moguće spremiti."); }
  }
  function saveLocation(): void {
    try {
      if (!workspace || !locationTarget) return;
      const x = Number(locationDraft.x); const y = Number(locationDraft.y);
      if (!locationDraft.id.trim() || !locationDraft.display_name.trim() || !Number.isFinite(x) || !Number.isFinite(y)) throw new Error("ID, naziv i obje koordinate lokacije su obavezni.");
      if (workspace.locations.some((location) => location.id === locationDraft.id.trim())) throw new Error("Lokacija s tim ID-om već postoji.");
      const location: BusinessLocation = { id: locationDraft.id.trim(), display_name: locationDraft.display_name.trim(), x, y, is_depot: locationDraft.is_depot === "true", description: "" };
      setWorkspace({ ...workspace, locations: [...workspace.locations, location] });
      updateDraft(locationTarget, location.id); setLocationDraft(emptyLocation()); setLocationTarget(null); setMessage("Lokacija je dodana i odabrana za nalog.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Lokaciju nije moguće spremiti."); }
  }

  if (!workspace) return <main className="optimizer-shell"><section className="workspace"><section className="notice" role="status">Učitavanje transportnih naloga…</section></section></main>;

  const selectedMachine = allMachines.find((machine) => machine.id === draft.machine_id);
  const activeCount = workspace.orders.filter((order) => order.status !== "CANCELLED" && order.status !== "COMPLETED").length;
  const detailMachine = detail ? allMachines.find((machine) => machine.id === detail.machine_id) : undefined;

  return <main className="optimizer-shell">
    <aside className="sidebar" aria-label="Glavna navigacija"><div className="brand"><span>UP</span><div><strong>UP RENT</strong><small>Operacije</small></div></div><nav><p>Planiranje</p>{navigation.map(([label, href]) => <Link key={href} href={href} className={href === "/admin/orders" ? "nav-active" : ""}>{label}</Link>)}</nav></aside>
    <section className="workspace orders-workspace">
      <header className="topbar"><div><p className="eyebrow">OPERATIVNI PODACI</p><h1>Transportni nalozi</h1><p>Upravljajte radnim katalogom naloga prije odabira za optimizaciju ruta.</p></div><button type="button" className="primary-button" onClick={openCreate}>Dodaj nalog</button></header>
      {message && <p className="notice notice--warning" role="status">{message}</p>}
      <div className="catalog-management-action"><button type="button" className="secondary-button" onClick={() => setIsCatalogOpen(true)}>Upravljanje katalozima</button></div>
      <section className="order-overview" aria-label="Sažetak naloga"><article><span>Ukupno naloga</span><strong>{workspace.orders.length}</strong></article><article><span>Aktivni za planiranje</span><strong>{activeCount}</strong></article><article><span>Otkazani</span><strong>{workspace.orders.filter((order) => order.status === "CANCELLED").length}</strong></article></section>
      <section className="management-record-toolbar" aria-label="Pretraživanje i filtriranje naloga"><div><label htmlFor="order-search">Pretraži naloge</label><input id="order-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ID, stroj ili lokacija" /></div><div><label htmlFor="order-status-filter">Status</label><select id="order-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | BusinessOrder["status"])}><option value="ALL">Svi statusi</option>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div><label htmlFor="order-sort">Poredaj prema</label><select id="order-sort" value={sort} onChange={(event) => setSort(event.target.value as "id" | "status" | "pickup")}><option value="id">ID-u</option><option value="status">statusu</option><option value="pickup">preuzimanju</option></select></div></section>
      <section className="scenario-records order-records" aria-label="Tablica transportnih naloga"><div className="records-heading"><div><p className="eyebrow">RADNI KATALOG</p><h2>Transportni nalozi</h2><p>{visibleOrders.length} prikazanih naloga</p></div></div><div className="table-wrap"><table><thead><tr><th>Nalog</th><th>Stroj</th><th>Preuzimanje</th><th>Isporuka</th><th>Raspored</th><th>Status</th><th><span className="sr-only">Radnje</span></th></tr></thead><tbody>{visibleOrders.map((order) => {
        const machine = allMachines.find((item) => item.id === order.machine_id);
        return <tr key={order.id}><th scope="row"><strong>{order.id}</strong><small>{order.notes || "Bez operativne napomene"}</small></th><td><strong>{machine?.display_name ?? order.machine_id}</strong><small>{machine ? `${machine.weight_kg.toLocaleString("hr-HR")} kg · ${machine.id}` : "Referenca nije dostupna"}</small></td><td><strong>{order.pickup_location_id}</strong><small>{order.earliest_pickup_at ? `od ${dateLabel(order.earliest_pickup_at)}` : "Bez vremenskog prozora"}</small></td><td><strong>{order.delivery_location_id}</strong><small>{order.delivery_deadline_at ? `do ${dateLabel(order.delivery_deadline_at)}` : "Bez roka"}</small></td><td><small>{order.latest_pickup_at ? `Preuzimanje do ${dateLabel(order.latest_pickup_at)}` : "Nije ograničeno"}<br />{order.earliest_delivery_at ? `Isporuka od ${dateLabel(order.earliest_delivery_at)}` : ""}</small></td><td><span className={statusClass(order.status)}>{statusLabel(order.status)}</span></td><td className="order-actions"><button type="button" className="table-button" onClick={() => setDetail(order)}>Detalji</button><div className="action-menu" onKeyDown={(event) => { if (event.key === "Escape") setActionMenuId(null); }}><button type="button" className="table-button" aria-haspopup="menu" aria-expanded={actionMenuId === order.id} aria-label={`Radnje za nalog ${order.id}`} onClick={() => setActionMenuId((current) => current === order.id ? null : order.id)}>Radnje</button>{actionMenuId === order.id && <div className="action-menu__list" role="menu" aria-label={`Radnje za nalog ${order.id}`}><button type="button" role="menuitem" onClick={() => openEdit(order)}>Uredi</button>{order.status !== "CANCELLED" && <button type="button" role="menuitem" onClick={() => updateStatus(order, "CANCELLED")}>Otkaži nalog</button>}<button type="button" role="menuitem" className="action-menu__danger" onClick={() => { setConfirmDelete(order); setActionMenuId(null); }}>Obriši nalog</button></div>}</div></td></tr>;
      })}{visibleOrders.length === 0 && <tr><td colSpan={7}><div className="orders-empty"><strong>Nema naloga za odabrani prikaz.</strong><span>Promijenite pretragu ili filtre, odnosno dodajte novi nalog.</span></div></td></tr>}</tbody></table></div></section>
      <DetailDrawer open={detail !== null} onClose={() => setDetail(null)} title={detail?.id ?? "Detalji naloga"} description={detail ? `${statusLabel(detail.status)} · operativni status, ne potvrda fizičkog izvršenja` : undefined} footer={detail && <button type="button" className="primary-button" onClick={() => openEdit(detail)}>Uredi nalog</button>}>
        {detail && <dl className="drawer-details"><div><dt>Status</dt><dd>{statusLabel(detail.status)}</dd></div><div><dt>Stroj</dt><dd>{machineLabel(detailMachine)}</dd></div><div><dt>Preuzimanje</dt><dd>{detail.pickup_location_id}</dd></div><div><dt>Isporuka</dt><dd>{detail.delivery_location_id}</dd></div><div><dt>Najranije preuzimanje</dt><dd>{dateLabel(detail.earliest_pickup_at)}</dd></div><div><dt>Najkasnije preuzimanje</dt><dd>{dateLabel(detail.latest_pickup_at)}</dd></div><div><dt>Najranija isporuka</dt><dd>{dateLabel(detail.earliest_delivery_at)}</dd></div><div><dt>Rok isporuke</dt><dd>{dateLabel(detail.delivery_deadline_at)}</dd></div><div><dt>Napomena</dt><dd>{detail.notes || "Nema napomene."}</dd></div></dl>}
      </DetailDrawer>
      <DetailDrawer open={isFormOpen} onClose={requestCloseForm} title={editingId ? `Uredi nalog ${editingId}` : "Dodaj transportni nalog"} description="Promjene ostaju lokalne dok nalog ne odaberete u pojedinom planu." footer={<><button type="button" className="secondary-button" onClick={discardForm}>Odustani</button><button type="button" className="primary-button" onClick={saveOrder}>{editingId ? "Spremi promjene" : "Spremi nalog"}</button></>}>
        <form className="drawer-form order-drawer-form" onSubmit={(event) => { event.preventDefault(); saveOrder(); }}>
          <fieldset><legend>Osnovni podaci</legend><label>ID naloga<input value={draft.id} disabled={editingId !== null} onChange={(event) => updateDraft("id", event.target.value)} /></label><label>Operativni status<select value={draft.status} onChange={(event) => updateDraft("status", event.target.value as BusinessOrder["status"])}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="drawer-form__wide">Napomena<textarea value={draft.notes} onChange={(event) => updateDraft("notes", event.target.value)} rows={3} /></label></fieldset>
          <fieldset><legend>Stroj</legend><label className="drawer-form__wide">Pretraži katalog strojeva<input value={machineQuery} onChange={(event) => setMachineQuery(event.target.value)} placeholder="ID ili naziv stroja" /></label><label>Stroj<select value={draft.machine_id} onChange={(event) => updateDraft("machine_id", event.target.value)}><option value="">Odaberite stroj</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machineLabel(machine)}</option>)}</select></label><div className="selected-machine"><span>Odabrani stroj</span><strong>{selectedMachine ? machineLabel(selectedMachine) : "Nije odabran"}</strong></div><button type="button" className="secondary-button" onClick={() => setMachineDialog(true)}>Dodaj stroj</button></fieldset>
          <fieldset><legend>Preuzimanje</legend><label>Lokacija preuzimanja<select value={draft.pickup_location_id} onChange={(event) => updateDraft("pickup_location_id", event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, locations)}</option>)}</select></label><button type="button" className="secondary-button" onClick={() => setLocationTarget("pickup_location_id")}>Dodaj lokaciju</button><label>Najranije preuzimanje<input type="datetime-local" value={draft.earliest_pickup_at} onChange={(event) => updateDraft("earliest_pickup_at", event.target.value)} /></label><label>Najkasnije preuzimanje<input type="datetime-local" value={draft.latest_pickup_at} onChange={(event) => updateDraft("latest_pickup_at", event.target.value)} /></label></fieldset>
          <fieldset><legend>Isporuka</legend><label>Lokacija isporuke<select value={draft.delivery_location_id} onChange={(event) => updateDraft("delivery_location_id", event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{locationLabel(location, locations)}</option>)}</select></label><button type="button" className="secondary-button" onClick={() => setLocationTarget("delivery_location_id")}>Dodaj lokaciju</button><label>Najranija isporuka<input type="datetime-local" value={draft.earliest_delivery_at} onChange={(event) => updateDraft("earliest_delivery_at", event.target.value)} /></label><label>Rok isporuke<input type="datetime-local" value={draft.delivery_deadline_at} onChange={(event) => updateDraft("delivery_deadline_at", event.target.value)} /></label><p className="form-help drawer-form__wide">Vremena su opcionalna i tumače se u zoni Europe/Zagreb, u 24-satnom formatu.</p></fieldset>
        </form>
      </DetailDrawer>
      <DetailDrawer open={machineDialog} onClose={() => setMachineDialog(false)} title="Dodaj stroj" description="Novi stroj bit će odmah dostupan i odabran u otvorenom nalogu." footer={<button type="button" className="primary-button" onClick={saveMachine}>Spremi stroj</button>}><form className="drawer-form" onSubmit={(event) => { event.preventDefault(); saveMachine(); }}><fieldset><legend>Podaci o stroju</legend><label>ID stroja<input value={machineDraft.id} onChange={(event) => setMachineDraft({ ...machineDraft, id: event.target.value })} /></label><label>Naziv stroja<input value={machineDraft.display_name} onChange={(event) => setMachineDraft({ ...machineDraft, display_name: event.target.value })} /></label><label>Masa (kg)<input type="number" value={machineDraft.weight_kg} onChange={(event) => setMachineDraft({ ...machineDraft, weight_kg: event.target.value })} /></label><label>Vrsta stroja (neobavezno)<select value={machineDraft.machine_type_id} onChange={(event) => setMachineDraft({ ...machineDraft, machine_type_id: event.target.value })}><option value="">Nije odabrana</option>{workspace.machine_types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label></fieldset></form></DetailDrawer>
      <DetailDrawer open={locationTarget !== null} onClose={() => setLocationTarget(null)} title="Dodaj lokaciju" description="Nova lokacija bit će odmah odabrana u otvorenom nalogu." footer={<button type="button" className="primary-button" onClick={saveLocation}>Spremi lokaciju</button>}><form className="drawer-form" onSubmit={(event) => { event.preventDefault(); saveLocation(); }}><fieldset><legend>Podaci o lokaciji</legend><label>ID lokacije<input value={locationDraft.id} onChange={(event) => setLocationDraft({ ...locationDraft, id: event.target.value })} /></label><label>Naziv lokacije<input value={locationDraft.display_name} onChange={(event) => setLocationDraft({ ...locationDraft, display_name: event.target.value })} /></label><label>X koordinata<input type="number" step="any" value={locationDraft.x} onChange={(event) => setLocationDraft({ ...locationDraft, x: event.target.value })} /></label><label>Y koordinata<input type="number" step="any" value={locationDraft.y} onChange={(event) => setLocationDraft({ ...locationDraft, y: event.target.value })} /></label><label>Baza/depo<select value={locationDraft.is_depot} onChange={(event) => setLocationDraft({ ...locationDraft, is_depot: event.target.value })}><option value="false">Ne</option><option value="true">Da</option></select></label></fieldset></form></DetailDrawer>
      <DetailDrawer open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Obrisati nalog?" description={confirmDelete ? `Nalog ${confirmDelete.id} bit će trajno uklonjen iz radnog kataloga.` : undefined} footer={<><button type="button" className="secondary-button" onClick={() => setConfirmDelete(null)}>Odustani</button><button type="button" className="danger-button" onClick={removeOrder}>Obriši nalog</button></>}>Ovu radnju nije moguće poništiti. Za zadržavanje evidencije radije promijenite status u „Otkazan”.</DetailDrawer>
      <CatalogManagement open={isCatalogOpen} workspace={workspace} onClose={() => setIsCatalogOpen(false)} onWorkspaceChange={setWorkspace} />
    </section>
  </main>;
}
