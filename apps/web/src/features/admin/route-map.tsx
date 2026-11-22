"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";

import { distance, duration, plural } from "@/lib/format";
import { buildSimulatedRouteTimeline } from "@/lib/route-timeline";
import type { DemoDataset, LoadSnapshot, OptimizationResult, RouteAction, RouteMetrics, VehicleRoute } from "@/types/optimizer-api";

const palette = ["#0f766e", "#2563eb", "#c2410c", "#7c3aed", "#be123c", "#0369a1", "#4d7c0f", "#a16207", "#0e7490", "#475569"];
const width = 1000;
const height = 560;
const padding = 66;
type PlaybackState = "IDLE" | "PLAYING" | "PAUSED" | "COMPLETED";
type PlaybackPhase = "MANUAL" | "SERVICE" | "TRAVEL";

type CargoMachine = {
  orderId: string;
  machineId: string;
  weightKg: number;
};

type CargoState = {
  machines: CargoMachine[];
  loadKg: number;
  machineCount: number;
  diagnostics: string[];
};

type PreparedAction = {
  action: RouteAction;
  snapshot: LoadSnapshot | undefined;
  cargo: CargoState;
  serviceDurationSeconds: number;
  machineId: string | undefined;
  machineWeightKg: number | undefined;
};

type StopPoint = {
  id: string;
  vehicleId: string;
  stopIndex: number;
  locationId: string;
  x: number;
  y: number;
  markerX: number;
  markerY: number;
  actions: PreparedAction[];
  travelDistanceTenthsKm: number;
  cumulativeDistanceTenthsKm: number;
  travelDurationSeconds: number;
  arrivalElapsedSeconds: number;
  departureElapsedSeconds: number;
};

type PreparedRoute = {
  vehicleId: string;
  color: string;
  actionCount: number;
  points: StopPoint[];
  metric: RouteMetrics | undefined;
  distanceIsVerified: boolean;
  timeIsVerified: boolean;
};

type RouteMapProps = {
  dataset: DemoDataset;
  result: OptimizationResult;
  historical?: boolean;
  locationLabels?: Readonly<Record<string, string>>;
};

