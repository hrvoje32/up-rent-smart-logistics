import "server-only";

import {
  OptimizerContractError,
  parseDemoDataset,
  parseOptimizationResult,
  type DemoDataset,
  type OptimizerSettings,
  type OptimizationResult,
} from "@/types/optimizer-api";

const REQUEST_TIMEOUT_MS = 12_000;

export class OptimizerApiError extends Error {}

function getApiBaseUrl(): string {
  const configuredUrl = process.env.OPTIMIZER_API_URL;
  if (!configuredUrl) throw new OptimizerApiError("Lokalna usluga optimizatora nije konfigurirana.");
  try {
    const url = new URL(configuredUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Unsupported protocol");
    return url.toString().replace(/\/$/, "");
  } catch {
    throw new OptimizerApiError("Konfiguracija lokalne usluge optimizatora nije ispravna.");
  }
}

async function requestJson(path: "/api/v1/demo-case" | "/api/v1/optimize", init?: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}${path}`, { ...init, cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new OptimizerApiError("Usluga optimizatora nije dostupna ili je odbila zahtjev.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) throw new OptimizerApiError("Usluga optimizatora vratila je neispravan odgovor.");
    return await response.json();
  } catch (error) {
    if (error instanceof OptimizerApiError) throw error;
    if (error instanceof OptimizerContractError) throw new OptimizerApiError("Usluga optimizatora vratila je neispravan odgovor.");
    if (error instanceof DOMException && error.name === "AbortError") throw new OptimizerApiError("Isteklo je vrijeme za zahtjev optimizatoru.");
    throw new OptimizerApiError("Nije moguće povezati se s uslugom optimizatora.");
  } finally {
    clearTimeout(timeout);
  }
}

export async function getDemoDataset(): Promise<DemoDataset> {
  return parseDemoDataset(await requestJson("/api/v1/demo-case"));
}

export async function optimizeCanonicalDataset(): Promise<OptimizationResult> {
  const dataset = await getDemoDataset();
  return optimizeDataset(dataset);
}

export async function optimizeDataset(dataset: DemoDataset, settings: OptimizerSettings = {}): Promise<OptimizationResult> {
  return parseOptimizationResult(await requestJson("/api/v1/optimize", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dataset, settings: { time_limit_seconds: 5, ...settings } }) }));
}
