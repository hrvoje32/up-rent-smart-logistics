import { NextResponse } from "next/server";

import { getDemoDataset, OptimizerApiError, optimizeDataset } from "@/lib/optimizer-api";
import { OptimizerContractError, parseDemoDataset, type OptimizerSettings } from "@/types/optimizer-api";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new OptimizerContractError("Zahtjev optimizacije nije ispravan.");
  return value as Record<string, unknown>;
}

function parseSettings(value: unknown): OptimizerSettings {
  if (value === undefined) return {};
  const settings = asRecord(value);
  const strategy = settings.optimization_strategy;
  const requireAllSelectedVehicles = settings.require_all_selected_vehicles;
  if (strategy !== undefined && strategy !== "FASTEST_DELIVERY" && strategy !== "BALANCED" && strategy !== "DISTANCE_SAVINGS") throw new OptimizerContractError("Strategija optimizacije nije ispravna.");
  if (requireAllSelectedVehicles !== undefined && typeof requireAllSelectedVehicles !== "boolean") throw new OptimizerContractError("Postavka vozila nije ispravna.");
  return { optimization_strategy: strategy, require_all_selected_vehicles: requireAllSelectedVehicles };
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Optimizacija je dostupna samo u lokalnom demonstracijskom okruženju." }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Ovaj zahtjev nije prihvaćen." }, { status: 403 });
  }

  try {
    const raw: unknown = await request.json().catch(() => null);
    const payload = raw === null ? null : asRecord(raw);
    const dataset = payload === null ? undefined : payload.dataset === undefined ? parseDemoDataset(payload) : parseDemoDataset(payload.dataset);
    const settings = payload === null ? {} : parseSettings(payload.settings);
    const result = await optimizeDataset(dataset ?? await getDemoDataset(), settings);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof OptimizerApiError ? error.message : "Zahtjev optimizatoru nije moguće dovršiti.";
    const status = message.includes("Isteklo") ? 504 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