export function RouteMap({ dataset, result, historical = false, locationLabels = {} }: RouteMapProps) {
  const prepared = useMemo(() => prepareMap(dataset, result), [dataset, result]);
  const [visibleVehicleIds, setVisibleVehicleIds] = useState<Set<string>>(() => new Set(activeVehicleIds(dataset, result)));
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(firstActiveVehicleId(dataset, result));
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [playbackState, setPlaybackState] = useState<PlaybackState>("IDLE");
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackPhase, setPlaybackPhase] = useState<PlaybackPhase>("MANUAL");
  const [activeActionIndex, setActiveActionIndex] = useState<number | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const animationFrame = useRef<number | null>(null);

  const selectedVehicle = selectedVehicleId ? prepared?.vehicles.find((vehicle) => vehicle.id === selectedVehicleId) : undefined;
  const selectedRoute = selectedVehicleId ? prepared?.routes.find((route) => route.vehicleId === selectedVehicleId) : undefined;
  const selectedStop = prepared?.stops.find((stop) => stop.id === selectedStopId) ?? null;
  const visibleRoutes = prepared?.routes.filter((route) => route.actionCount > 0 && visibleVehicleIds.has(route.vehicleId)) ?? [];
  const reset = (): void => { setZoom(1); setPan({ x: 0, y: 0 }); };
  const resetPlayback = (nextState: PlaybackState = "IDLE"): void => { setPlaybackState(nextState); setPlaybackIndex(0); setPlaybackProgress(0); setPlaybackPhase("MANUAL"); setActiveActionIndex(null); setSelectedStopId(null); };
  const selectVehicle = (id: string): void => { setSelectedVehicleId(id); resetPlayback(); };
  const toggleVehicle = (id: string): void => setVisibleVehicleIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const showSelected = (): void => { if (selectedVehicleId) setVisibleVehicleIds(new Set([selectedVehicleId])); };
  const selectStop = (id: string): void => {
    const stop = prepared?.stops.find((item) => item.id === id);
    const route = stop ? prepared?.routes.find((item) => item.vehicleId === stop.vehicleId) : undefined;
    const index = route?.points.findIndex((point) => point.id === id) ?? -1;
    if (!stop || index < 0) return;
    setSelectedVehicleId(stop.vehicleId);
    setPlaybackState("PAUSED"); setPlaybackIndex(index); setPlaybackProgress(0); setPlaybackPhase("MANUAL"); setActiveActionIndex(null); setSelectedStopId(id);
  };
  const onPointerDown = (event: PointerEvent<SVGSVGElement>): void => { event.currentTarget.setPointerCapture(event.pointerId); setDragOrigin({ x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }); };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>): void => { if (dragOrigin) setPan({ x: dragOrigin.panX + event.clientX - dragOrigin.x, y: dragOrigin.panY + event.clientY - dragOrigin.y }); };
  const onPointerUp = (): void => setDragOrigin(null);
  const onWheel = (event: WheelEvent<SVGSVGElement>): void => { event.preventDefault(); setZoom((value) => Math.min(3, Math.max(0.6, value + (event.deltaY < 0 ? 0.15 : -0.15)))); };
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = (): void => setReducedMotion(query.matches);
    update(); query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (playbackState !== "PLAYING" || !selectedRoute || reducedMotion) return undefined;
    const current = selectedRoute.points[playbackIndex];
    if (!current) return undefined;
    if (playbackPhase === "SERVICE") {
      const actionCount = current.actions.length;
      if (actionCount === 0 || activeActionIndex === null) {
        return undefined;
      }
      let serviceStartedAt: number | null = null;
      const advanceService = (now: number): void => {
        if (serviceStartedAt === null) serviceStartedAt = now;
        if (now - serviceStartedAt < 420 / playbackSpeed) {
          animationFrame.current = window.requestAnimationFrame(advanceService);
          return;
        }
        if (activeActionIndex < actionCount - 1) setActiveActionIndex(activeActionIndex + 1);
        else if (playbackIndex >= selectedRoute.points.length - 1) setPlaybackState("COMPLETED");
        else setPlaybackPhase("TRAVEL");
      };
      animationFrame.current = window.requestAnimationFrame(advanceService);
      return () => { if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current); };
    }
    if (playbackIndex >= selectedRoute.points.length - 1) return undefined;
    let startedAt: number | null = null;
    const duration = 1_100 / playbackSpeed;
    const next = selectedRoute.points[playbackIndex + 1];
    const advance = (): void => {
      const nextIndex = playbackIndex + 1;
      const nextPoint = selectedRoute.points[nextIndex];
      setPlaybackIndex(nextIndex); setPlaybackProgress(0); setSelectedStopId(nextPoint?.id ?? null);
      setActiveActionIndex(nextPoint?.actions.length ? 0 : null);
      if (nextIndex >= selectedRoute.points.length - 1 && !nextPoint?.actions.length) setPlaybackState("COMPLETED");
      else setPlaybackPhase(nextPoint?.actions.length ? "SERVICE" : "TRAVEL");
    };
    const animate = (now: number): void => {
      if (current && next && Math.hypot(next.x - current.x, next.y - current.y) < 0.1) {
        advance();
        return;
      }
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, (now - startedAt) / duration);
      setPlaybackProgress(progress);
      if (progress >= 1) {
        advance();
      } else animationFrame.current = window.requestAnimationFrame(animate);
    };
    animationFrame.current = window.requestAnimationFrame(animate);
    return () => { if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current); };
  }, [activeActionIndex, playbackIndex, playbackPhase, playbackSpeed, playbackState, reducedMotion, selectedRoute]);
  useEffect(() => () => { if (animationFrame.current !== null) window.cancelAnimationFrame(animationFrame.current); }, []);
  if (!prepared) return <section className="route-map route-map--unavailable" aria-label="Karta ruta"><h3>Karta ruta nije dostupna</h3><p>Karta nije dostupna jer optimizacija nije proizvela valjanu rutu.</p></section>;
  const play = (): void => {
    if (!selectedRoute || selectedRoute.actionCount === 0 || reducedMotion) return;
    const firstPoint = selectedRoute.points[0];
    if (playbackState === "COMPLETED" || playbackState === "IDLE") {
      setPlaybackIndex(0); setPlaybackProgress(0); setSelectedStopId(firstPoint?.id ?? null);
      setActiveActionIndex(firstPoint?.actions.length ? 0 : null); setPlaybackPhase(firstPoint?.actions.length ? "SERVICE" : "TRAVEL");
    } else if (playbackPhase === "MANUAL") {
      const currentPoint = selectedRoute.points[playbackIndex];
      setSelectedStopId(currentPoint?.id ?? null);
      setActiveActionIndex(currentPoint?.actions.length ? 0 : null); setPlaybackPhase(currentPoint?.actions.length ? "SERVICE" : "TRAVEL");
    }
    setPlaybackState("PLAYING");
  };
  const nextStep = (): void => { if (!selectedRoute) return; const next = Math.min(selectedRoute.points.length - 1, playbackIndex + 1); setPlaybackState(next === selectedRoute.points.length - 1 ? "COMPLETED" : "PAUSED"); setPlaybackIndex(next); setPlaybackProgress(0); setPlaybackPhase("MANUAL"); setActiveActionIndex(null); setSelectedStopId(selectedRoute.points[next]?.id ?? null); };
  const previousStep = (): void => { if (!selectedRoute) return; const previous = Math.max(0, playbackIndex - 1); setPlaybackState("PAUSED"); setPlaybackIndex(previous); setPlaybackProgress(0); setPlaybackPhase("MANUAL"); setActiveActionIndex(null); setSelectedStopId(selectedRoute.points[previous]?.id ?? null); };

  return <section className="route-map" aria-labelledby="route-map-title">
    <div className="route-map__heading"><div><p className="eyebrow">VIZUALNI RASPORED</p><h3 id="route-map-title">Shematski prikaz ruta (X/Y)</h3><p>{historical ? "Povijesni rezultat — samo pregled." : "Prikaz koristi predane sintetičke koordinate; nije karta stvarnih cesta."}</p></div><div className="route-map__zoom" aria-label="Kontrole karte"><button type="button" onClick={() => setZoom((value) => Math.min(3, value + 0.2))} aria-label="Povećaj kartu">+</button><button type="button" onClick={() => setZoom((value) => Math.max(0.6, value - 0.2))} aria-label="Smanji kartu">−</button><button type="button" onClick={reset}>Vrati prikaz</button><button type="button" onClick={() => { setVisibleVehicleIds(new Set(prepared.routes.filter((route) => route.actionCount > 0).map((route) => route.vehicleId))); reset(); }}>Prilagodi vidljivim rutama</button></div></div>
    <div className="route-map__controls"><button type="button" onClick={() => setVisibleVehicleIds(new Set(prepared.routes.filter((route) => route.actionCount > 0).map((route) => route.vehicleId)))}>Prikaži sve rute</button><button type="button" onClick={() => setVisibleVehicleIds(new Set())}>Sakrij sve rute</button>{selectedVehicle && <button type="button" onClick={showSelected}>Prikaži odabrano vozilo</button>}<span role="status">{visibleRoutes.length === 0 ? "Sve aktivne rute su skrivene." : `${visibleRoutes.length} vidljivih aktivnih ruta.`}</span></div>
    <PlaybackControls vehicleId={selectedVehicleId} route={selectedRoute} state={playbackState} step={playbackIndex} speed={playbackSpeed} reducedMotion={reducedMotion} onToggle={() => playbackState === "PLAYING" ? setPlaybackState("PAUSED") : play()} onRestart={() => resetPlayback()} onPrevious={previousStep} onNext={nextStep} onSpeed={setPlaybackSpeed} />
    <div className="route-map__layout"><div className="route-map__canvas-wrap"><svg className="route-map__canvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Interaktivni shematski prikaz transportnih ruta" tabIndex={0} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} onKeyDown={(event) => { if (event.key === "+") setZoom((value) => Math.min(3, value + 0.2)); if (event.key === "-") setZoom((value) => Math.max(0.6, value - 0.2)); if (event.key === "0") reset(); }}>
      <defs><pattern id="route-map-grid" width="64" height="64" patternUnits="userSpaceOnUse"><path d="M 64 0 L 0 0 0 64" fill="none" stroke="#cbd5e1" strokeWidth="1" /></pattern></defs>
      <rect width={width} height={height} fill="url(#route-map-grid)" opacity="0.38" />
      <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {visibleRoutes.map((route) => <RouteLine key={route.vehicleId} route={route} selected={selectedVehicleId === route.vehicleId} dimmed={selectedVehicleId !== null && selectedVehicleId !== route.vehicleId} playbackIndex={selectedVehicleId === route.vehicleId ? playbackIndex : -1} playbackProgress={selectedVehicleId === route.vehicleId ? playbackProgress : 0} />)}
        {prepared.locations.map((location, index) => <LocationMarker key={location.id} location={location} label={locationLabels[location.id] ?? location.id} index={index} />)}
        {prepared.stops.filter((stop) => visibleVehicleIds.has(stop.vehicleId)).map((stop) => <StopMarker key={stop.id} stop={stop} color={prepared.colors.get(stop.vehicleId) ?? "#475569"} selected={selectedStopId === stop.id} dimmed={selectedVehicleId !== null && selectedVehicleId !== stop.vehicleId} onSelect={selectStop} />)}
        {selectedRoute && selectedRoute.actionCount > 0 && <PlaybackVehicle route={selectedRoute} index={playbackIndex} progress={playbackProgress} color={prepared.colors.get(selectedRoute.vehicleId) ?? "#475569"} />}
      </g>
    </svg></div>
      <aside className="route-map__legend" aria-label="Vozila i vidljivost ruta"><h4>Rute vozila</h4>{prepared.vehicles.map((vehicle) => { const route = prepared.routes.find((item) => item.vehicleId === vehicle.id); const metric = prepared.metrics.get(vehicle.id); const active = (route?.actionCount ?? 0) > 0; return <div className={selectedVehicleId === vehicle.id ? "route-map__vehicle route-map__vehicle--selected" : "route-map__vehicle"} key={vehicle.id}><label><input type="checkbox" checked={visibleVehicleIds.has(vehicle.id)} onChange={() => toggleVehicle(vehicle.id)} disabled={!active} /><i style={{ backgroundColor: prepared.colors.get(vehicle.id) }} />Kamion {vehicle.id}</label><button type="button" onClick={() => selectVehicle(vehicle.id)} aria-label={`Odaberi Kamion ${vehicle.id}`} aria-pressed={selectedVehicleId === vehicle.id}>Odaberi</button><small>{active ? `${distance(metric?.distance_tenths_km ?? 0)} · ${plural(metric?.completed_order_count ?? 0, "order")}` : "Nije korišten u ovom planu"}</small></div>; })}<section className="route-map__meaning" aria-label="Značenje oznaka"><strong>Oznake</strong><span><b className="route-map__key route-map__key--pickup">↑</b> Preuzimanje</span><span><b className="route-map__key route-map__key--delivery">↓</b> Isporuka</span><span><b className="route-map__key route-map__key--depot">◆</b> Depo</span><span><b className="route-map__key route-map__key--selected">●</b> Odabrano stajanje</span></section></aside></div>
    <div className="route-map__bottom"><StopList route={selectedRoute} selectedStopId={selectedStopId} locationLabels={locationLabels} onSelect={selectStop} /><div className="route-map__details" aria-live="polite">{selectedStop && selectedRoute ? <StopDetails stop={selectedStop} route={selectedRoute} dataset={dataset} activeActionIndex={selectedStop.id === selectedRoute.points[playbackIndex]?.id ? activeActionIndex : null} /> : <p>Odaberite stajanje na karti ili u popisu za sve radnje u točnom redoslijedu rješavača.</p>}</div></div>
  </section>;
}

