import { NextResponse } from "next/server";

import { AuthConfigurationError, AuthenticationError, requireAuthenticatedUser } from "@/lib/auth";
import { migrateBusinessWorkspace } from "@/lib/business-workspace";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const MAX_WORKSPACE_BYTES = 2 * 1024 * 1024;

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

function authFailure(error: unknown): NextResponse | null {
  if (error instanceof AuthConfigurationError) return NextResponse.json({ error: error.message }, { status: 503 });
  if (error instanceof AuthenticationError) return NextResponse.json({ error: error.message }, { status: 401 });
  return null;
}

export async function GET(): Promise<NextResponse> {
  try {
    const user = await requireAuthenticatedUser();
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.from("planning_workspaces").select("version, workspace, updated_at").eq("owner_id", user.id).maybeSingle();
    if (error) return NextResponse.json({ error: "Radni prostor nije moguće učitati." }, { status: 502 });
    if (!data) return NextResponse.json({ workspace: null, version: 0, updated_at: null }, { headers: { "cache-control": "no-store" } });
    const workspace = migrateBusinessWorkspace(data.workspace);
    if (!workspace) return NextResponse.json({ error: "Spremljeni radni prostor nije valjan." }, { status: 502 });
    return NextResponse.json({ workspace, version: data.version, updated_at: data.updated_at }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ error: "Radni prostor nije moguće učitati." }, { status: 500 });
  }
}

export async function PUT(request: Request): Promise<NextResponse> {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Ovaj zahtjev nije prihvaćen." }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_WORKSPACE_BYTES) return NextResponse.json({ error: "Radni prostor je prevelik." }, { status: 413 });
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_WORKSPACE_BYTES) return NextResponse.json({ error: "Radni prostor je prevelik." }, { status: 413 });
    const payload: unknown = JSON.parse(raw);
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return NextResponse.json({ error: "Zahtjev za spremanje nije ispravan." }, { status: 400 });
    const { workspace: rawWorkspace, expectedVersion } = payload as { workspace?: unknown; expectedVersion?: unknown };
    const workspace = migrateBusinessWorkspace(rawWorkspace);
    if (!workspace || !Number.isInteger(expectedVersion) || (expectedVersion as number) < 0) return NextResponse.json({ error: "Radni prostor ili verzija nisu ispravni." }, { status: 400 });
    const user = await requireAuthenticatedUser();
    const supabase = await createServerSupabaseClient();
    const { data: current, error: readError } = await supabase.from("planning_workspaces").select("version").eq("owner_id", user.id).maybeSingle();
    if (readError) return NextResponse.json({ error: "Provjera verzije radnog prostora nije uspjela." }, { status: 502 });
    if (!current) {
      if (expectedVersion !== 0) return NextResponse.json({ error: "Radni prostor je promijenjen u drugoj sesiji.", code: "VERSION_CONFLICT" }, { status: 409 });
      const { data, error } = await supabase.from("planning_workspaces").insert({ owner_id: user.id, version: 1, workspace }).select("version, updated_at").single();
      if (error || !data) return NextResponse.json({ error: "Radni prostor nije moguće spremiti." }, { status: 502 });
      return NextResponse.json({ version: data.version, updated_at: data.updated_at });
    }
    if (current.version !== expectedVersion) return NextResponse.json({ error: "Radni prostor je promijenjen u drugoj sesiji.", code: "VERSION_CONFLICT", version: current.version }, { status: 409 });
    const { data, error } = await supabase.from("planning_workspaces").update({ workspace, version: current.version + 1 }).eq("owner_id", user.id).eq("version", expectedVersion).select("version, updated_at").maybeSingle();
    if (error) return NextResponse.json({ error: "Radni prostor nije moguće spremiti." }, { status: 502 });
    if (!data) return NextResponse.json({ error: "Radni prostor je promijenjen u drugoj sesiji.", code: "VERSION_CONFLICT" }, { status: 409 });
    return NextResponse.json({ version: data.version, updated_at: data.updated_at });
  } catch (error) {
    return authFailure(error) ?? NextResponse.json({ error: "Radni prostor nije moguće spremiti." }, { status: 500 });
  }
}
