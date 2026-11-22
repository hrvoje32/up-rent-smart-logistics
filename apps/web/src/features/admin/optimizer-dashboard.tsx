"use client";
/* eslint-disable @typescript-eslint/no-unused-vars -- compatibility callback keeps the route payload argument while the draft adapter receives its cloned route map. */

import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { distance, duration, plural } from "@/lib/format";
import { circuityScaleOptions, estimateRoadMetrics, formatCircuityFactor, DEFAULT_CIRCUITY_SCALE, type RoadDistanceEstimate } from "@/lib/road-distance-estimate";
import { buildSimulatedRouteTimeline, formatSimulatedTime } from "@/lib/route-timeline";
import { VehicleTransportReport } from "@/features/admin/vehicle-transport-report";
import { RouteMap } from "@/features/admin/route-map";
import { DetailDrawer } from "@/features/admin/detail-drawer";
import { WorkspaceVehicleSelection } from "@/features/admin/workspace-vehicle-selection";
import { WorkspaceOrderSelection } from "@/features/admin/workspace-order-selection";
import { statusLabel, t } from "@/lib/i18n";
import { createFailedOptimizationRun, createNewDraft, createOptimizationRun, createOriginalDraft, draftSnapshot, draftToDataset, duplicateDraft, loadBusinessWorkspace, saveBusinessWorkspace, updateDraft, type BusinessWorkspace, type OptimizationStrategy, type PlanningDraft } from "@/lib/business-workspace";
import { apiDateTimeToInput, serializeZagrebDateTime } from "@/lib/order-scheduling";
import { buildInfeasibilityWarnings } from "@/lib/infeasible-order-warnings";
import { downloadTransportPlanCsv } from "@/lib/plan-export";
import { OptimizationHistory, WorkspaceOptimizationHistory } from "@/features/admin/optimization-history";
import { ScenarioManager } from "@/features/admin/scenario-manager";
import { WorkspacePersistence } from "@/features/admin/workspace-persistence";
import { type VehicleRouteSelection } from "@/features/admin/workspace-vehicle-selection";
import { ORIGINAL_SCENARIO_ID, createOriginalScenario, loadCustomScenarios, loadSavedPlans, saveCustomScenarios, saveSavedPlans, scenarioToOptimizerDataset, type PlanningScenario, type SavedRouteSnapshot } from "@/lib/planning-scenarios";
import {
  parseOptimizationResult,
  type DemoDataset,
  type LoadSnapshot,
  type OptimizationResult,
  type RouteMetrics,
  type Vehicle,
  type VehicleRoute,
} from "@/types/optimizer-api";

interface OptimizerDashboardProps {
  dataset: DemoDataset | null;
  initialError: string | null;
}

type OptimizerView = "plan" | "results" | "history";
type ActivePlanSummary = {
  id: string;
  name: string;
  saved: boolean;
  original: boolean;
  vehicles: number;
  orders: number;
  planningStart: string | null;
  strategy: OptimizationStrategy;
  historyCount: number;
  drafts: Array<{ id: string; name: string }>;
};

export function OptimizerDashboard(props: OptimizerDashboardProps) {
  const [activeView, setActiveView] = useState<OptimizerView>("plan");
  const [activePlan, setActivePlan] = useState<ActivePlanSummary | null>(null);
  useEffect(() => {
    const receivePlan = (event: Event): void => setActivePlan((event as CustomEvent<typeof activePlan>).detail);
    window.addEventListener("up-rent-active-draft", receivePlan);
    return () => window.removeEventListener("up-rent-active-draft", receivePlan);
  }, []);
  function selectView(view: OptimizerView): void {
    setActiveView(view);
    if (view === "history") return;
    window.requestAnimationFrame(() => document.querySelector(view === "results" ? ".results" : ".draft-toolbar, .planning-empty")?.scrollIntoView?.({ behavior: "smooth", block: "start" }));
  }
  function sendPlanCommand(command: "SAVE" | "NEW" | "DUPLICATE" | "LOAD_ORIGINAL" | "DELETE" | "SWITCH", draftId?: string): void {
    window.dispatchEvent(new CustomEvent("up-rent-plan-command", { detail: { command, draftId } }));
  }
  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>): void {
    const views: OptimizerView[] = ["plan", "results", "history"];
    const current = views.indexOf(activeView);
    const target = event.key === "ArrowRight" ? views[(current + 1) % views.length] : event.key === "ArrowLeft" ? views[(current + views.length - 1) % views.length] : event.key === "Home" ? views[0] : event.key === "End" ? views[views.length - 1] : null;
    if (!target) return;
    event.preventDefault();
    selectView(target);
    window.requestAnimationFrame(() => document.getElementById(`optimizer-${target === "plan" ? "plan" : target}-tab`)?.focus());
  }
  return <div className="optimizer-view-shell">{props.dataset && <WorkspacePersistence dataset={props.dataset} />}
    <header className="optimizer-page-header">
      <div><p className="eyebrow">RADNI PROSTOR PLANIRANJA</p><h1>Optimizacija ruta</h1><p>Odaberite flotu i naloge, provjerite postavke te pregledajte provjereni raspored.</p></div>
      <section className="active-plan-card" aria-label="Aktivni plan">
        {activePlan ? <><div><p>AKTIVNI PLAN</p><strong title={activePlan.name}>{activePlan.name}</strong><small>{activePlan.original ? "Izvorna referenca · samo za čitanje" : activePlan.saved ? "Spremljen nacrt" : "Nespremljene promjene"}</small></div><dl><div><dt>ID plana</dt><dd>{activePlan.id}</dd></div><div><dt>Odabir</dt><dd>{activePlan.vehicles} vozila · {activePlan.orders} naloga</dd></div><div><dt>Strategija</dt><dd>{strategyName(activePlan.strategy)}</dd></div><div><dt>Početak</dt><dd>{activePlan.planningStart ?? "Nije zadan"}</dd></div></dl><div className="active-plan-card__actions"><label>Promijeni plan<select aria-label="Promijeni aktivni plan" value={activePlan.original ? "__original__" : activePlan.id} onChange={(event) => event.target.value === "__original__" ? sendPlanCommand("LOAD_ORIGINAL") : sendPlanCommand("SWITCH", event.target.value)}><option value="__original__">Originalni UP RENT zadatak</option>{activePlan.drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name}</option>)}</select></label>{!activePlan.original && <button type="button" className="primary-button" onClick={() => sendPlanCommand("SAVE")}>Spremi promjene</button>}<button type="button" className="secondary-button" onClick={() => sendPlanCommand("NEW")}>Novi plan</button><details className="plan-overflow"><summary>Više</summary><div><button type="button" onClick={() => sendPlanCommand("DUPLICATE")}>Dupliciraj</button><button type="button" onClick={() => sendPlanCommand("LOAD_ORIGINAL")}>Učitaj originalni zadatak</button>{!activePlan.original && <button type="button" className="danger-button" onClick={() => sendPlanCommand("DELETE")}>Izbriši aktivni plan</button>}</div></details></div></> : <><div><p>AKTIVNI PLAN</p><strong>Plan još nije odabran</strong><small>Izradite novi nacrt ili učitajte izvorni UP RENT zadatak.</small></div><div className="active-plan-card__actions"><button type="button" className="primary-button" onClick={() => sendPlanCommand("NEW")}>Novi plan</button><button type="button" className="secondary-button" onClick={() => sendPlanCommand("LOAD_ORIGINAL")}>Učitaj originalni zadatak</button></div></>}
      </section>
      <nav className="optimizer-view-tabs" aria-label="Radni prikaz optimizacije" role="tablist">
        <button id="optimizer-plan-tab" type="button" role="tab" aria-selected={activeView === "plan"} aria-controls="optimizer-plan-panel" className={activeView === "plan" ? "optimizer-view-tab optimizer-view-tab--active" : "optimizer-view-tab"} onClick={() => selectView("plan")} onKeyDown={onTabKeyDown}>Planiranje</button>
        <button id="optimizer-results-tab" type="button" role="tab" aria-selected={activeView === "results"} aria-controls="optimizer-plan-panel" className={activeView === "results" ? "optimizer-view-tab optimizer-view-tab--active" : "optimizer-view-tab"} onClick={() => selectView("results")} onKeyDown={onTabKeyDown}>Rezultati</button>
        <button id="optimizer-history-tab" type="button" role="tab" aria-selected={activeView === "history"} aria-controls="optimizer-history-panel" className={activeView === "history" ? "optimizer-view-tab optimizer-view-tab--active" : "optimizer-view-tab"} onClick={() => selectView("history")} onKeyDown={onTabKeyDown}>Povijest{activePlan?.historyCount ? ` (${activePlan.historyCount})` : ""}</button>
      </nav>
    </header>
    <div id="optimizer-plan-panel" role="tabpanel" aria-labelledby={activeView === "results" ? "optimizer-results-tab" : "optimizer-plan-tab"} hidden={activeView === "history"}><WorkspaceOptimizerDashboard {...props} activeView={activeView} onShowResults={() => selectView("results")} /></div>
    <section id="optimizer-history-panel" className="optimizer-history-panel" role="tabpanel" aria-labelledby="optimizer-history-tab" hidden={activeView !== "history"}>{props.dataset ? <WorkspaceOptimizationHistory dataset={props.dataset} refreshKey={null} /> : <OptimizationHistory runs={[]} onCreateDraft={() => undefined} onDelete={() => undefined} />}</section>
  </div>;
}