function PlaybackControls({ vehicleId, route, state, step, speed, reducedMotion, onToggle, onRestart, onPrevious, onNext, onSpeed }: { vehicleId: string | null; route: PreparedRoute | undefined; state: PlaybackState; step: number; speed: number; reducedMotion: boolean; onToggle: () => void; onRestart: () => void; onPrevious: () => void; onNext: () => void; onSpeed: (speed: number) => void }) {
  const total = route?.points.length ?? 0;
  const hasRoute = (route?.actionCount ?? 0) > 0;
  const isPlaying = state === "PLAYING";
  return <section className="route-map__playback" aria-label="Shematska animacija izračunate rute"><div><strong>Shematska animacija izračunate rute</strong><span>{vehicleId ? `Kamion ${vehicleId}` : "Odaberite vozilo"} · {hasRoute ? `korak ${Math.min(step + 1, total)} / ${total}` : "Nije korišten u ovom planu"}</span></div><div className="route-map__playback-controls"><div className="route-map__control-group" aria-label="Reprodukcija"><button type="button" onClick={onToggle} disabled={!hasRoute || reducedMotion} aria-label={isPlaying ? "Pauziraj reprodukciju" : "Pokreni reprodukciju"}><span aria-hidden="true">{isPlaying ? "❚❚" : "▶"}</span>{isPlaying ? "Pauza" : "Pokreni"}</button><button type="button" onClick={onRestart} disabled={!hasRoute} aria-label="Ponovno pokreni reprodukciju"><span aria-hidden="true">↺</span>Ispočetka</button></div><div className="route-map__control-group" aria-label="Koraci"><button type="button" onClick={onPrevious} disabled={!hasRoute || step === 0} aria-label="Prethodno stajanje"><span aria-hidden="true">◀</span>Prethodno</button><button type="button" onClick={onNext} disabled={!hasRoute || step >= total - 1} aria-label="Sljedeće stajanje">Sljedeće<span aria-hidden="true">▶</span></button></div><label>Brzina<select aria-label="Brzina reprodukcije" value={speed} onChange={(event) => onSpeed(Number(event.target.value))}><option value={0.5}>0,5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label></div><progress max={Math.max(1, total - 1)} value={Math.min(step, Math.max(1, total - 1))}>{step}</progress>{reducedMotion && <small>Smanjeno kretanje je uključeno; koristite Prethodno i Sljedeće za ručni pregled koraka.</small>}{state === "COMPLETED" && <small role="status">Simulacija završena.</small>}</section>;
}

