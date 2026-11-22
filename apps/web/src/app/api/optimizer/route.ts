import { NextResponse } from "next/server";

import { getDemoDataset, OptimizerApiError, optimizeDataset } from "@/lib/optimizer-api";
import { AuthConfigurationError, AuthenticationError, requireAuthenticatedUser } from "@/lib/auth";
import { requireWorkspaceAccess, WorkspaceAccessError } from "@/lib/workspace-access";
import { assertOptimizerRateLimit, OptimizerRateLimitError } from "@/lib/optimizer-rate-limit";

const MAX_OPTIMIZER_REQUEST_BYTES = 256 * 1024;
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
    try {
      const user = await requireAuthenticatedUser();
      await requireWorkspaceAccess(user.id);
      assertOptimizerRateLimit(user.id);
    } catch (error) {
      const status = error instanceof AuthConfigurationError ? 503 : error instanceof AuthenticationError ? 401 : error instanceof WorkspaceAccessError ? 403 : error instanceof OptimizerRateLimitError ? 429 : 503;
      return NextResponse.json({ error: status === 401 ? "Potrebna je prijava." : status === 403 ? "Nemate pristup radnom prostoru." : "Sigurna optimizacija nije konfigurirana." }, { status });
    }
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Ovaj zahtjev nije prihvaćen." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_OPTIMIZER_REQUEST_BYTES) return NextResponse.json({ error: "Zahtjev optimizacije je prevelik." }, { status: 413 });

  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_OPTIMIZER_REQUEST_BYTES) return NextResponse.json({ error: "Zahtjev optimizacije je prevelik." }, { status: 413 });
    const raw: unknown = JSON.parse(text);
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
