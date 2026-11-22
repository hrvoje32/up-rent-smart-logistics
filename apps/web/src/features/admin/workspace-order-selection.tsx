"use client";

import { useMemo, useState } from "react";

import type { BusinessMachine, BusinessOrder } from "@/lib/business-workspace";

interface WorkspaceOrderSelectionProps { orders: BusinessOrder[]; machines: BusinessMachine[]; selectedOrderIds: string[]; invalidSelectedOrderIds: string[]; onSelectedOrderIdsChange: (orderIds: string[]) => void; }
const canPlan = (order: BusinessOrder): boolean => order.status === "PENDING" || order.status === "PLANNED";

export function WorkspaceOrderSelection({ orders, machines, selectedOrderIds, invalidSelectedOrderIds, onSelectedOrderIdsChange }: WorkspaceOrderSelectionProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "PLANNED">("ALL");
  const plannableOrders = useMemo(() => orders.filter(canPlan), [orders]);
  const visibleOrders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("hr-HR");
    return plannableOrders.filter((order) => {
      const matchesStatus = statusFilter === "ALL" || order.status === statusFilter;
      const matchesQuery = !normalized || `${order.id} ${order.machine_id} ${order.pickup_location_id} ${order.delivery_location_id}`.toLocaleLowerCase("hr-HR").includes(normalized);
      return matchesStatus && matchesQuery;
    });
  }, [plannableOrders, query, statusFilter]);
  const weights = useMemo(() => new Map(machines.map((machine) => [machine.id, machine.weight_kg])), [machines]);
  const selectedCount = selectedOrderIds.filter((id) => plannableOrders.some((order) => order.id === id)).length;
  function toggle(orderId: string): void { onSelectedOrderIdsChange(selectedOrderIds.includes(orderId) ? selectedOrderIds.filter((id) => id !== orderId) : [...selectedOrderIds, orderId]); }

  return <section className="scenario-selection planner-section" aria-label="Odabir naloga radnog prostora">
    <header className="planner-section__heading"><div><p className="eyebrow">2 · TRANSPORTNI NALOZI</p><h2>Nalozi za optimizaciju</h2><p>Prikazani su nalozi na čekanju ili planirani; otkazani i izvršeni ne ulaze u novi plan.</p></div><strong>{selectedCount} / {plannableOrders.length} odabrano</strong></header>
    {invalidSelectedOrderIds.length > 0 && <p className="notice notice--warning" role="alert">Odabir sadrži neplanabilan ili obrisan nalog: {invalidSelectedOrderIds.join(", ")}. Uklonite ga prije optimizacije.</p>}
    <fieldset className="planner-choice-list planner-order-list"><legend>Dostupni nalozi</legend><div className="selection-tools"><label>Pretraži naloge<input type="search" aria-label="Pretraži naloge" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nalog, stroj ili lokacija" /></label><label>Status naloga<select aria-label="Filtriraj prema statusu" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | "PENDING" | "PLANNED")}><option value="ALL">Svi dostupni statusi</option><option value="PENDING">Na čekanju</option><option value="PLANNED">Planirano</option></select></label><button type="button" className="text-button" onClick={() => onSelectedOrderIdsChange([...new Set([...selectedOrderIds, ...plannableOrders.map((order) => order.id)])])}>Odaberi sve dostupne</button><button type="button" className="text-button" onClick={() => onSelectedOrderIdsChange([])}>Očisti odabir</button></div><div className="planner-orders-head" aria-hidden="true"><span>Nalog</span><span>Stroj</span><span>Preuzimanje</span><span>Isporuka</span><span>Ograničenje</span></div><div className="planner-selectable-list">{visibleOrders.map((order) => <label className={selectedOrderIds.includes(order.id) ? "planner-selectable-row planner-selectable-row--selected planner-order-row" : "planner-selectable-row planner-order-row"} key={order.id}><input type="checkbox" checked={selectedOrderIds.includes(order.id)} onChange={() => toggle(order.id)} /><span><strong>{order.id}</strong><small>Odabrani nalog</small></span><span>{order.machine_id}<small>{weights.get(order.machine_id)?.toLocaleString("hr-HR") ?? "—"} kg</small></span><span>{order.pickup_location_id}</span><span>{order.delivery_location_id}</span><span>{order.delivery_deadline_at ? `Rok ${order.delivery_deadline_at}` : order.latest_pickup_at ? `Preuzimanje do ${order.latest_pickup_at}` : "Bez vremenskog ograničenja"}</span></label>)}</div>{plannableOrders.length === 0 ? <span className="muted">Nema naloga dostupnih za planiranje.</span> : visibleOrders.length === 0 ? <span className="muted">Nema naloga koji odgovaraju pretrazi.</span> : null}</fieldset>
  </section>;
}
