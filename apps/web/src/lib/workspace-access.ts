import "server-only";

import { createServerSupabaseClient } from "@/lib/supabase/server";

export class WorkspaceAccessError extends Error {}

export async function requireWorkspaceAccess(ownerId: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("planning_workspaces").select("owner_id").eq("owner_id", ownerId).maybeSingle();
  if (error || !data) throw new WorkspaceAccessError("Radni prostor nije dostupan za prijavljenog korisnika.");
}