function RouteLine({ route, selected, dimmed, playbackIndex, playbackProgress }: { route: PreparedRoute; selected: boolean; dimmed: boolean; playbackIndex: number; playbackProgress: number }) {
  const points = route.points.map((point) => `${point.x},${point.y}`).join(" ");
  const travelled = route.points.slice(0, Math.max(1, playbackIndex + 1));
  const current = route.points[playbackIndex];
  const next = route.points[playbackIndex + 1];
  if (current && next) travelled.push({ ...current, x: current.x + (next.x - current.x) * playbackProgress, y: current.y + (next.y - current.y) * playbackProgress });
  const cues = route.points.slice(1).flatMap((point, index) => {
    const previous = route.points[index]!;
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    const length = Math.hypot(dx, dy);
    if (length < 42) return [];
    return [{ id: `${route.vehicleId}-${index}`, x: (previous.x + point.x) / 2, y: (previous.y + point.y) / 2, angle: Math.atan2(dy, dx) * 180 / Math.PI }];
  });
  return <g opacity={dimmed ? 0.18 : 1}><polyline points={points} fill="none" stroke={route.color} strokeWidth={selected ? 6 : 3.5} strokeLinecap="round" strokeLinejoin="round" opacity="0.28" /><polyline points={travelled.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke={route.color} strokeWidth={selected ? 6 : 3.5} strokeLinecap="round" strokeLinejoin="round" />{cues.map((cue) => <path key={cue.id} d="M -5 -4 L 5 0 L -5 4 Z" fill={route.color} transform={`translate(${cue.x} ${cue.y}) rotate(${cue.angle})`} />)}</g>;
}

function PlaybackVehicle({ route, index, progress, color }: { route: PreparedRoute; index: number; progress: number; color: string }) {
  const current = route.points[Math.min(index, route.points.length - 1)];
  const next = route.points[index + 1];
  if (!current) return null;
  const x = next ? current.x + (next.x - current.x) * progress : current.x;
  const y = next ? current.y + (next.y - current.y) * progress : current.y;
  return <g transform={`translate(${x} ${y})`} aria-label={`Položaj Kamiona ${route.vehicleId}`}><circle r="9" fill="#fff" stroke={color} strokeWidth="4" /><path d="M-4,-3 L5,-3 L6,3 L-5,3 Z" fill={color} /><circle cx="-2" cy="5" r="1.5" fill="#172554" /><circle cx="4" cy="5" r="1.5" fill="#172554" /></g>;
}

function LocationMarker({ location, label, index }: { location: { id: string; x: number; y: number; depotRole: "START" | "END" | "BOTH" | null }; label: string; index: number }) {
  const positions = [[14, -14], [14, 22], [-14, -14], [-14, 22]] as const;
  const [offsetX, offsetY] = positions[index % positions.length]!;
  const anchor = offsetX < 0 ? "end" : "start";
  const depotLabel = location.depotRole === "BOTH" ? "početni/završni depo" : location.depotRole === "START" ? "početni depo" : location.depotRole === "END" ? "završni depo" : null;
  return <g><circle cx={location.x} cy={location.y} r={depotLabel ? 11 : 7} fill={depotLabel ? "#172554" : "#fff"} stroke="#172554" strokeWidth="2.5" /><text x={location.x + offsetX} y={location.y + offsetY} textAnchor={anchor} className="route-map__location-label">{label}</text>{depotLabel && <text x={location.x + offsetX} y={location.y + offsetY + 13} textAnchor={anchor} className="route-map__depot-label">{depotLabel}</text>}</g>;
}

function StopMarker({ stop, color, selected, dimmed, onSelect }: { stop: StopPoint; color: string; selected: boolean; dimmed: boolean; onSelect: (id: string) => void }) {
  const pickups = stop.actions.filter((item) => item.action.action_type === "PICKUP").length;
  const deliveries = stop.actions.length - pickups;
  const actionLabel = `${pickups ? `${pickups} preuzimanje` : ""}${pickups && deliveries ? ", " : ""}${deliveries ? `${deliveries} isporuka` : ""}`;
  const kind = pickups > 0 && deliveries > 0 ? "BOTH" : pickups > 0 ? "PICKUP" : deliveries > 0 ? "DELIVERY" : "NONE";
  const symbol = kind === "PICKUP" ? "↑" : kind === "DELIVERY" ? "↓" : kind === "BOTH" ? "↕" : "•";
  const badgeColor = kind === "PICKUP" ? "#0f766e" : kind === "DELIVERY" ? "#c2410c" : kind === "BOTH" ? "#7c3aed" : "#475569";
  return <g opacity={dimmed ? 0.18 : 1} transform={`translate(${stop.markerX} ${stop.markerY})`}><circle className="route-map__stop" r={selected ? 15 : 12} fill={color} stroke={selected ? "#fbbf24" : "#fff"} strokeWidth={selected ? "4" : "2"} role="button" tabIndex={0} aria-label={`Kamion ${stop.vehicleId}, stajanje ${stop.stopIndex + 1}, ${stop.locationId}: ${actionLabel}`} onClick={() => onSelect(stop.id)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(stop.id); } }} /><text textAnchor="middle" y="4" className="route-map__stop-number">{stop.stopIndex + 1}</text>{kind !== "NONE" && <><rect x="8" y="-16" width="15" height="15" rx="5" fill={badgeColor} stroke="#fff" strokeWidth="1.5" /><text x="15.5" y="-5" textAnchor="middle" className="route-map__action-symbol">{symbol}</text></>}{stop.actions.length > 1 && <text textAnchor="middle" y="-21" className="route-map__stop-count">{stop.actions.length}</text>}</g>;
}

