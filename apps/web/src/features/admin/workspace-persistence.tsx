"use client";

import { useEffect, useRef, useState } from "react";

import { createWorkspaceBackup, parseWorkspaceBackup, restoreWorkspaceBackup, workspaceCounts, type WorkspaceBackup } from "@/lib/workspace-backup";
import { loadBusinessWorkspace, type BusinessWorkspace } from "@/lib/business-workspace";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { DemoDataset } from "@/types/optimizer-api";

type CloudWorkspace = { workspace: BusinessWorkspace | null; version: number; updated_at: string | null };

function downloadBackup(backup: WorkspaceBackup): void {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a");
  link.href = url; link.download = `up-rent-radni-prostor-${backup.exported_at.slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
}

export function WorkspacePersistence({ dataset }: { dataset: DemoDataset }) {
  const configured = isSupabaseConfigured();
  const [cloud, setCloud] = useState<CloudWorkspace | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [message, setMessage] = useState(configured ? "Provjera sigurne pohrane…" : "Lokalni demo: Supabase još nije konfiguriran.");
  const [syncEnabled, setSyncEnabled] = useState(false);
  const versionRef = useRef(0);
  const savingRef = useRef(false);

  async function loadCloud(): Promise<CloudWorkspace | null> {
    const response = await fetch("/api/workspace", { cache: "no-store" });
    if (!response.ok) { setMessage(response.status === 401 ? "Prijavite se za sigurnu pohranu." : "Sigurna pohrana trenutačno nije dostupna."); return null; }
    const payload = await response.json() as CloudWorkspace;
    versionRef.current = payload.version; setCloud(payload); return payload;
  }

  async function saveCloud(workspace: BusinessWorkspace, expectedVersion: number): Promise<boolean> {
    if (savingRef.current) return false;
    savingRef.current = true; setMessage("Spremanje u sigurnu pohranu…");
    try {
      const response = await fetch("/api/workspace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspace, expectedVersion }) });
      const payload = await response.json() as { version?: number; error?: string; code?: string };
      if (!response.ok) { setSyncEnabled(false); setMessage(payload.code === "VERSION_CONFLICT" ? "Sukob verzije: drugi preglednik je promijenio radni prostor. Ništa nije prepisano." : payload.error ?? "Spremanje nije uspjelo."); return false; }
      versionRef.current = payload.version ?? expectedVersion + 1; setCloud({ workspace, version: versionRef.current, updated_at: new Date().toISOString() }); setSyncEnabled(true); setMessage("Sigurno spremljeno."); return true;
    } finally { savingRef.current = false; }
  }

  useEffect(() => {
    if (!configured) return;
    let active = true;
    void createBrowserSupabaseClient().auth.getUser().then(({ data }) => { if (active) setEmail(data.user?.email ?? null); });
    const timer = window.setTimeout(() => { void loadCloud(); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [configured]);

  useEffect(() => {
    const onSave = (event: Event): void => { if (syncEnabled) void saveCloud((event as CustomEvent<BusinessWorkspace>).detail, versionRef.current); };
    window.addEventListener("up-rent-workspace-saved", onSave);
    return () => window.removeEventListener("up-rent-workspace-saved", onSave);
  }, [syncEnabled]);

  async function importLocalToCloud(): Promise<void> { await saveCloud(loadBusinessWorkspace(window.localStorage, dataset), versionRef.current); }
  async function mergeCloudWithLocal(): Promise<void> {
    if (!cloud?.workspace) return;
    const backup = { format: "up-rent-browser-workspace", version: 1, exported_at: new Date().toISOString(), workspace: cloud.workspace, legacy_records: {} } as const;
    const { workspace } = restoreWorkspaceBackup(window.localStorage, dataset, backup);
    window.dispatchEvent(new Event("up-rent-workspace-changed"));
    await saveCloud(workspace, cloud.version);
  }
  function restoreFile(file: File): void {
    const reader = new FileReader();
    reader.onload = () => { try { const backup = parseWorkspaceBackup(JSON.parse(String(reader.result))); const { imported } = restoreWorkspaceBackup(window.localStorage, dataset, backup); window.dispatchEvent(new Event("up-rent-workspace-changed")); setMessage(`Vraćeno bez prepisivanja: ${imported.vehicles} vozila, ${imported.orders} naloga i ${imported.runs} povijesnih pokretanja.`); } catch (error) { setMessage(error instanceof Error ? error.message : "Datoteka nije valjana."); } };
    reader.readAsText(file);
  }
  const localCounts = workspaceCounts(loadBusinessWorkspace(window.localStorage, dataset));
  return <section className="workspace-persistence" aria-label="Sigurnosna kopija i sigurna pohrana"><div><p className="eyebrow">PODACI I SIGURNOST</p><h2>Radni prostor</h2><p>{message}</p><small>{localCounts.vehicles} vozila · {localCounts.machines} strojeva · {localCounts.locations} lokacija · {localCounts.orders} naloga · {localCounts.drafts} planova · {localCounts.runs} pokretanja</small></div><div className="workspace-persistence__actions"><button type="button" className="secondary-button" onClick={() => downloadBackup(createWorkspaceBackup(window.localStorage, dataset))}>Preuzmi sigurnosnu kopiju JSON</button><label className="secondary-button">Vrati/ujedini JSON<input type="file" accept="application/json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) restoreFile(file); event.currentTarget.value = ""; }} /></label>{configured && <>{email && <small>Račun: {email}</small>}{cloud?.workspace ? <button type="button" className="primary-button" onClick={() => void mergeCloudWithLocal()}>Sigurno sjedini s cloudom</button> : <button type="button" className="primary-button" onClick={() => void importLocalToCloud()}>Potvrdi uvoz u cloud</button>}</>}</div></section>;
}
