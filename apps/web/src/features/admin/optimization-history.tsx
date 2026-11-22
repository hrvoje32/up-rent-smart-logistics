"use client";

import { useEffect, useState } from "react";

import { createDraftFromOptimizationRun, loadBusinessWorkspace, saveBusinessWorkspace, type OptimizationRun, type OptimizationRunOutcome } from "@/lib/business-workspace";
import { duration, distance, plural } from "@/lib/format";
import { RouteMap } from "@/features/admin/route-map";
import type { DemoDataset, OptimizationResult } from "@/types/optimizer-api";

const outcomeLabels: Record<OptimizationRunOutcome, string> = {
  SUCCESS: "Uspješno", INFEASIBLE: "Neizvedivo", INVALID_INPUT: "Neispravni podaci",
  NO_SOLUTION_FOUND: "Rješenje nije pronađeno", TIMEOUT: "Vremensko ograničenje", TECHNICAL_ERROR: "Tehnička pogreška",
};

function strategyLabel(strategy: OptimizationRun["optimization_strategy"]): string {
  return strategy === "FASTEST_DELIVERY" ? "Najbrža dostava" : strategy === "DISTANCE_SAVINGS" ? "Ušteda kilometara" : "Uravnoteženo";
}

function runMetrics(result: OptimizationResult) {
  const metrics = result.validation_result;
  return { distance: metrics?.combined_distance_tenths_km ?? null, driving: metrics?.combined_driving_time_seconds ?? null, waiting: metrics?.combined_waiting_time_seconds ?? 0, completion: metrics ? Math.max(0, ...metrics.route_metrics.map((metric) => metric.total_elapsed_seconds)) : null };
}

function isSuccessful(run: OptimizationRun): boolean { return run.outcome === "SUCCESS"; }

export function OptimizationHistory({ runs, onCreateDraft, onDelete }: { runs: OptimizationRun[]; onCreateDraft: (run: OptimizationRun) => void; onDelete: (run: OptimizationRun) => void; }) {
  const newestFirst = [...runs].sort((left, right) => right.created_at.localeCompare(left.created_at));
  return <section className="optimization-history" aria-labelledby="optimization-history-title">
    <div className="section-heading"><div><p className="eyebrow">ZAPISI PLANIRANJA</p><h2 id="optimization-history-title">Povijest optimizacija</h2><p>Svako pokretanje čuva nepromjenjivu snimku predanog odabira. Neuspjela pokretanja nemaju izmišljene rute ni metrike.</p></div><span className="history-count">{runs.length.toLocaleString("hr-HR")} spremljenih pokretanja</span></div>
    {newestFirst.length === 0 ? <div className="history-empty"><strong>Još nema spremljenih optimizacija.</strong><span>Pokretanje optimizacije automatski će se pojaviti ovdje, zajedno s odabirom i provjerenim rezultatom ili razlogom neuspjeha.</span></div> : <div className="history-list">{newestFirst.map((run) => <HistoryRun key={run.id} run={run} onCreateDraft={onCreateDraft} onDelete={onDelete} />)}</div>}
  </section>;
}