function StopList({ route, selectedStopId, locationLabels, onSelect }: { route: PreparedRoute | undefined; selectedStopId: string | null; locationLabels: Readonly<Record<string, string>>; onSelect: (id: string) => void }) {
  if (!route) return <section className="route-map__stop-list"><h4>Slijed stajanja</h4><p>Odaberite vozilo za prikaz njegove rute.</p></section>;
  if (route.actionCount === 0) return <section className="route-map__stop-list"><h4>Slijed stajanja · Kamion {route.vehicleId}</h4><p>Nije korišten u ovom planu.</p></section>;
  return <section className="route-map__stop-list" aria-label={`Slijed stajanja za Kamion ${route.vehicleId}`}><h4>Slijed stajanja · Kamion {route.vehicleId}</h4><ol>{route.points.map((stop) => <li key={stop.id}><button type="button" className={selectedStopId === stop.id ? "route-map__stop-list-button route-map__stop-list-button--selected" : "route-map__stop-list-button"} onClick={() => onSelect(stop.id)}><strong>{stop.stopIndex + 1}</strong><span>{locationLabels[stop.locationId] ?? stop.locationId}</span><small>{stopActionSummary(stop)}</small></button></li>)}</ol></section>;
}

function stopActionSummary(stop: StopPoint): string {
  const pickups = stop.actions.filter((item) => item.action.action_type === "PICKUP").length;
  const deliveries = stop.actions.length - pickups;
  if (pickups && deliveries) return `↑↓ ${pickups + deliveries} radnje`;
  if (pickups) return `↑ Preuzimanje${pickups > 1 ? ` · ${pickups}` : ""}`;
  if (deliveries) return `↓ Isporuka${deliveries > 1 ? ` · ${deliveries}` : ""}`;
  return "Putovanje / baza";
}

function StopDetails({ stop, route, dataset, activeActionIndex }: { stop: StopPoint; route: PreparedRoute; dataset: DemoDataset; activeActionIndex: number | null }) {
  const vehicle = dataset.vehicles.find((item) => item.id === stop.vehicleId);
  const totalDistance = route.metric?.distance_tenths_km ?? 0;
  const remainingDistance = route.distanceIsVerified ? Math.max(0, totalDistance - stop.cumulativeDistanceTenthsKm) : null;
  return <><strong>Stajanje {stop.stopIndex + 1} · {stop.locationId} · Kamion {stop.vehicleId}</strong>
    <div className="route-map__trip-facts"><span>Od prethodnog: {route.distanceIsVerified ? `${distance(stop.travelDistanceTenthsKm)} · ${duration(stop.travelDurationSeconds)}` : "nije potvrđeno"}</span><span>Prijeđeno: {route.distanceIsVerified ? distance(stop.cumulativeDistanceTenthsKm) : "nije potvrđeno"}</span><span>Ruta: {distance(totalDistance)}{remainingDistance === null ? " · provjera dionica nije uspjela" : ` · preostaje ${distance(remainingDistance)}`}</span><span>Planirano: {formatPlanningTime(dataset, stop.arrivalElapsedSeconds)} · ukupno {duration(route.metric?.total_elapsed_seconds ?? stop.departureElapsedSeconds)}{route.timeIsVerified ? "" : " · raspodjela vremena nije potvrđena"}</span>{(route.metric?.waiting_time_seconds ?? 0) > 0 && <span>Čekanje: {duration(route.metric?.waiting_time_seconds ?? 0)} ukupno; nije raspodijeljeno po stajanjima.</span>}</div>
    {stop.actions.length === 0 ? <span>Putovanje ili stajanje bez transportne radnje.</span> : <><ol className="route-map__cargo-actions">{stop.actions.map((preparedAction, actionIndex) => <CargoActionDetails key={`${preparedAction.action.order_id}-${actionIndex}`} stop={stop} actionIndex={actionIndex} preparedAction={preparedAction} vehicle={vehicle} active={activeActionIndex === actionIndex} />)}</ol><StopCargoSummary stop={stop} vehicle={vehicle} /></>}
  </>;
}