function WorkspaceOptimizerDashboard({ dataset, initialError, activeView, onShowResults }: OptimizerDashboardProps & { activeView: OptimizerView; onShowResults: () => void }) {
  const [workspace, setWorkspace] = useState<BusinessWorkspace | null>(null);
  const [activeDraft, setActiveDraft] = useState<PlanningDraft | null>(null);
  const [isCanonical, setIsCanonical] = useState(false);
  const [baseline, setBaseline] = useState("");
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState(initialError);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [circuityScale, setCircuityScale] = useState(DEFAULT_CIRCUITY_SCALE);
  useEffect(() => { window.dispatchEvent(new CustomEvent<ActivePlanSummary | null>("up-rent-active-draft", { detail: activeDraft ? { id: activeDraft.id, name: activeDraft.name, saved: isCanonical || JSON.stringify(activeDraft) === baseline, original: isCanonical, vehicles: activeDraft.vehicle_ids.length, orders: activeDraft.order_ids.length, planningStart: activeDraft.planning_start_at, strategy: activeDraft.optimization_strategy, historyCount: workspace?.runs.length ?? 0, drafts: [...(workspace?.drafts ?? []), ...(workspace?.drafts.some((draft) => draft.id === activeDraft.id) || isCanonical ? [] : [activeDraft])].map((draft) => ({ id: draft.id, name: draft.name })) } : null })); }, [activeDraft, baseline, isCanonical, workspace]);

  useEffect(() => {
    if (!dataset) return undefined;
    const timer = window.setTimeout(() => setWorkspace(loadBusinessWorkspace(window.localStorage, dataset)), 0);
    return () => window.clearTimeout(timer);
  }, [dataset]);
  useEffect(() => { if (workspace) saveBusinessWorkspace(window.localStorage, workspace); }, [workspace]);
  useEffect(() => {
    const syncWorkspace = (): void => { if (dataset) setWorkspace(loadBusinessWorkspace(window.localStorage, dataset)); };
    window.addEventListener("up-rent-workspace-changed", syncWorkspace);
    return () => window.removeEventListener("up-rent-workspace-changed", syncWorkspace);
  }, [dataset]);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent): void => { if (event.key === "Escape") setIsNavigationOpen(false); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, []);

  const isDirty = activeDraft !== null && !isCanonical && JSON.stringify(activeDraft) !== baseline;
  const activeDataset = useMemo(() => {
    try {
      if (!dataset || !activeDraft) return null;
      return isCanonical ? dataset : workspace ? draftToDataset(workspace, activeDraft, dataset.parameters) : null;
    } catch { return null; }
  }, [activeDraft, dataset, isCanonical, workspace]);
  const metricsByVehicle = useMemo(() => new Map(result?.validation_result?.route_metrics.map((metric) => [metric.vehicle_id, metric])), [result]);
  const planningInput = activeDraft ? apiDateTimeToInput(activeDraft.planning_start_at) : "";
  const vehicle_routes = activeDraft?.vehicle_routes ?? {};
  const routeStartTime = planningInput ? planningInput.slice(11) : "08:00";
  const routeStartDate = planningInput ? planningInput.slice(0, 10) : "2026-01-01";

  function activate(draft: PlanningDraft, canonical: boolean): void { setActiveDraft(structuredClone(draft)); setIsCanonical(canonical); setBaseline(JSON.stringify(draft)); setResult(null); setError(null); }
  function requestTransition(action: () => void): void { if (isDirty) setPendingAction(() => action); else action(); }
  function createDraft(): void { if (workspace) activate(createNewDraft(workspace), false); }
  function loadOriginal(): void { if (workspace && dataset) activate(createOriginalDraft(workspace, dataset), true); }
  function updateActive(update: Partial<Omit<PlanningDraft, "id" | "created_at">>): void { if (activeDraft && !isCanonical) { setActiveDraft(updateDraft(activeDraft, update)); setResult(null); } }
  function saveDraft(): boolean {
    if (!workspace || !activeDraft || isCanonical) return false;
    const name = activeDraft.name.trim();
    if (!name) { setError("Unesite naziv plana prije spremanja."); return false; }
    const saved = { ...activeDraft, name };
    setWorkspace({ ...workspace, drafts: workspace.drafts.some((draft) => draft.id === saved.id) ? workspace.drafts.map((draft) => draft.id === saved.id ? saved : draft) : [...workspace.drafts, saved] });
    setActiveDraft(saved); setBaseline(JSON.stringify(saved)); setError(null); return true;
  }
  function duplicateActive(): void { if (activeDraft) activate(duplicateDraft(activeDraft, `${activeDraft.name} kopija`), false); }
  function deleteActive(): void {
    if (!workspace || !activeDraft || isCanonical) return;
    const confirmedId = window.prompt(`Obrisati plan „${activeDraft.name}”?\nPlan ID: ${activeDraft.id}\nUpišite točan ID plana za potvrdu.`, "");
    if (confirmedId === null) return;
    if (confirmedId.trim() !== activeDraft.id) { setError("Brisanje nije potvrđeno: ID plana se ne podudara."); return; }
    const targetId = activeDraft.id;
    setWorkspace({ ...workspace, drafts: workspace.drafts.filter((draft) => draft.id !== targetId) });
    setActiveDraft(null); setBaseline(""); setResult(null); setError(null);
  }
  useEffect(() => {
    const receiveCommand = (event: Event): void => {
      const detail = (event as CustomEvent<{ command?: string; draftId?: string }>).detail;
      if (!detail) return;
      if (detail.command === "SAVE") { saveDraft(); return; }
      if (detail.command === "NEW") { requestTransition(createDraft); return; }
      if (detail.command === "DUPLICATE") { requestTransition(duplicateActive); return; }
      if (detail.command === "LOAD_ORIGINAL") { requestTransition(loadOriginal); return; }
      if (detail.command === "DELETE") { deleteActive(); return; }
      if (detail.command === "SWITCH" && workspace && detail.draftId) {
        const draft = workspace.drafts.find((item) => item.id === detail.draftId);
        if (draft) requestTransition(() => activate(draft, false));
      }
    };
    window.addEventListener("up-rent-plan-command", receiveCommand);
    return () => window.removeEventListener("up-rent-plan-command", receiveCommand);
  // Command handlers intentionally read the current plan state; subscriptions are refreshed with it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDraft, baseline, isCanonical, workspace]);
  function applyPlanningStart(value: string): void { try { updateActive({ planning_start_at: serializeZagrebDateTime(value) }); } catch (caught) { setError(caught instanceof Error ? caught.message : "Vrijeme početka nije ispravno."); } }
  async function optimize(): Promise<void> {
    if (isOptimizing) return;
    setIsOptimizing(true); setError(null); setResult(null);
    try {
      if (!activeDraft) throw new Error("Najprije izradite novi plan ili učitajte izvorni UP RENT zadatak.");
      if (!activeDataset) {
        if (workspace && dataset) persistFailedRun(activeDraft, draftSnapshot(workspace, activeDraft, dataset.parameters), "INVALID_INPUT", "Plan sadrži neispravan, obrisan ili nedostupan zapis. Provjerite odabir vozila, naloga i lokacija.");
        throw new Error("Plan sadrži neispravan, obrisan ili nedostupan zapis. Provjerite odabir vozila, naloga i lokacija.");
      }
      const response = await fetch("/api/optimizer", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ dataset: activeDataset, settings: { optimization_strategy: activeDraft.optimization_strategy, require_all_selected_vehicles: activeDraft.require_all_selected_vehicles } }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) { const apiError = payload as ApiError | null; throw new Error(typeof apiError?.error === "string" ? apiError.error : "Optimizator nije dostupan."); }
      const optimizationResult = parseOptimizationResult(payload);
      setResult(optimizationResult);
      onShowResults();
      if (workspace && activeDraft && activeDataset) {
        const run = createOptimizationRun(activeDraft, activeDataset, optimizationResult);
        const nextWorkspace = { ...workspace, runs: [...workspace.runs, run] };
        saveBusinessWorkspace(window.localStorage, nextWorkspace);
        setWorkspace(nextWorkspace);
        window.dispatchEvent(new Event("up-rent-workspace-changed"));
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Optimizator nije dostupan.";
      if (activeDraft && activeDataset) persistFailedRun(activeDraft, activeDataset, "TECHNICAL_ERROR", message);
      setError(message);
      onShowResults();
    }
    finally { setIsOptimizing(false); }
  }

  function persistFailedRun(draft: PlanningDraft, snapshot: DemoDataset, outcome: "INVALID_INPUT" | "TECHNICAL_ERROR", message: string): void {
    if (!workspace) return;
    const run = createFailedOptimizationRun(draft, snapshot, outcome, { message, affected_order_ids: [], constraint_details: [], corrective_guidance: outcome === "INVALID_INPUT" ? "Ispravite odabir ili reference u planu, zatim pokušajte ponovno." : "Provjerite dostupnost optimizacijskog servisa i ponovno pokrenite plan." });
    const nextWorkspace = { ...workspace, runs: [...workspace.runs, run] };
    saveBusinessWorkspace(window.localStorage, nextWorkspace);
    setWorkspace(nextWorkspace);
    window.dispatchEvent(new Event("up-rent-workspace-changed"));
  }

  const validation = result?.validation_result;
  return <main className="optimizer-shell"><button type="button" className="navigation-toggle" aria-expanded={isNavigationOpen} aria-controls="optimizer-navigation" onClick={() => setIsNavigationOpen((open) => !open)}>Izbornik</button><aside id="optimizer-navigation" className={isNavigationOpen ? "sidebar sidebar--open" : "sidebar"} aria-label="Glavna navigacija"><div className="brand"><span>UP</span><div><strong>UP RENT</strong><small>Operacije</small></div></div><nav><p>Planiranje</p><Link href="/admin/dashboard" onClick={() => setIsNavigationOpen(false)}>Nadzorna ploča</Link><Link href="/admin/orders" onClick={() => setIsNavigationOpen(false)}>Transportni nalozi</Link><Link href="/admin/vehicles" onClick={() => setIsNavigationOpen(false)}>Vozila</Link><Link href="/admin/optimizer" className="nav-active" onClick={() => setIsNavigationOpen(false)}>Optimizacija ruta</Link></nav></aside><section className="workspace"><header className="topbar"><div><p className="eyebrow">RADNI PROSTOR PLANIRANJA</p><h1>Optimizacija ruta</h1><p>{isCanonical ? "Učitana je zaštićena izvorna procjena UP RENT." : activeDraft ? "Odaberite flotu i naloge, zatim spremite ili pokrenite plan." : "Izradite novi radni plan ili učitajte izvorni UP RENT zadatak."}</p></div><div className="planning-controls"><button type="button" className="secondary-button" onClick={() => requestTransition(createDraft)}>Nova optimizacija</button><button type="button" className="secondary-button" onClick={() => requestTransition(loadOriginal)}>Učitaj originalni UP RENT zadatak</button>{activeDraft && <button type="button" className="primary-button" onClick={optimize} disabled={isOptimizing}>{isOptimizing ? "Optimiziranje…" : "Optimiziraj rute"}</button>}</div></header><p className="screen-reader-status" role="status" aria-live="polite">{isOptimizing ? "Optimizacija je u tijeku." : error ?? (result ? stateCopy(result) : "")}</p>{error && <section className="notice notice--error" role="alert"><strong>Plan nije moguće pokrenuti.</strong><span>{error}</span></section>}{!workspace ? <section className="notice" role="status">Učitavanje radnog prostora…</section> : !activeDraft ? <section className="planning-empty"><p className="eyebrow">POČETAK PLANIRANJA</p><h2>Izradite prvi radni plan</h2><p>Novi plan počinje bez odabranih vozila i naloga. Izvorni UP RENT zadatak uvijek ostaje dostupan kao zaštićena referenca.</p><div><button type="button" className="primary-button" onClick={createDraft}>Nova optimizacija</button><button type="button" className="secondary-button" onClick={loadOriginal}>Učitaj originalni UP RENT zadatak</button></div></section> : <><section className="draft-toolbar" aria-label="Upravljanje planom"><label>Naziv plana<input value={activeDraft.name} disabled={isCanonical} onChange={(event) => updateActive({ name: event.target.value })} /></label><span className={isCanonical ? "pill" : isDirty ? "pill pill--warning" : "pill pill--success"}>{isCanonical ? "Izvorna procjena" : isDirty ? "Nespremljene promjene" : "Spremljeno"}</span>{!isCanonical && <button type="button" className="secondary-button" onClick={saveDraft}>Spremi plan</button>}<button type="button" className="secondary-button" onClick={duplicateActive}>Dupliciraj plan</button>{!isCanonical && workspace.drafts.some((draft) => draft.id === activeDraft.id) && <button type="button" className="danger-button" onClick={deleteActive}>Obriši plan</button>}<label>Otvori spremljeni plan<select aria-label="Otvori spremljeni plan" value="" onChange={(event) => { const draft = workspace.drafts.find((item) => item.id === event.target.value); if (draft) requestTransition(() => activate(draft, false)); }}><option value="">Odaberite plan</option>{workspace.drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.name}</option>)}</select></label></section><section className="planning-start"><label htmlFor="planning-start">Početak planiranja (neobavezno)<input id="planning-start" type="datetime-local" value={planningInput} disabled={isCanonical} onChange={(event) => applyPlanningStart(event.target.value)} /></label><p>Neobavezno vrijeme koristi zonu Europe/Zagreb i prosljeđuje se rješavaču bez mijenjanja rokova naloga.</p></section>{!isCanonical && <WorkspaceVehicleSelection vehicles={workspace.vehicles} selectedVehicleIds={activeDraft.vehicle_ids} vehicleRoutes={activeDraft.vehicle_routes} locations={workspace.locations.map(({ id, display_name }) => ({ id, display_name }))} invalidSelectedVehicleIds={activeDraft.vehicle_ids.filter((id) => !workspace.vehicles.some((vehicle) => vehicle.id === id && vehicle.active))} onSelectedVehicleIdsChange={(vehicleIds) => updateActive({ vehicle_ids: vehicleIds })} onVehicleRoutesChange={(vehicleRoutes) => updateActive({ vehicle_routes })} />}{!isCanonical && <WorkspaceOrderSelection orders={workspace.orders} machines={workspace.machines} selectedOrderIds={activeDraft.order_ids} invalidSelectedOrderIds={activeDraft.order_ids.filter((id) => !workspace.orders.some((order) => order.id === id && (order.status === "PENDING" || order.status === "PLANNED")))} onSelectedOrderIdsChange={(orderIds) => updateActive({ order_ids: orderIds })} />}{isCanonical && <section className="notice"><strong>Izvorni UP RENT zadatak</strong><span>2 vozila · 10 naloga · L0 početak i završetak · bez vremenskih ograničenja.</span></section>}<section className="strategy-selector" aria-labelledby="strategy-title"><div><p className="eyebrow">NAČIN OPTIMIZACIJE</p><h2 id="strategy-title">Cilj plana</h2></div><div className="strategy-selector__cards">{strategyCards.map((strategy) => <button key={strategy.id} type="button" disabled={isCanonical} className={activeDraft.optimization_strategy === strategy.id ? "strategy-card strategy-card--selected" : "strategy-card"} aria-pressed={activeDraft.optimization_strategy === strategy.id} onClick={() => updateActive({ optimization_strategy: strategy.id })}><span aria-hidden="true">{strategy.icon}</span><strong>{strategy.title}</strong><small>{strategy.description}</small></button>)}</div><label className="strategy-selector__require"><input type="checkbox" disabled={isCanonical} checked={activeDraft.require_all_selected_vehicles} onChange={(event) => updateActive({ require_all_selected_vehicles: event.target.checked })} />Obavezno koristi sva odabrana vozila <small>Svako odabrano vozilo mora izvršiti barem jedan stvarni nalog.</small></label></section>{activeDataset && <section className="dataset-grid" aria-label="Sažetak trenutačnog plana"><article><span className="metric-label">Odabrana flota</span><strong>{activeDataset.vehicles.length} vozila</strong><small>{activeDataset.vehicles.map((vehicle) => `${vehicle.id}: ${vehicle.max_payload_kg} kg`).join(" · ")}</small></article><article><span className="metric-label">Odabrani nalozi</span><strong>{plural(activeDataset.orders.length, "order")}</strong><small>{activeDataset.orders.map((order) => order.id).join(" · ")}</small></article><article><span className="metric-label">Planiranje</span><strong>{activeDraft.optimization_strategy === "FASTEST_DELIVERY" ? "Najbrža dostava" : activeDraft.optimization_strategy === "BALANCED" ? "Optimizirana dostava" : "Ušteda kilometara"}</strong><small>{activeDraft.require_all_selected_vehicles ? "Sva odabrana vozila su obavezna" : "Vozilo može ostati u bazi"}</small></article></section>}{!activeDataset && !error && <section className="notice" role="status">Odaberite barem jedno aktivno vozilo i jedan nalog dostupan za planiranje.</section>}{result && <section className="results" aria-labelledby="results-title"><div className={`result-status result-status--${result.status.toLowerCase()}`}><div><p className="eyebrow">REZULTAT OPTIMIZACIJE</p><h2 id="results-title">{statusLabel(result.status)}</h2><p>{stateCopy(result)}</p></div><span>{plural(activeDataset?.orders.length ?? 0, "order")} odabrano · rješavač {result.solver_duration_seconds.toLocaleString("hr-HR", { maximumFractionDigits: 2 })} s</span></div>{activeDataset && <ResultSummary dataset={activeDataset} result={result} />}{activeDataset && <DistanceAnalysis dataset={activeDataset} result={result} circuityScale={circuityScale} onCircuityScaleChange={setCircuityScale} />}{(result.violations.length > 0 || validation?.violations.length || validation?.unserved_order_ids.length || result.diagnostic_message) && <section className="notice notice--warning"><h3>Dijagnostika</h3>{result.diagnostic_message && <p>{result.diagnostic_message}</p>}{[...result.violations, ...(validation?.violations ?? [])].map((violation, index) => <p key={`${violation.code}-${index}`}><strong>{violation.code}</strong>: {violation.description}</p>)}{validation?.unserved_order_ids.length ? <p>Neizvršeni nalozi: {validation.unserved_order_ids.join(", ")}</p> : null}</section>}{activeDataset && validation && <section className="route-grid">{activeDataset.vehicles.map((vehicle) => <RouteCard key={vehicle.id} dataset={activeDataset} vehicle={vehicle} route={result.plan?.routes.find((route) => route.vehicle_id === vehicle.id) ?? { vehicle_id: vehicle.id, stops: [] }} metric={metricsByVehicle.get(vehicle.id)} snapshots={validation.load_snapshots} startTime={routeStartTime} simulatedStartDate={routeStartDate} circuityScale={circuityScale} unservedOrderIds={validation.unserved_order_ids} />)}</section>}</section>}<DetailDrawer open={pendingAction !== null} onClose={() => setPendingAction(null)} title="Nespremljene promjene" description="Prije promjene aktivnog plana odlučite što učiniti s trenutačnim izmjenama." footer={<><button type="button" className="secondary-button" onClick={() => setPendingAction(null)}>Odustani</button><button type="button" className="secondary-button" onClick={() => { const action = pendingAction; setPendingAction(null); action?.(); }}>Odbaci promjene</button><button type="button" className="primary-button" onClick={() => { if (saveDraft()) { const action = pendingAction; setPendingAction(null); action?.(); } }}>Spremi i nastavi</button></>}>Promjene pripadaju samo trenutačnom planu. Drugi spremljeni planovi ostaju nepromijenjeni.</DetailDrawer></>}</section></main>;
}