function HistoryRun({ run, onCreateDraft, onDelete }: { run: OptimizationRun; onCreateDraft: (run: OptimizationRun) => void; onDelete: (run: OptimizationRun) => void; }) {
  const successful = isSuccessful(run);
  const [showMap, setShowMap] = useState(false);
  const metrics = successful && run.result ? runMetrics(run.result) : null;
  return <details className={successful ? "history-run" : "history-run history-run--failed"}>
    <summary><span className="history-run__main"><strong title={run.draft_name}>{run.draft_name}</strong><small>{new Intl.DateTimeFormat("hr-HR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(run.created_at))} · {run.id}</small></span><span className={successful ? "pill pill--success" : "pill pill--warning"}>{outcomeLabels[run.outcome]}</span></summary>
    <div className="history-run__body">
      <dl className="history-facts"><div><dt>Strategija</dt><dd>{strategyLabel(run.optimization_strategy)}</dd></div><div><dt>Obavezna vozila</dt><dd>{run.require_all_selected_vehicles ? "Da" : "Ne"}</dd></div><div><dt>Odabrana vozila</dt><dd>{run.selected_vehicle_ids.join(", ") || "—"}</dd></div><div><dt>Odabrani nalozi</dt><dd>{run.selected_order_ids.join(", ") || "—"}</dd></div>{metrics && <><div><dt>Udaljenost</dt><dd>{metrics.distance === null ? "Nije dostupno" : distance(metrics.distance)}</dd></div><div><dt>Vožnja / čekanje</dt><dd>{metrics.driving === null ? "Nije dostupno" : `${duration(metrics.driving)} / ${duration(metrics.waiting)}`}</dd></div><div><dt>Završetak flote</dt><dd>{metrics.completion === null ? "Nije dostupno" : duration(metrics.completion)}</dd></div></>}</dl>
      {successful && run.result ? <><div className="history-vehicles"><h3>Sažetak po vozilu</h3>{run.result.validation_result?.route_metrics.length ? <ul>{run.result.validation_result.route_metrics.map((metric) => <li key={metric.vehicle_id}><strong>Kamion {metric.vehicle_id}</strong><span>{distance(metric.distance_tenths_km)} · {duration(metric.driving_time_seconds)} vožnje · {duration(metric.total_elapsed_seconds)} ukupno · {plural(metric.completed_order_count, "order")}</span></li>)}</ul> : <p>Nema provjerenih metrika rute za ovo pokretanje.</p>}</div><button type="button" className="secondary-button" onClick={() => setShowMap((value) => !value)}>{showMap ? "Sakrij kartu" : "Prikaži kartu"}</button>{showMap && <RouteMap dataset={run.source_snapshot} result={run.result} historical />}</> : <FailureDiagnostics run={run} />}
      <details className="history-subdetails"><summary>Predana snimka ulaza</summary><p>Vozila: {run.source_snapshot.vehicles.map((vehicle) => vehicle.id).join(", ") || "—"}</p><p>Nalozi: {run.source_snapshot.orders.map((order) => order.id).join(", ") || "—"}</p></details>
      <div className="history-run__actions"><button type="button" className="secondary-button" onClick={() => onCreateDraft(run)}>Novi nacrt iz ovog pokretanja</button><button type="button" className="table-button table-button--danger" onClick={() => { if (window.confirm(`Obrisati zapis optimizacije „${run.draft_name}”?`)) onDelete(run); }}>Obriši zapis</button></div>
    </div>
  </details>;
}

function FailureDiagnostics({ run }: { run: OptimizationRun }) {
  const failure = run.failure;
  return <section className="history-failure" aria-label="Dijagnostika neuspjele optimizacije"><h3>Zašto optimizacija nije uspjela?</h3><p>{failure?.message || "Detaljan razlog nije dostupan."}</p><details className="history-subdetails"><summary>Provjerena dijagnostika</summary>{failure?.affected_order_ids.length ? <p><strong>Pogođeni nalozi:</strong> {failure.affected_order_ids.join(", ")}</p> : <p>Za pojedini nalog nije dostupan potvrđen uzrok.</p>}{failure?.constraint_details.length ? <ul>{failure.constraint_details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul> : null}{failure?.corrective_guidance ? <p><strong>Preporuka:</strong> {failure.corrective_guidance}</p> : null}</details></section>;
}

/** Connects local immutable history to every product page without a server-side database. */
export function WorkspaceOptimizationHistory({ dataset, refreshKey }: { dataset: DemoDataset; refreshKey: OptimizationResult | null }) {
  const [runs, setRuns] = useState<OptimizationRun[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => { const sync = (): void => setRuns(loadBusinessWorkspace(window.localStorage, dataset).runs); sync(); window.addEventListener("up-rent-workspace-changed", sync); return () => window.removeEventListener("up-rent-workspace-changed", sync); }, [dataset, refreshKey]);
  function persist(update: (current: ReturnType<typeof loadBusinessWorkspace>) => ReturnType<typeof loadBusinessWorkspace>): void { const next = update(loadBusinessWorkspace(window.localStorage, dataset)); saveBusinessWorkspace(window.localStorage, next); setRuns(next.runs); window.dispatchEvent(new Event("up-rent-workspace-changed")); }
  return <><OptimizationHistory runs={runs} onCreateDraft={(run) => { persist((workspace) => ({ ...workspace, drafts: [...workspace.drafts, createDraftFromOptimizationRun(run)] })); setMessage("Novi nacrt je dodan u spremljene planove."); }} onDelete={(run) => { persist((workspace) => ({ ...workspace, runs: workspace.runs.filter((item) => item.id !== run.id) })); setMessage("Zapis optimizacije je obrisan."); }} />{message && <p className="history-feedback" role="status">{message}</p>}</>;
}
