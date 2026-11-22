"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "@/lib/supabase/config";

export function createBrowserSupabaseClient() {
  const config = getSupabasePublicConfig();
  if (!config) throw new Error("Supabase prijava nije konfigurirana.");
  return createBrowserClient(config.url, config.publishableKey);
}