type ApiError = { error?: unknown };
const strategyCards: Array<{ id: OptimizationStrategy; title: string; description: string; icon: string }> = [
  { id: "FASTEST_DELIVERY", title: "Najbrža dostava", description: "Prednost ima najraniji završetak cijele flote, uključujući čekanje i uslugu.", icon: "⚡" },
  { id: "BALANCED", title: "Optimizirana dostava", description: "Uravnotežuje završetak plana i ukupnu udaljenost bez prisilnog angažmana flote.", icon: "⚖" },
  { id: "DISTANCE_SAVINGS", title: "Ušteda kilometara", description: "Prednost ima manji ukupni broj kilometara; vozilo može ostati u bazi.", icon: "↘" },
];

function strategyName(strategy: OptimizationStrategy): string {
  return strategy === "FASTEST_DELIVERY" ? "Najbrža dostava" : strategy === "DISTANCE_SAVINGS" ? "Ušteda kilometara" : "Optimizirana dostava";
}

function actionLabel(action: "PICKUP" | "DELIVERY"): string {
  return action === "PICKUP" ? "Preuzimanje" : "Isporuka";
}

function stateCopy(result: OptimizationResult): string {
  if (result.status === "FEASIBLE" && result.validation_result?.is_valid && result.validation_result.is_complete) {
    return "Pronađen je valjan raspored; svi su nalozi neovisno provjereni i izvršeni.";
  }
  if (result.status === "INFEASIBLE") return "Nije moguće izvršiti sve naloge uz zadana ograničenja.";
  if (result.status === "NO_SOLUTION_FOUND") return "Rješenje nije pronađeno unutar zadanog vremena pretrage.";
  if (result.status === "VALIDATION_FAILED") return "Raspored nije prošao neovisnu provjeru.";
  return "Došlo je do pogreške pri izradi upotrebljivog rasporeda.";
}