function CargoActionDetails({ stop, actionIndex, preparedAction, vehicle, active }: { stop: StopPoint; actionIndex: number; preparedAction: PreparedAction; vehicle: DemoDataset["vehicles"][number] | undefined; active: boolean }) {
  const { action, cargo, serviceDurationSeconds } = preparedAction;
  const capacity = vehicle?.max_payload_kg ?? 0;
  const capacityPercent = capacity > 0 ? Math.min(100, cargo.loadKg / capacity * 100) : 0;
  const className = active ? "route-map__cargo-action route-map__cargo-action--active" : "route-map__cargo-action";
  const stateLabel = action.action_type === "PICKUP" ? "Stanje nakon preuzimanja" : "Stanje nakon isporuke";
  return <li className={className}>
    <div className="route-map__cargo-action-heading"><b>{stop.stopIndex + 1}.{actionIndex + 1} · <span className={action.action_type === "PICKUP" ? "route-map__cargo-badge route-map__cargo-badge--pickup" : "route-map__cargo-badge route-map__cargo-badge--delivery"}>{action.action_type === "PICKUP" ? "↑ Preuzimanje" : "↓ Isporuka"}</span></b><small>Usluga: {duration(serviceDurationSeconds)}</small></div>
    <span>Nalog {action.order_id}{preparedAction.machineId ? ` · ${preparedAction.machineId}` : ""}{preparedAction.machineWeightKg === undefined ? "" : ` · ${preparedAction.machineWeightKg.toLocaleString("hr-HR")} kg`}</span>
    {cargo.diagnostics.length > 0 ? <p className="route-map__cargo-diagnostic" role="status">Provjera tereta: {cargo.diagnostics.join(" ")}</p> : <section className="route-map__cargo-state" aria-label={`${stateLabel} nakon radnje ${stop.stopIndex + 1}.${actionIndex + 1}`}>
      <header><span>{stateLabel}</span><strong>{cargo.machines.length === 0 ? "Vozilo je prazno" : `${cargo.machineCount} ${cargo.machineCount === 1 ? "stroj" : "stroja"} u vozilu`}</strong></header>
      <div className="route-map__cargo-kpis"><article aria-label={`Teret nakon radnje: ${cargo.loadKg} / ${capacity} kg`}><span>Teret nakon radnje</span><strong>{cargo.loadKg.toLocaleString("hr-HR")} <small>/ {capacity.toLocaleString("hr-HR")} kg</small></strong></article><article aria-label={`Ukupno strojeva: ${cargo.machineCount} / ${vehicle?.max_simultaneous_machines ?? 0}`}><span>Ukupno strojeva</span><strong>{cargo.machineCount} <small>/ {vehicle?.max_simultaneous_machines ?? 0}</small></strong></article><article aria-label={`Iskorištenost nosivosti: ${capacityPercent.toLocaleString("hr-HR", { maximumFractionDigits: 1 })}%`}><span>Iskorištenost nosivosti</span><strong>{capacityPercent.toLocaleString("hr-HR", { maximumFractionDigits: 1 })}%</strong></article></div>
      <progress aria-label={`Iskorištenost nosivosti nakon radnje ${stop.stopIndex + 1}.${actionIndex + 1}`} max={100} value={capacityPercent}>{capacityPercent}</progress>
      <div className="route-map__cargo-current"><strong>Strojevi koji su ostali u vozilu</strong>{cargo.machines.length === 0 ? <span>Nema strojeva u vozilu.</span> : <ul>{cargo.machines.map((item) => <li key={`${item.orderId}-${item.machineId}`}><b>{item.machineId}</b><span>{item.weightKg.toLocaleString("hr-HR")} kg · nalog {item.orderId}</span></li>)}</ul>}</div>
    </section>}
  </li>;
}

function StopCargoSummary({ stop, vehicle }: { stop: StopPoint; vehicle: DemoDataset["vehicles"][number] | undefined }) {
  const delivered = stop.actions.filter((item) => item.action.action_type === "DELIVERY");
  const loaded = stop.actions.filter((item) => item.action.action_type === "PICKUP");
  const finalAction = stop.actions[stop.actions.length - 1];
  const cargo = finalAction?.cargo;
  const capacity = vehicle?.max_payload_kg ?? 0;
  const remainingCapacity = cargo ? Math.max(0, capacity - cargo.loadKg) : 0;
  const remainingMachineSlots = cargo ? Math.max(0, (vehicle?.max_simultaneous_machines ?? 0) - cargo.machineCount) : 0;
  return <section className="route-map__cargo-action route-map__stop-cargo-summary" aria-label={`Sažetak tereta nakon stajanja ${stop.stopIndex + 1}`}>
    <header><div><span>SAŽETAK STAJANJA</span><h5>Trenutačni teret nakon svih radnji</h5></div><strong>{cargo?.loadKg.toLocaleString("hr-HR") ?? "—"} / {capacity.toLocaleString("hr-HR")} kg</strong></header>
    {!cargo || cargo.diagnostics.length > 0 ? <p className="route-map__cargo-diagnostic" role="status">Sažetak tereta nije potvrđen: {cargo?.diagnostics.join(" ") ?? "nedostaje radnja."}</p> : <><div className="route-map__stop-cargo-columns"><CargoChangeList title="Isporučeno na ovom stajanju" items={delivered} empty="Nema isporučenih strojeva." variant="delivery" /><CargoChangeList title="Natovareno na ovom stajanju" items={loaded} empty="Nema natovarenih strojeva." variant="pickup" /><div className="route-map__stop-cargo-now"><strong>Trenutačno u kamionu</strong>{cargo.machines.length === 0 ? <span>Vozilo je prazno.</span> : <ul>{cargo.machines.map((item) => <li key={`${item.orderId}-${item.machineId}`}><b>{item.machineId}</b><span>{item.weightKg.toLocaleString("hr-HR")} kg · nalog {item.orderId}</span></li>)}</ul>}</div></div><div className="route-map__stop-cargo-metrics"><span aria-label={`Ukupno strojeva nakon stajanja: ${cargo.machineCount} / ${vehicle?.max_simultaneous_machines ?? 0}`}><b>{cargo.machineCount} / {vehicle?.max_simultaneous_machines ?? 0}</b> strojeva</span><span aria-label={`Slobodna nosivost: ${remainingCapacity} kg`}><b>{remainingCapacity.toLocaleString("hr-HR")} kg</b> slobodne nosivosti</span><span aria-label={`Slobodna mjesta za strojeve: ${remainingMachineSlots}`}><b>{remainingMachineSlots}</b> slobodnih mjesta</span></div></>}
  </section>;
}

