import {
  BUSINESS_WORKSPACE_BACKUP_KEY,
  loadBusinessWorkspace,
  migrateBusinessWorkspace,
  saveBusinessWorkspace,
  type BusinessWorkspace,
} from "@/lib/business-workspace";
import { SAVED_PLAN_STORAGE_KEY, SCENARIO_STORAGE_KEY } from "@/lib/planning-scenarios";
import type { DemoDataset } from "@/types/optimizer-api";

export const WORKSPACE_BACKUP_FORMAT = "up-rent-browser-workspace";
export const WORKSPACE_BACKUP_VERSION = 1;

export interface WorkspaceBackup {
  format: typeof WORKSPACE_BACKUP_FORMAT;
  version: typeof WORKSPACE_BACKUP_VERSION;
  exported_at: string;
  workspace: BusinessWorkspace;
  legacy_records: Record<string, string | null>;
}

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }

export interface WorkspaceCounts { vehicles: number; machines: number; locations: number; orders: number; drafts: number; runs: number; }

export function workspaceCounts(workspace: BusinessWorkspace): WorkspaceCounts {
  return { vehicles: workspace.vehicles.length, machines: workspace.machines.length, locations: workspace.locations.length, orders: workspace.orders.length, drafts: workspace.drafts.length, runs: workspace.runs.length };
}

export function createWorkspaceBackup(storage: StorageLike, dataset: DemoDataset): WorkspaceBackup {
  return {
    format: WORKSPACE_BACKUP_FORMAT,
    version: WORKSPACE_BACKUP_VERSION,
    exported_at: new Date().toISOString(),
    workspace: structuredClone(loadBusinessWorkspace(storage, dataset)),
    legacy_records: {
      [BUSINESS_WORKSPACE_BACKUP_KEY]: storage.getItem(BUSINESS_WORKSPACE_BACKUP_KEY),
      [SCENARIO_STORAGE_KEY]: storage.getItem(SCENARIO_STORAGE_KEY),
      [SAVED_PLAN_STORAGE_KEY]: storage.getItem(SAVED_PLAN_STORAGE_KEY),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function parseWorkspaceBackup(value: unknown): WorkspaceBackup {
  const backup = record(value);
  if (!backup || backup.format !== WORKSPACE_BACKUP_FORMAT || backup.version !== WORKSPACE_BACKUP_VERSION || typeof backup.exported_at !== "string" || !migrateBusinessWorkspace(backup.workspace)) throw new Error("Datoteka sigurnosne kopije nije valjana ili nije podržane verzije.");
  const legacy = record(backup.legacy_records);
  if (!legacy || Object.values(legacy).some((item) => item !== null && typeof item !== "string")) throw new Error("Sigurnosna kopija sadrži neispravne dodatne zapise.");
  const workspace = migrateBusinessWorkspace(backup.workspace);
  if (!workspace) throw new Error("Sigurnosna kopija sadrži neispravan radni prostor.");
  return { format: WORKSPACE_BACKUP_FORMAT, version: WORKSPACE_BACKUP_VERSION, exported_at: backup.exported_at, workspace, legacy_records: legacy as Record<string, string | null> };
}

function mergeById<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const existing = new Set(current.map((item) => item.id));
  return [...current, ...incoming.filter((item) => !existing.has(item.id)).map((item) => structuredClone(item))];
}

/** Imports only records with new stable IDs; existing browser records are never overwritten. */
export function restoreWorkspaceBackup(storage: StorageLike, dataset: DemoDataset, backupValue: unknown): { workspace: BusinessWorkspace; imported: WorkspaceCounts } {
  const backup = parseWorkspaceBackup(backupValue);
  const current = loadBusinessWorkspace(storage, dataset);
  const incoming = backup.workspace;
  const merged: BusinessWorkspace = {
    schema_version: current.schema_version,
    vehicles: mergeById(current.vehicles, incoming.vehicles),
    machine_types: mergeById(current.machine_types, incoming.machine_types),
    machines: mergeById(current.machines, incoming.machines),
    locations: mergeById(current.locations, incoming.locations),
    orders: mergeById(current.orders, incoming.orders),
    drafts: mergeById(current.drafts, incoming.drafts),
    runs: mergeById(current.runs, incoming.runs),
  };
  const before = workspaceCounts(current);
  saveBusinessWorkspace(storage, merged);
  storage.setItem(`${BUSINESS_WORKSPACE_BACKUP_KEY}.import.${Date.now()}`, JSON.stringify(backup));
  const after = workspaceCounts(merged);
  return { workspace: merged, imported: { vehicles: after.vehicles - before.vehicles, machines: after.machines - before.machines, locations: after.locations - before.locations, orders: after.orders - before.orders, drafts: after.drafts - before.drafts, runs: after.runs - before.runs } };
}
