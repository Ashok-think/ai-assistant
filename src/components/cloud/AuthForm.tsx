"use client";
import { useState, type FormEvent } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function AuthForm({ confirmationFailed }: { confirmationFailed: boolean }) {
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(confirmationFailed ? "That confirmation link could not be verified. Open the latest link in the browser where you signed up." : "");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const email = String(fields.get("email") ?? "").trim();
    const password = String(fields.get("password") ?? "");
    setBusy(true); setMessage("");
    try {
      const supabase = createClient();
      const result = signup
        ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: process.env.NEXT_PUBLIC_DEV_SUPABASE_REDIRECT_URL ?? `${window.location.origin}/auth/callback` } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) {
        const code = result.error.code;
        setMessage(code === "email_not_confirmed" ? "Confirm your email before signing in." : code === "weak_password" ? "Choose a stronger password with at least 12 characters." : result.error.status === 429 ? "Too many attempts. Please wait before trying again." : ["invalid_credentials", "user_already_exists", "email_exists"].includes(code ?? "") ? "Unable to sign in or create this account. Check your details or try signing in." : "Authentication could not be completed. Check your email address and try again later.");
      } else if (result.data.session) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Discard router and SWR caches when the signed-in identity changes.
        window.location.assign("/cloud");
      } else {
        setMessage("If this address is eligible, a confirmation email is on its way. Open it in this browser, then sign in. No cloud data is saved until you have a session.");
      }
    } catch { setMessage("The authentication service is unavailable. Please try again."); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto w-full max-w-md py-12">
    <div className="mb-8 flex items-center gap-3 text-primary"><ShieldCheck size={24} /><span className="font-mono text-sm">JARVISH / CLOUD</span></div>
    <h1 className="text-balance text-3xl font-semibold">{signup ? "Your own private workspace." : "Welcome back."}</h1>
    <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">Sign in to your cloud account. Your existing local assistant and SQLite data stay separate.</p>
    <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
      <label className="flex flex-col gap-2 text-sm">Email<input className="input" name="email" type="email" autoComplete="email" required maxLength={254} disabled={busy} /></label>
      <label className="flex flex-col gap-2 text-sm">Password<input className="input" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={signup ? 12 : 1} maxLength={128} required disabled={busy} /></label>
      {signup && <p className="text-sm text-muted-foreground">Use at least 12 characters. Email confirmation is required.</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Connecting…" : signup ? "Create account" : "Sign in"}<ArrowRight size={16} /></button>
      {message && <p role="status" className="rounded-xl border border-border p-4 text-sm leading-relaxed">{message}</p>}
    </form>
    <button className="mt-6 text-sm text-primary underline underline-offset-4" disabled={busy} onClick={() => { setSignup(!signup); setMessage(""); }}>{signup ? "Already have an account? Sign in" : "New here? Create an account"}</button>
    <p className="mt-10 text-sm leading-relaxed text-muted-foreground">Cloud foundation only. Devices, automations, and task execution are not enabled by signing in.</p>
  </section>;
}
