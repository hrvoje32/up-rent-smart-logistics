"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function LoginForm({ nextPath, configured }: { nextPath: string | undefined; configured: boolean }) {
  const router = useRouter();
  const next = nextPath?.startsWith("/admin/") ? nextPath : "/admin/dashboard";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!configured) return;
    setSaving(true); setError(null);
    const { error: signInError } = await createBrowserSupabaseClient().auth.signInWithPassword({ email, password });
    setSaving(false);
    if (signInError) { setError("Prijava nije uspjela. Provjerite e-adresu i lozinku."); return; }
    router.replace(next); router.refresh();
  }
  return <main className="foundation-page"><p className="eyebrow">UP RENT · OPERATIVNI PRISTUP</p><h1>Prijava u radni prostor</h1>{configured ? <form className="auth-form" onSubmit={submit}><label>E-adresa<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Lozinka<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <p role="alert">{error}</p>}<button type="submit" disabled={saving}>{saving ? "Prijava…" : "Prijavi se"}</button></form> : <p role="alert">Supabase prijava nije konfigurirana. Dodajte javni URL i publishable ključ prije korištenja privatnog demoa.</p>}</main>;
}