function snapshotKey(vehicleId: string, stopIndex: number, actionIndex: number): string {
  return `${vehicleId}:${stopIndex}:${actionIndex}`;
}

function metricValue(value: number | undefined, isIdle: boolean, formatter: (value: number) => string): string {
  if (value !== undefined) return formatter(value);
  return isIdle ? formatter(0) : t.notReported;
}

function RouteCard({
  dataset,
  vehicle,
  route,
  metric,
  snapshots,
  startTime,
  simulatedStartDate,
  circuityScale,
  unservedOrderIds,
}: {
  dataset: DemoDataset;
  vehicle: Vehicle;
  route: VehicleRoute;
  metric: RouteMetrics | undefined;
  snapshots: LoadSnapshot[];
  startTime: string;
  simulatedStartDate: string;
  circuityScale: number;
  unservedOrderIds: string[];
}) {
  const orders = new Map(dataset.orders.map((order) => [order.id, order]));
  const machines = new Map(dataset.machines.map((machine) => [machine.id, machine]));
  const snapshotMap = new Map(snapshots.map((snapshot) => [snapshotKey(snapshot.vehicle_id, snapshot.stop_index, snapshot.action_index), snapshot]));
  const vehicleSnapshots = snapshots.filter((snapshot) => snapshot.vehicle_id === vehicle.id);
  const actionCount = route.stops.reduce((total, stop) => total + stop.actions.length, 0);
  const isIdle = actionCount === 0;
  const maxLoad = Math.max(0, ...vehicleSnapshots.map((snapshot) => snapshot.load_kg));
  const maxMachineCount = Math.max(0, ...vehicleSnapshots.map((snapshot) => snapshot.machine_count));
  const vehicleName = `Kamion ${vehicle.id}`;
  const timeline = buildSimulatedRouteTimeline({ dataset, route, snapshots, startTime });
  const timelineMatchesValidatedElapsed = metric === undefined || timeline.elapsedSeconds === metric.total_elapsed_seconds;

  return <article className="route-card" aria-label={`Raspored za ${vehicleName}`}>
    <div className="route-card__header">
      <div><p className="eyebrow">Vozilo</p><h3>{vehicleName}</h3></div>
      <span className={isIdle ? "pill" : "pill pill--success"}>{isIdle ? "Nije korišten" : t.active}</span>
    </div>
    {isIdle && <p className="route-card__idle">Nije korišten u ovom planu · ostaje u bazi {dataset.parameters.depot_location_id}.</p>}
    <dl className="route-metrics" aria-label={`Metrike rute za ${vehicleName}`}>
      <div><dt>Udaljenost rute</dt><dd>{metricValue(metric?.distance_tenths_km, isIdle, distance)}</dd></div>
      <div><dt>Izvršeni nalozi</dt><dd>{metricValue(metric?.completed_order_count, isIdle, (value) => plural(value, "order"))}</dd></div>
      <div><dt>Vrijeme vožnje</dt><dd>{metricValue(metric?.driving_time_seconds, isIdle, duration)}</dd></div>
      <div><dt>Preuzimanje / utovar</dt><dd>{metricValue(metric?.pickup_service_seconds, isIdle, duration)}</dd></div>
      <div><dt>Isporuka / istovar</dt><dd>{metricValue(metric?.delivery_service_seconds, isIdle, duration)}</dd></div>
      <div><dt>Ukupno vrijeme usluge</dt><dd>{metricValue(metric?.total_service_seconds, isIdle, duration)}</dd></div>
      <div><dt>Čekanje</dt><dd>{metricValue(metric?.waiting_time_seconds, isIdle, duration)}</dd></div>
      <div><dt>Ukupno planirano trajanje</dt><dd>{metricValue(metric?.total_elapsed_seconds, isIdle, duration)}</dd></div>
      <div><dt>Maksimalno opterećenje</dt><dd>{maxLoad} kg · {plural(maxMachineCount, "machine")}</dd></div>
    </dl>
    <details className="route-card__details">
      <summary>{isIdle ? "Stanje vozila" : "Detalji rute i vremenska crta"}</summary>
    {!isIdle && <div className="table-wrap"><table><caption className="sr-only">Radnje na ruti za {vehicleName}</caption><thead><tr><th>Red. br.</th><th>Lokacija</th><th>Radnja</th><th>Nalog / stroj</th><th>Masa</th><th>Teret nakon</th></tr></thead><tbody>
      {route.stops.map((stop, stopIndex) => stop.actions.length === 0 ? <tr key={`${stop.location_id}-${stopIndex}`}><td>{stopIndex + 1}</td><td>{stop.location_id}</td><td colSpan={4}><span className="muted">Putovanje / stajanje u bazi</span></td></tr> : stop.actions.map((action, actionIndex) => {
        const order = orders.get(action.order_id);
        const machine = order ? machines.get(order.machine_id) : undefined;
        const snapshot = snapshotMap.get(snapshotKey(vehicle.id, stopIndex, actionIndex));
        return <tr key={`${stop.location_id}-${stopIndex}-${actionIndex}-${action.order_id}`}><td>{stopIndex + 1}.{actionIndex + 1}</td><td>{stop.location_id}</td><td><span className={action.action_type === "PICKUP" ? "action action--pickup" : "action action--delivery"}>{actionLabel(action.action_type)}</span></td><td>{action.order_id}{machine ? ` · ${machine.id}` : ""}</td><td>{machine ? `${machine.weight_kg} kg` : "—"}</td><td>{snapshot ? `${snapshot.load_kg} kg · ${snapshot.machine_count}` : "—"}</td></tr>;
      }))}
    </tbody></table></div>}
    <section className="timeline" aria-label={`Simulirana planirana vremenska crta za ${vehicleName}`}>
      <div className="timeline__header"><div><p className="eyebrow">Simulirana planirana vremena</p><h4>{isIdle ? "Nema transportnih operacija" : "Kronološka vremenska crta rute"}</h4></div><span>Završetak: {formatSimulatedTime(timeline.completionSeconds)}</span></div>
      {isIdle ? <p className="timeline__idle">Ostaje u bazi {dataset.parameters.depot_location_id} · 0 km · 0 minuta rada.</p> : <div className="table-wrap"><table><caption className="sr-only">Simulirana planirana vremenska crta za {vehicleName}</caption><thead><tr><th>Stajanje</th><th>Lokacija</th><th>Putovanje</th><th>Dolazak</th><th>Radnja</th><th>Usluga</th><th>Polazak</th><th>Teret nakon</th></tr></thead><tbody>{timeline.stops.flatMap((stop) => stop.actions.length === 0 ? [<tr key={`${stop.sequence}-travel`}><td>{stop.sequence}</td><td>{stop.locationId}</td><td>{distance(stop.travelDistanceTenthsKm)} · {duration(stop.travelDurationSeconds)}</td><td>{formatSimulatedTime(stop.arrivalSeconds)}</td><td>Putovanje / baza</td><td>—</td><td>{formatSimulatedTime(stop.departureSeconds)}</td><td>—</td></tr>] : stop.actions.map((scheduledAction, actionIndex) => {
        const order = orders.get(scheduledAction.action.order_id);
        const machine = order ? machines.get(order.machine_id) : undefined;
        const snapshot = scheduledAction.loadSnapshot;
        return <tr key={`${stop.sequence}-${actionIndex}-${scheduledAction.action.order_id}`}><td>{stop.sequence}.{actionIndex + 1}</td><td>{stop.locationId}</td><td>{distance(stop.travelDistanceTenthsKm)} · {duration(stop.travelDurationSeconds)}</td><td>{formatSimulatedTime(stop.arrivalSeconds)}</td><td><span className={scheduledAction.action.action_type === "PICKUP" ? "action action--pickup" : "action action--delivery"}>{actionLabel(scheduledAction.action.action_type)}</span><br />{scheduledAction.action.order_id}{machine ? ` · ${machine.id}` : ""}</td><td>{formatSimulatedTime(scheduledAction.serviceStartSeconds)} – {formatSimulatedTime(scheduledAction.serviceFinishSeconds)}</td><td>{formatSimulatedTime(stop.departureSeconds)}</td><td>{snapshot ? `${snapshot.load_kg} kg · ${snapshot.machine_count}` : "—"}</td></tr>;
      }))}</tbody></table></div>}
      <p className={timelineMatchesValidatedElapsed ? "timeline__validation" : "timeline__validation timeline__validation--warning"}>Trajanje vremenske crte: {duration(timeline.elapsedSeconds)}{metric ? ` · provjereno ukupno trajanje: ${duration(metric.total_elapsed_seconds)}` : ""}{timelineMatchesValidatedElapsed ? " · odgovara provjerenom trajanju rute." : " · ne odgovara provjerenom trajanju rute."}</p>
    </section>
    <VehicleTransportReport vehicle={vehicle} route={route} metric={metric} snapshots={snapshots} timeline={timeline} simulatedStartDate={simulatedStartDate} circuityScale={circuityScale} unservedOrderIds={unservedOrderIds} />
    </details>
    <p className="route-card__footer">Kapacitet: {vehicle.max_payload_kg} kg · {plural(vehicle.max_simultaneous_machines, "machine")} · prosječno {vehicle.average_speed_kmh} km/h</p>
  </article>;
}