function CargoChangeList({ title, items, empty, variant }: { title: string; items: PreparedAction[]; empty: string; variant: "pickup" | "delivery" }) {
  return <div className={`route-map__stop-cargo-change route-map__stop-cargo-change--${variant}`}><strong>{title}</strong>{items.length === 0 ? <span>{empty}</span> : <ul>{items.map((item, index) => <li key={`${item.action.order_id}-${index}`}><b>{item.machineId ?? "Nepoznat stroj"}</b><span>{item.machineWeightKg === undefined ? "Masa nije dostupna" : `${item.machineWeightKg.toLocaleString("hr-HR")} kg`} · nalog {item.action.order_id}</span></li>)}</ul>}</div>;
}

function formatPlanningTime(dataset: DemoDataset, elapsedSeconds: number): string {
  const planningStart = dataset.parameters.planning_start_at;
  const timestamp = planningStart ? Date.parse(planningStart) : Number.NaN;
  if (Number.isFinite(timestamp)) return new Intl.DateTimeFormat("hr-HR", { timeZone: "Europe/Zagreb", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(timestamp + elapsedSeconds * 1000));
  return `+ ${duration(elapsedSeconds)}`;
}

function activeVehicleIds(dataset: DemoDataset, result: OptimizationResult): string[] {
  if (!result.plan) return [];
  return dataset.vehicles.filter((vehicle) => (result.plan?.routes.find((route) => route.vehicle_id === vehicle.id)?.stops.some((stop) => stop.actions.length > 0) ?? false)).map((vehicle) => vehicle.id);
}

function firstActiveVehicleId(dataset: DemoDataset, result: OptimizationResult): string | null { return activeVehicleIds(dataset, result)[0] ?? null; }

function prepareMap(dataset: DemoDataset, result: OptimizationResult) {
  if (result.status !== "FEASIBLE" || !result.validation_result?.is_valid || !result.validation_result.is_complete || !result.plan || dataset.locations.length === 0) return null;
  const validation = result.validation_result;
  const routeLocationIds = new Set(result.plan.routes.flatMap((route) => route.stops.map((stop) => stop.location_id)));
  const mappedLocations = dataset.locations.filter((location) => routeLocationIds.has(location.id));
  const visibleLocations = mappedLocations.length > 0 ? mappedLocations : dataset.locations;
  const bounds = visibleLocations.reduce((current, location) => ({ minX: Math.min(current.minX, location.x), maxX: Math.max(current.maxX, location.x), minY: Math.min(current.minY, location.y), maxY: Math.max(current.maxY, location.y) }), { minX: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY });
  const sourceWidth = Math.max(1, bounds.maxX - bounds.minX);
  const sourceHeight = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - padding * 2) / sourceWidth, (height - padding * 2) / sourceHeight);
  const project = (x: number, y: number): { x: number; y: number } => ({ x: padding + (x - bounds.minX) * scale + (width - padding * 2 - sourceWidth * scale) / 2, y: height - padding - (y - bounds.minY) * scale - (height - padding * 2 - sourceHeight * scale) / 2 });
  const startIds = new Set(dataset.vehicles.map((vehicle) => vehicle.start_location_id));
  const endIds = new Set(dataset.vehicles.map((vehicle) => vehicle.end_location_id));
  const locations = visibleLocations.map((location) => ({ id: location.id, ...project(location.x, location.y), depotRole: startIds.has(location.id) && endIds.has(location.id) ? "BOTH" as const : startIds.has(location.id) ? "START" as const : endIds.has(location.id) ? "END" as const : null }));
  const locationsById = new Map(locations.map((location) => [location.id, location]));
  const metrics = new Map<string, RouteMetrics>(validation.route_metrics.map((metric) => [metric.vehicle_id, metric]));
  const colors = new Map(dataset.vehicles.map((vehicle, index) => [vehicle.id, palette[index % palette.length] ?? "#475569"]));
  const stopLocationCounts = new Map<string, number>();
  const routes: PreparedRoute[] = dataset.vehicles.map((vehicle) => {
    const route: VehicleRoute = result.plan?.routes.find((item) => item.vehicle_id === vehicle.id) ?? { vehicle_id: vehicle.id, stops: [] };
    const inspection = inspectRoute(dataset, route, validation.load_snapshots, metrics.get(vehicle.id));
    const points = route.stops.flatMap((stop, stopIndex) => {
      const location = locationsById.get(stop.location_id);
      if (!location) return [];
      const inspectedStop = inspection.stops[stopIndex];
      if (!inspectedStop) return [];
      const locationKey = `${vehicle.id}:${stop.location_id}`;
      const occurrence = stopLocationCounts.get(locationKey) ?? 0;
      stopLocationCounts.set(locationKey, occurrence + 1);
      const angle = occurrence * 1.9 - 0.7;
      const offset = occurrence === 0 ? 0 : 16 + occurrence * 7;
      return [{ id: `${vehicle.id}:${stopIndex}`, vehicleId: vehicle.id, stopIndex, locationId: stop.location_id, x: location.x, y: location.y, markerX: location.x + Math.cos(angle) * offset, markerY: location.y + Math.sin(angle) * offset, actions: inspectedStop.actions, travelDistanceTenthsKm: inspectedStop.travelDistanceTenthsKm, cumulativeDistanceTenthsKm: inspectedStop.cumulativeDistanceTenthsKm, travelDurationSeconds: inspectedStop.travelDurationSeconds, arrivalElapsedSeconds: inspectedStop.arrivalElapsedSeconds, departureElapsedSeconds: inspectedStop.departureElapsedSeconds }];
    });
    return { vehicleId: vehicle.id, color: colors.get(vehicle.id) ?? "#475569", actionCount: route.stops.reduce((sum, stop) => sum + stop.actions.length, 0), points, metric: metrics.get(vehicle.id), distanceIsVerified: inspection.distanceIsVerified, timeIsVerified: inspection.timeIsVerified };
  });
  return { locations, vehicles: dataset.vehicles, routes, stops: routes.flatMap((route) => route.points), colors, metrics };
}

