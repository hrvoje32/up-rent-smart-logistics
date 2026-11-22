import "server-only";

import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export class AuthenticationError extends Error {}
export class AuthConfigurationError extends Error {}

export interface AuthenticatedUser { id: string; email: string | null; }

export async function requireAuthenticatedUser(): Promise<AuthenticatedUser> {
  if (!isSupabaseConfigured()) throw new AuthConfigurationError("Supabase prijava nije konfigurirana.");
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new AuthenticationError("Potrebna je prijava.");
  return { id: data.user.id, email: data.user.email ?? null };
}