function ResultSummary({ dataset, result, simulatedStartTime }: { dataset: DemoDataset; result: OptimizationResult; simulatedStartTime?: string }) {
  const validation = result.validation_result;
  const warnings = buildInfeasibilityWarnings(dataset, result);
  const warningContent = (warnings.orders.length > 0 || warnings.global.length > 0) && <section className="infeasibility-warnings" aria-labelledby="infeasibility-warnings-title"><div><p className="eyebrow">PROVJERENA DIJAGNOSTIKA</p><h3 id="infeasibility-warnings-title">Upozorenja za neizvedive naloge</h3><p>Prikazani su samo odabrani nalozi za koje postoje provjerene činjenice. Globalna ograničenja nisu pripisana pojedinom nalogu bez dokaza.</p></div>{warnings.global.map((warning) => <details key={`${warning.kind}-${warning.title}`} open><summary>{warning.title}</summary><p>{warning.explanation}</p><p><strong>Preporučena radnja:</strong> {warning.correctiveAction}</p></details>)}{warnings.orders.map((warning) => <details key={warning.order.id} open><summary>{warning.order.id} · {warning.order.machine_id} · {warning.title}</summary><dl><div><dt>Masa stroja</dt><dd>{warning.machineWeightKg === null ? "Nije dostupno" : `${warning.machineWeightKg.toLocaleString("hr-HR")} kg`}</dd></div><div><dt>Lokacije</dt><dd>{warning.order.pickup_location_id} → {warning.order.delivery_location_id}</dd></div>{warning.order.delivery_deadline_at && <div><dt>Rok isporuke</dt><dd>{warning.order.delivery_deadline_at}</dd></div>}</dl><p>{warning.explanation}</p><p><strong>Preporučena radnja:</strong> {warning.correctiveAction}</p>{warning.violations.length > 0 && <ul>{warning.violations.map((violation, index) => <li key={`${violation.code}-${index}`}><strong>{violation.code}</strong>: {violation.description}</li>)}</ul>}</details>)}</section>;
  if (!validation) return warningContent;
  const metricsByVehicle = new Map(validation.route_metrics.map((metric) => [metric.vehicle_id, metric]));
  const totalCompletedOrders = Object.values(validation.completed_order_counts).reduce((total, count) => total + count, 0);

  const usedVehicles = validation.route_metrics.filter((metric) => metric.completed_order_count > 0 || metric.distance_tenths_km > 0).length;
  const fleetCompletionSeconds = Math.max(0, ...validation.route_metrics.map((metric) => metric.total_elapsed_seconds));
  const canExport = result.plan !== null && validation.is_valid && validation.is_complete;
  const configuredStartTime = /T(\d{2}:\d{2})/.exec(dataset.parameters.planning_start_at ?? "")?.[1] ?? "08:00";
  const exportStartTime = simulatedStartTime ?? configuredStartTime;
  return <>{warningContent}
    <section className="summary-grid summary-grid--results result-kpis" aria-label="Sažetak provjerenog plana">
      <article><span>Ukupna udaljenost ruta</span><strong>{distance(validation.combined_distance_tenths_km)}</strong></article>
      <article><span>Nalozi u izračunatim rutama</span><strong>{plural(totalCompletedOrders, "order")}</strong></article>
      <article><span>Korištena vozila</span><strong>{usedVehicles} / {dataset.vehicles.length}</strong></article>
      <article><span>Završetak flote</span><strong>{duration(fleetCompletionSeconds)}</strong><small>Najdulje provjereno trajanje pojedine rute.</small></article>
    </section>
    {canExport && <section className="result-actions" aria-label="Izvoz i ispis plana">
      <div className="result-actions__copy"><p className="eyebrow">PREDAJA I OPERATIVA</p><strong>Plan prijevoza je spreman za dijeljenje</strong><small>CSV sadrži provjeren redoslijed, simulirana vremena i teret nakon svake radnje.</small></div>
      <div className="result-actions__buttons"><button type="button" className="secondary-button result-actions__button result-actions__button--download" onClick={() => downloadTransportPlanCsv({ dataset, result, startTime: exportStartTime })}>Preuzmi CSV plan</button><button type="button" className="secondary-button result-actions__button" onClick={() => window.print()}>Ispis / spremi PDF</button></div>
    </section>}
    <PlanDecisionSummary dataset={dataset} result={result} metricsByVehicle={metricsByVehicle} />
    <RouteMap dataset={dataset} result={result} />
    <details className="result-statistics">
      <summary>Detaljna statistika</summary>
      <section className="summary-grid summary-grid--details" aria-label="Dodatne metrike provjerenog plana">
        <article><span>Ukupna udaljenost svih vozila</span><strong>{distance(validation.combined_distance_tenths_km)}</strong><small>Provjeren zbroj svih ruta.</small></article>
        {dataset.vehicles.map((vehicle) => <article key={vehicle.id}><span>Udaljenost kamiona {vehicle.id}</span><strong>{distance(metricsByVehicle.get(vehicle.id)?.distance_tenths_km ?? 0)}</strong></article>)}
        <article><span>Početna udaljenost</span><strong>{result.baseline_comparison ? distance(result.baseline_comparison.baseline_distance_tenths_km) : t.notReported}</strong></article>
        <article><span>Smanjenje udaljenosti</span><strong>{result.baseline_comparison ? `${result.baseline_comparison.distance_reduction_percentage.toLocaleString("hr-HR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : t.notReported}</strong></article>
        <article><span>Ukupno vrijeme vožnje</span><strong>{duration(validation.combined_driving_time_seconds)}</strong></article>
        <article><span>Ukupno preuzimanje</span><strong>{duration(validation.combined_pickup_service_seconds)}</strong></article>
        <article><span>Ukupno isporuka</span><strong>{duration(validation.combined_delivery_service_seconds)}</strong></article>
        <article><span>Ukupno čekanje</span><strong>{duration(validation.combined_waiting_time_seconds ?? 0)}</strong></article>
        <article><span>Ukupno vrijeme usluge</span><strong>{duration(validation.combined_total_service_seconds)}</strong></article>
        <article><span>Zbroj trajanja vozila</span><strong>{duration(validation.combined_total_elapsed_seconds)}</strong><small>Nije vrijeme završetka po satu kada kamioni rade istodobno.</small></article>
      </section>
    </details>
  </>;
}

function PlanDecisionSummary({ dataset, result, metricsByVehicle }: { dataset: DemoDataset; result: OptimizationResult; metricsByVehicle: Map<string, RouteMetrics> }) {
  const validation = result.validation_result;
  if (!validation || !result.plan) return null;
  const machinesById = new Map(dataset.machines.map((machine) => [machine.id, machine]));
  const constrainedAssignments = dataset.orders.flatMap((order) => {
    const machine = machinesById.get(order.machine_id);
    if (!machine) return [];
    const compatibleVehicles = dataset.vehicles.filter((vehicle) => vehicle.max_payload_kg >= machine.weight_kg && vehicle.max_simultaneous_machines >= 1);
    const assignedVehicle = result.plan?.routes.find((route) => route.stops.some((stop) => stop.actions.some((action) => action.order_id === order.id && action.action_type === "PICKUP")))?.vehicle_id;
    return compatibleVehicles.length === 1 && assignedVehicle === compatibleVehicles[0]?.id ? [{ order, machine, vehicle: compatibleVehicles[0] }] : [];
  });
  const activeVehicles = dataset.vehicles.filter((vehicle) => {
    const metric = metricsByVehicle.get(vehicle.id);
    return (metric?.completed_order_count ?? 0) > 0 || (metric?.distance_tenths_km ?? 0) > 0;
  });
  const idleVehicles = dataset.vehicles.filter((vehicle) => !activeVehicles.some((active) => active.id === vehicle.id));

  return <section className="plan-rationale" aria-labelledby="plan-rationale-title"><header className="plan-rationale__heading"><div><p className="eyebrow">OBJAŠNJENJE PLANA</p><h3 id="plan-rationale-title">Zašto je plan ovakav?</h3><p>Ovo su provjerene činjenice iz odabranih vozila, naloga i rezultata rješavača — nisu procjena stvarnog izvršenja.</p></div><span className="plan-rationale__badge">Provjereno</span></header><ul>{result.baseline_comparison && <li>Optimizirani plan ima <strong>{distance(result.baseline_comparison.distance_reduction_tenths_km)}</strong> manje od početne usporedne rute ({result.baseline_comparison.distance_reduction_percentage.toLocaleString("hr-HR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% uštede).</li>}{constrainedAssignments.map(({ order, machine, vehicle }) => <li key={order.id}>Nalog <strong>{order.id}</strong> ({machine.id} · {machine.weight_kg.toLocaleString("hr-HR")} kg) može prevesti samo <strong>Kamion {vehicle.id}</strong>, jer ostala odabrana vozila nemaju dovoljnu nosivost.</li>)}{activeVehicles.map((vehicle) => { const metric = metricsByVehicle.get(vehicle.id); return <li key={vehicle.id}>Kamion <strong>{vehicle.id}</strong> izvršava {plural(metric?.completed_order_count ?? 0, "order")} na provjerenoj ruti od <strong>{distance(metric?.distance_tenths_km ?? 0)}</strong>.</li>; })}{idleVehicles.map((vehicle) => <li key={vehicle.id}>Kamion <strong>{vehicle.id}</strong> ostaje u bazi: valjan plan ne zahtijeva njegovu transportnu radnju.</li>)}</ul></section>;
}

function DistanceAnalysis({ dataset, result, circuityScale, onCircuityScaleChange }: { dataset: DemoDataset; result: OptimizationResult; circuityScale: number; onCircuityScaleChange: (scale: number) => void }) {
  const validation = result.validation_result;
  if (!validation) return null;
  const metricsByVehicle = new Map(validation.route_metrics.map((metric) => [metric.vehicle_id, metric]));
  const estimateFor = (metric: RouteMetrics | undefined): RoadDistanceEstimate => estimateRoadMetrics({
    distance_tenths_km: metric?.distance_tenths_km ?? 0,
    driving_time_seconds: metric?.driving_time_seconds ?? 0,
    pickup_service_seconds: metric?.pickup_service_seconds ?? 0,
    delivery_service_seconds: metric?.delivery_service_seconds ?? 0,
  }, circuityScale);
  const vehicleRows = dataset.vehicles.map((vehicle) => ({ name: `Kamion ${vehicle.id}`, estimate: estimateFor(metricsByVehicle.get(vehicle.id)) }));
  const combinedEstimate = estimateRoadMetrics({
    distance_tenths_km: validation.combined_distance_tenths_km,
    driving_time_seconds: validation.combined_driving_time_seconds,
    pickup_service_seconds: validation.combined_pickup_service_seconds,
    delivery_service_seconds: validation.combined_delivery_service_seconds,
  }, circuityScale);
  const hasScenarioWarning = [...vehicleRows.map((row) => row.estimate), combinedEstimate].some((estimate) => estimate.exceedsOriginalDrivingLimit);

  return <details className="distance-analysis"><summary><span><strong>Analiza udaljenosti</strong><small>Referentna euklidska optimizacija · dodatna simulacija cestovne udaljenosti</small></span></summary><div className="distance-analysis__content">
    <div className="distance-analysis__controls"><label htmlFor="circuity-factor">Faktor zaobilaska<input id="circuity-factor" type="range" min="1" max="1.8" step="0.05" value={formatCircuityFactor(circuityScale)} onChange={(event) => onCircuityScaleChange(Math.round(Number(event.target.value) * 100))} /><select aria-label="Mogućnosti faktora zaobilaska" value={circuityScale} onChange={(event) => onCircuityScaleChange(Number(event.target.value))}>{circuityScaleOptions().map((scale) => <option key={scale} value={scale}>{formatCircuityFactor(scale)}×</option>)}</select></label><p>Procijenjena cestovna udaljenost (simulacija)</p></div>
    <p className="distance-analysis__explanation">Procijenjena cestovna udaljenost koristi podesivi faktor zaobilaska primijenjen na simuliranu zračnu udaljenost. Ne temelji se na stvarnim cestama, prometu ni GPS podacima.</p><p className="distance-analysis__explanation">Jedinstveni množitelj udaljenosti ne mijenja redoslijed ruta kada se minimizira samo udaljenost. Stvarno cestovno usmjeravanje može dati drukčiju optimalnu rutu.</p>
    <div className="table-wrap"><table><caption className="sr-only">Usporedba referentne euklidske i procijenjene cestovne udaljenosti</caption><thead><tr><th>Plan</th><th>Euklidska udaljenost</th><th>Procijenjena cestovna udaljenost</th><th>Izvorna vožnja</th><th>Procijenjena vožnja</th><th>Utovar</th><th>Istovar</th><th>Procijenjeno trajanje*</th></tr></thead><tbody>{[...vehicleRows, { name: "Ukupni plan", estimate: combinedEstimate }].map((row) => <tr key={row.name}><th scope="row">{row.name}</th><td>{distance(row.estimate.euclideanDistanceTenthsKm)}</td><td>{distance(row.estimate.estimatedDistanceTenthsKm)} <small>({formatCircuityFactor(circuityScale)}×)</small></td><td>{duration(row.estimate.originalDrivingSeconds)}</td><td>{duration(row.estimate.estimatedDrivingSeconds)}</td><td>{duration(row.estimate.pickupServiceSeconds)}</td><td>{duration(row.estimate.deliveryServiceSeconds)}</td><td>{duration(row.estimate.estimatedElapsedSeconds)}</td></tr>)}</tbody></table></div>
    <p className="distance-analysis__footnote">* Procijenjeno trajanje ne uključuje stanke i nije zakonski provjeren raspored vozača. Kronološka vremenska crta ostaje utemeljena na referentnoj euklidskoj simulaciji.</p>
    {hasScenarioWarning && <p className="notice notice--warning" role="status"><strong>Upozorenje za scenarij.</strong> Procijenjeno vrijeme vožnje premašuje izvorno ograničenje od 9 sati. Ova simulacija ne utvrđuje izvedivost ni usklađenost.</p>}
  </div></details>;
}

export function LegacyOptimizerDashboard({ dataset, initialError }: OptimizerDashboardProps) {
  const [result, setResult] = useState<OptimizationResult | null>(null);
  const [error, setError] = useState(initialError);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [simulatedStartTime, setSimulatedStartTime] = useState("08:00");
  const [simulatedStartDate, setSimulatedStartDate] = useState("2026-01-01");
  const [circuityScale, setCircuityScale] = useState(DEFAULT_CIRCUITY_SCALE);
  const originalScenario = useMemo(() => dataset ? createOriginalScenario(dataset) : null, [dataset]);
  const [customScenarios, setCustomScenarios] = useState<PlanningScenario[]>([]);
  const [savedPlans, setSavedPlans] = useState<SavedRouteSnapshot[]>([]);
  const [isStorageReady, setIsStorageReady] = useState(false);
  const [selectedScenarioId, setSelectedScenarioId] = useState(ORIGINAL_SCENARIO_ID);
  const [isNavigationOpen, setIsNavigationOpen] = useState(false);
  const [optimizationStrategy, setOptimizationStrategy] = useState<OptimizationStrategy>("DISTANCE_SAVINGS");
  const [requireAllSelectedVehicles, setRequireAllSelectedVehicles] = useState(false);
  const [businessWorkspace, setBusinessWorkspace] = useState<BusinessWorkspace | null>(null);
  const [selectedWorkspaceVehicleIds, setSelectedWorkspaceVehicleIds] = useState<string[]>([]);
  const [workspaceVehicleRoutes, setWorkspaceVehicleRoutes] = useState<Record<string, VehicleRouteSelection>>({});
  const [vehicleSelectionScenarioId, setVehicleSelectionScenarioId] = useState<string | null>(null);
  const [selectedWorkspaceOrderIds, setSelectedWorkspaceOrderIds] = useState<string[]>([]);
  const [orderSelectionScenarioId, setOrderSelectionScenarioId] = useState<string | null>(null);
  useEffect(() => {
    const storageTimer = window.setTimeout(() => {
      setCustomScenarios(loadCustomScenarios(window.localStorage));
      setSavedPlans(loadSavedPlans(window.localStorage));
      setIsStorageReady(true);
    }, 0);
    return () => window.clearTimeout(storageTimer);
  }, []);
  useEffect(() => {
    if (!dataset) return undefined;
    const workspaceTimer = window.setTimeout(() => setBusinessWorkspace(loadBusinessWorkspace(window.localStorage, dataset)), 0);
    return () => window.clearTimeout(workspaceTimer);
  }, [dataset]);
  useEffect(() => { if (isStorageReady) saveCustomScenarios(window.localStorage, customScenarios); }, [customScenarios, isStorageReady]);
  useEffect(() => { if (isStorageReady) saveSavedPlans(window.localStorage, savedPlans); }, [savedPlans, isStorageReady]);
  useEffect(() => { const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setIsNavigationOpen(false); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, []);
  const scenarios = useMemo(() => originalScenario ? [originalScenario, ...customScenarios] : customScenarios, [originalScenario, customScenarios]);
  const activeScenario = scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? originalScenario ?? null;
  const effectiveSelectedWorkspaceVehicleIds = useMemo(() => activeScenario && vehicleSelectionScenarioId !== activeScenario.id ? activeScenario.selection.vehicle_ids : selectedWorkspaceVehicleIds, [activeScenario, selectedWorkspaceVehicleIds, vehicleSelectionScenarioId]);
  const effectiveWorkspaceVehicleRoutes = useMemo(() => activeScenario && vehicleSelectionScenarioId !== activeScenario.id ? activeScenario.selection.vehicle_routes : workspaceVehicleRoutes, [activeScenario, vehicleSelectionScenarioId, workspaceVehicleRoutes]);
  const effectiveSelectedWorkspaceOrderIds = useMemo(() => activeScenario && orderSelectionScenarioId !== activeScenario.id ? activeScenario.selection.order_ids : selectedWorkspaceOrderIds, [activeScenario, orderSelectionScenarioId, selectedWorkspaceOrderIds]);
  const inactiveSelectedVehicleIds = useMemo(() => {
    if (!businessWorkspace) return [];
    const activeIds = new Set(businessWorkspace.vehicles.filter((vehicle) => vehicle.active).map((vehicle) => vehicle.id));
    return effectiveSelectedWorkspaceVehicleIds.filter((id) => !activeIds.has(id));
  }, [businessWorkspace, effectiveSelectedWorkspaceVehicleIds]);
  const invalidSelectedOrderIds = useMemo(() => {
    if (!businessWorkspace) return [];
    const plannableIds = new Set(businessWorkspace.orders.filter((order) => order.status === "PENDING" || order.status === "PLANNED").map((order) => order.id));
    return effectiveSelectedWorkspaceOrderIds.filter((id) => !plannableIds.has(id));
  }, [businessWorkspace, effectiveSelectedWorkspaceOrderIds]);
  const currentDataset = useMemo(() => {
    try {
      if (!activeScenario) return null;
      const scenarioDataset = scenarioToOptimizerDataset(activeScenario);
      if (!businessWorkspace) return scenarioDataset;
      if (inactiveSelectedVehicleIds.length > 0) throw new Error("Odabir sadrži neaktivno ili obrisano vozilo. Uklonite ga prije optimizacije.");
      if (invalidSelectedOrderIds.length > 0) throw new Error("Odabir sadrži neplanabilan ili obrisan nalog. Uklonite ga prije optimizacije.");
      const selectedIds = new Set(effectiveSelectedWorkspaceVehicleIds);
      const vehicles = businessWorkspace.vehicles.filter((vehicle) => vehicle.active && selectedIds.has(vehicle.id)).map((vehicle) => {
        const route = effectiveWorkspaceVehicleRoutes[vehicle.id] ?? { start_location_id: scenarioDataset.parameters.depot_location_id, end_location_id: scenarioDataset.parameters.depot_location_id };
        return { id: vehicle.id, max_payload_kg: vehicle.max_payload_kg, max_simultaneous_machines: vehicle.max_simultaneous_machines, average_speed_kmh: vehicle.average_speed_kmh, ...route };
      });
      if (vehicles.length === 0) throw new Error("Odaberite barem jedno aktivno vozilo prije optimizacije.");
      const selectedOrderIds = new Set(effectiveSelectedWorkspaceOrderIds);
      const orders = businessWorkspace.orders.filter((order) => selectedOrderIds.has(order.id) && (order.status === "PENDING" || order.status === "PLANNED")).map(({ id, machine_id, pickup_location_id, delivery_location_id, earliest_pickup_at, latest_pickup_at, earliest_delivery_at, delivery_deadline_at }) => ({ id, machine_id, pickup_location_id, delivery_location_id, earliest_pickup_at, latest_pickup_at, earliest_delivery_at, delivery_deadline_at }));
      if (orders.length === 0) throw new Error("Odaberite barem jedan nalog dostupan za planiranje.");
      return { ...scenarioDataset, vehicles, machines: businessWorkspace.machines.map(({ id, weight_kg }) => ({ id, weight_kg })), locations: businessWorkspace.locations.map(({ id, x, y }) => ({ id, x, y })), orders };
    } catch { return null; }
  }, [activeScenario, businessWorkspace, effectiveSelectedWorkspaceOrderIds, effectiveSelectedWorkspaceVehicleIds, effectiveWorkspaceVehicleRoutes, inactiveSelectedVehicleIds, invalidSelectedOrderIds]);
  const metricsByVehicle = useMemo(() => new Map(result?.validation_result?.route_metrics.map((metric) => [metric.vehicle_id, metric])), [result]);

  async function optimize(): Promise<void> {
    if (isOptimizing) return;
    setIsOptimizing(true); setError(null); setResult(null);
    try {
      if (inactiveSelectedVehicleIds.length > 0) throw new Error("Odabir sadrži neaktivno ili obrisano vozilo. Uklonite ga prije optimizacije.");
      if (invalidSelectedOrderIds.length > 0) throw new Error("Odabir sadrži neplanabilan ili obrisan nalog. Uklonite ga prije optimizacije.");
      if (!currentDataset) throw new Error("Odabrani scenarij nije spreman za optimizaciju. Aktivirajte vozilo i ispravite pogreške provjere.");
      const response = await fetch("/api/optimizer", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ dataset: currentDataset, settings: { optimization_strategy: optimizationStrategy, require_all_selected_vehicles: requireAllSelectedVehicles } }) });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const apiError = payload as ApiError | null;
        const message = typeof apiError?.error === "string" ? apiError.error : "Optimizator nije dostupan.";
        throw new Error(message);
      }
      setResult(parseOptimizationResult(payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Optimizator nije dostupan.");
    } finally { setIsOptimizing(false); }
  }

  const validation = result?.validation_result;
  function updateScenario(next: PlanningScenario): void { setCustomScenarios((items) => items.map((item) => item.id === next.id ? next : item)); setResult(null); }
  function createScenario(next: PlanningScenario): void { setCustomScenarios((items) => [...items, next]); setSelectedScenarioId(next.id); setResult(null); }
  function deleteScenario(id: string): void { setCustomScenarios((items) => items.filter((item) => item.id !== id)); setSelectedScenarioId(ORIGINAL_SCENARIO_ID); setResult(null); }
  return <main className="optimizer-shell">
    <button type="button" className="navigation-toggle" aria-expanded={isNavigationOpen} aria-controls="optimizer-navigation" onClick={() => setIsNavigationOpen((open) => !open)}>Izbornik</button>
    <aside id="optimizer-navigation" className={isNavigationOpen ? "sidebar sidebar--open" : "sidebar"} aria-label="Glavna navigacija"><div className="brand"><span>UP</span><div><strong>UP RENT</strong><small>Operacije</small></div></div><nav><p>Planiranje</p><Link href="/admin/dashboard" onClick={() => setIsNavigationOpen(false)}>Nadzorna ploča</Link><Link href="/admin/orders" onClick={() => setIsNavigationOpen(false)}>Transportni nalozi</Link><Link href="/admin/vehicles" onClick={() => setIsNavigationOpen(false)}>Vozila</Link><Link href="/admin/optimizer" className="nav-active" onClick={() => setIsNavigationOpen(false)}>Optimizacija ruta</Link></nav><p className="sidebar-note">Lokalno demonstracijsko okruženje</p></aside>
    <section className="workspace"><header className="topbar"><div><p className="eyebrow">Radni prostor planiranja</p><h1>Optimizacija ruta</h1><p>Valjano planiranje preuzimanja i isporuke za kanonsku demonstracijsku flotu UP RENT.</p></div><div className="planning-controls"><label htmlFor="simulated-start-date">Datum simulirane rute<input id="simulated-start-date" type="date" value={simulatedStartDate} onChange={(event) => setSimulatedStartDate(event.target.value)} /></label><label htmlFor="simulated-start-time">Početak simulirane rute<input id="simulated-start-time" type="time" value={simulatedStartTime} onChange={(event) => setSimulatedStartTime(event.target.value)} /></label><button type="button" className="secondary-button" onClick={() => window.print()}>Ispis / spremi PDF</button><button type="button" className="primary-button" onClick={optimize} disabled={isOptimizing || !dataset}>{isOptimizing ? "Optimiziranje…" : "Optimiziraj rute"}</button></div></header>
      <p className="screen-reader-status" role="status" aria-live="polite">{isOptimizing ? "Optimizacija je u tijeku." : error ?? (result ? stateCopy(result) : "")}</p>
      {error && <section className="notice notice--error" role="alert"><strong>Planer nije dostupan.</strong><span>{error}</span></section>}
    {businessWorkspace && activeScenario && <WorkspaceVehicleSelection vehicles={businessWorkspace.vehicles} selectedVehicleIds={effectiveSelectedWorkspaceVehicleIds} vehicleRoutes={effectiveWorkspaceVehicleRoutes} locations={activeScenario.locations.map((location) => ({ id: location.id, display_name: location.display_name }))} invalidSelectedVehicleIds={inactiveSelectedVehicleIds} onSelectedVehicleIdsChange={(vehicleIds) => { setSelectedWorkspaceVehicleIds(vehicleIds); setVehicleSelectionScenarioId(activeScenario.id); setResult(null); }} onVehicleRoutesChange={(routes) => { setWorkspaceVehicleRoutes(routes); setVehicleSelectionScenarioId(activeScenario.id); setResult(null); }} />}
    {businessWorkspace && activeScenario && <WorkspaceOrderSelection orders={businessWorkspace.orders} machines={businessWorkspace.machines} selectedOrderIds={effectiveSelectedWorkspaceOrderIds} invalidSelectedOrderIds={invalidSelectedOrderIds} onSelectedOrderIdsChange={(orderIds) => { setSelectedWorkspaceOrderIds(orderIds); setOrderSelectionScenarioId(activeScenario.id); setResult(null); }} />}
    {dataset && activeScenario && <ScenarioManager canonical={dataset} scenario={activeScenario} scenarios={scenarios} savedPlans={savedPlans} result={result} planningOnly hideVehicleSelection hideOrderSelection onSelect={(id) => { setSelectedScenarioId(id); setVehicleSelectionScenarioId(null); setOrderSelectionScenarioId(null); if (id === ORIGINAL_SCENARIO_ID) setOptimizationStrategy("DISTANCE_SAVINGS"); setResult(null); }} onSaveScenario={updateScenario} onCreateScenario={createScenario} onDeleteScenario={deleteScenario} onSavePlan={(plan) => setSavedPlans((plans) => [...plans, plan])} onDeletePlan={(id) => setSavedPlans((plans) => plans.filter((plan) => plan.id !== id))} onOpenPlan={(plan) => { try { setResult(parseOptimizationResult(plan.result)); setSelectedScenarioId(plan.scenario_id); setVehicleSelectionScenarioId(null); setOrderSelectionScenarioId(null); } catch { setError("Spremljenu rutu nije moguće otvoriti jer je neispravna."); } }} />}
      <section className="strategy-selector" aria-labelledby="strategy-title"><div><p className="eyebrow">Korak 3 · način optimizacije</p><h2 id="strategy-title">Cilj plana</h2></div><div className="strategy-selector__cards">{strategyCards.map((strategy) => <button key={strategy.id} type="button" className={optimizationStrategy === strategy.id ? "strategy-card strategy-card--selected" : "strategy-card"} aria-pressed={optimizationStrategy === strategy.id} onClick={() => setOptimizationStrategy(strategy.id)}><span aria-hidden="true">{strategy.icon}</span><strong>{strategy.title}</strong><small>{strategy.description}</small></button>)}</div><label className="strategy-selector__require"><input type="checkbox" checked={requireAllSelectedVehicles} onChange={(event) => setRequireAllSelectedVehicles(event.target.checked)} />Obavezno koristi sva odabrana vozila <small>Može povećati ukupnu udaljenost; svako vozilo mora izvršiti barem jedan stvarni nalog.</small></label></section>
      {currentDataset && <><section className="dataset-grid" aria-label="Podaci trenutačnog scenarija"><article><span className="metric-label">Flota</span><strong>{currentDataset.vehicles.length}{activeScenario?.kind === "CUSTOM" ? " aktivna vozila" : " vozila"}</strong><small>{currentDataset.vehicles.map((vehicle) => `${vehicle.id}: ${vehicle.max_payload_kg} kg`).join(" · ")}</small></article><article><span className="metric-label">Potražnja</span><strong>{plural(currentDataset.orders.length, "order")}</strong><small>{plural(currentDataset.machines.length, "machine")} na {currentDataset.locations.length} lokacija</small></article><article><span className="metric-label">Ograničenja rada</span><strong>{currentDataset.parameters.max_driving_minutes / 60} h najviše vožnje</strong><small>{currentDataset.parameters.pickup_service_minutes} min preuzimanje · {currentDataset.parameters.delivery_service_minutes} min isporuka</small></article></section><section className="dataset-detail"><h2>{activeScenario?.kind === "ORIGINAL" ? "Kanonski podaci planiranja" : "Podaci trenutačnog planiranja"}</h2><div className="detail-grid"><div><h3>Vozila</h3>{currentDataset.vehicles.map((vehicle) => <p key={vehicle.id}><strong>{vehicle.id}</strong> · {vehicle.max_payload_kg} kg · {plural(vehicle.max_simultaneous_machines, "machine")} · {vehicle.start_location_id} → {vehicle.end_location_id}</p>)}</div><div><h3>Lokacije</h3><p>{currentDataset.locations.map((location) => `${location.id} (${location.x}, ${location.y})`).join(" · ")}</p><h3>Nalozi</h3><p>{currentDataset.orders.map((order) => `${order.id}: ${order.machine_id} ${order.pickup_location_id} → ${order.delivery_location_id}`).join(" · ")}</p></div></div></section></>}
      {!currentDataset && !error && <section className="notice" role="status">Učitavanje ili provjera odabranog scenarija planiranja…</section>}
      {result && <section className="results" aria-labelledby="results-title"><div className={`result-status result-status--${result.status.toLowerCase()}`}><div><p className="eyebrow">Rezultat optimizacije</p><h2 id="results-title">{statusLabel(result.status)}</h2><p>{stateCopy(result)}</p></div><span>Rješavač {result.solver_duration_seconds.toLocaleString("hr-HR", { maximumFractionDigits: 2 })} s</span></div>
        {currentDataset && <ResultSummary dataset={currentDataset} result={result} simulatedStartTime={simulatedStartTime} />}
        {currentDataset && <DistanceAnalysis dataset={currentDataset} result={result} circuityScale={circuityScale} onCircuityScaleChange={setCircuityScale} />}
        {(result.violations.length > 0 || validation?.violations.length || validation?.unserved_order_ids.length || result.diagnostic_message) && <section className="notice notice--warning"><h3>Dijagnostika</h3>{result.diagnostic_message && <p>{result.diagnostic_message}</p>}{[...result.violations, ...(validation?.violations ?? [])].map((violation, index) => <p key={`${violation.code}-${index}`}><strong>{violation.code}</strong>: {violation.description}</p>)}{validation?.unserved_order_ids.length ? <p>Neizvršeni nalozi: {validation.unserved_order_ids.join(", ")}</p> : null}</section>}
        {currentDataset && validation && <section className="route-grid">{currentDataset.vehicles.map((vehicle) => <RouteCard key={vehicle.id} dataset={currentDataset} vehicle={vehicle} route={result.plan?.routes.find((route) => route.vehicle_id === vehicle.id) ?? { vehicle_id: vehicle.id, stops: [] }} metric={metricsByVehicle.get(vehicle.id)} snapshots={validation.load_snapshots} startTime={simulatedStartTime} simulatedStartDate={simulatedStartDate} circuityScale={circuityScale} unservedOrderIds={validation.unserved_order_ids} />)}</section>}
      </section>}
      <footer className="technical-note"><strong>Napomena o planiranju:</strong> ograničenje od 9 sati odnosi se samo na vožnju. Pravila pauza, tahografa, rasporeda smjena, promet i dostupnost uživo nisu modelirani u ovoj demonstraciji.</footer>
    </section>
  </main>;
}