function inspectRoute(dataset: DemoDataset, route: VehicleRoute, snapshots: LoadSnapshot[], metric: RouteMetrics | undefined): { stops: Array<{ actions: PreparedAction[]; travelDistanceTenthsKm: number; cumulativeDistanceTenthsKm: number; travelDurationSeconds: number; arrivalElapsedSeconds: number; departureElapsedSeconds: number }>; distanceIsVerified: boolean; timeIsVerified: boolean } {
  const timeline = buildSimulatedRouteTimeline({ dataset, route, snapshots, startTime: "08:00" });
  const orders = new Map(dataset.orders.map((order) => [order.id, order]));
  const machines = new Map(dataset.machines.map((machine) => [machine.id, machine]));
  const snapshotsByAction = new Map(snapshots.map((snapshot) => [`${snapshot.vehicle_id}:${snapshot.stop_index}:${snapshot.action_index}`, snapshot]));
  const onboard = new Map<string, CargoMachine>();
  let cumulativeDistanceTenthsKm = 0;
  const stops = route.stops.map((stop, stopIndex) => {
    const timedStop = timeline.stops[stopIndex]!;
    cumulativeDistanceTenthsKm += timedStop.travelDistanceTenthsKm;
    const actions = stop.actions.map((action, actionIndex) => {
      const diagnostics: string[] = [];
      const order = orders.get(action.order_id);
      const machine = order ? machines.get(order.machine_id) : undefined;
      const cargoKey = order ? `${order.id}:${order.machine_id}` : action.order_id;
      if (!order) diagnostics.push(`Nalog ${action.order_id} nije pronađen.`);
      else if (!machine) diagnostics.push(`Stroj ${order.machine_id} za nalog ${order.id} nije pronađen.`);
      else if (action.action_type === "PICKUP") {
        if (onboard.has(cargoKey)) diagnostics.push(`Stroj ${machine.id} već je u vozilu.`);
        else onboard.set(cargoKey, { orderId: order.id, machineId: machine.id, weightKg: machine.weight_kg });
      } else if (!onboard.delete(cargoKey)) diagnostics.push(`Stroj ${machine.id} nije bio u vozilu prije isporuke.`);
      const machinesAfterAction = [...onboard.values()];
      const loadKg = machinesAfterAction.reduce((total, item) => total + item.weightKg, 0);
      const snapshot = snapshotsByAction.get(`${route.vehicle_id}:${stopIndex}:${actionIndex}`);
      if (!snapshot) diagnostics.push("Nedostaje provjerena snimka tereta nakon radnje.");
      else if (snapshot.load_kg !== loadKg || snapshot.machine_count !== machinesAfterAction.length) diagnostics.push(`Rekonstruirani teret (${loadKg} kg · ${machinesAfterAction.length}) ne odgovara provjerenoj snimci (${snapshot.load_kg} kg · ${snapshot.machine_count}).`);
      const timedAction = timedStop.actions[actionIndex];
      return { action, snapshot, cargo: { machines: machinesAfterAction, loadKg, machineCount: machinesAfterAction.length, diagnostics }, serviceDurationSeconds: timedAction ? timedAction.serviceFinishSeconds - timedAction.serviceStartSeconds : 0, machineId: machine?.id, machineWeightKg: machine?.weight_kg };
    });
    return { actions, travelDistanceTenthsKm: timedStop.travelDistanceTenthsKm, cumulativeDistanceTenthsKm, travelDurationSeconds: timedStop.travelDurationSeconds, arrivalElapsedSeconds: timedStop.arrivalSeconds - timeline.startSeconds, departureElapsedSeconds: timedStop.departureSeconds - timeline.startSeconds };
  });
  const distanceIsVerified = metric === undefined || cumulativeDistanceTenthsKm === metric.distance_tenths_km;
  const timeIsVerified = metric === undefined || timeline.elapsedSeconds === metric.total_elapsed_seconds;
  return { stops, distanceIsVerified, timeIsVerified };
}
