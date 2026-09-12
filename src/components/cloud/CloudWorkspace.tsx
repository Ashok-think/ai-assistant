"use client";
import { useState } from "react";
import { Cloud, LogOut, ArrowLeft, LockKeyhole } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CloudRecords, { type CloudRow } from "./CloudRecords";
import CompanionOnboarding from "./CompanionOnboarding";

const tabs = [
  { entity: "memories", label: "Memory", description: "Facts, preferences, and goals you explicitly choose to save." },
  { entity: "conversations", label: "Conversations", description: "Stored conversation records. Cloud AI replies are not wired up yet." },
  { entity: "character_profiles", label: "Characters", description: "Character settings only. A real rig or talking-video backend is required for animation." },
  { entity: "voice_profiles", label: "Voice", description: "Persistent voice preferences. These are not yet connected to the local voice engine." },
  { entity: "profiles", label: "Profile", description: "Your cloud profile. No local settings are changed." },
  { entity: "audit_logs", label: "Activity", description: "Read-only database audit events. Record content and credentials are not logged." },
];
export default function CloudWorkspace({ email, userId }: { email: string; userId: string }) {
  const [tab, setTab] = useState(tabs[0]);
  const [conversation, setConversation] = useState<CloudRow | null>(null);
  const [error, setError] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true); setError("");
    try {
      const { error } = await createClient().auth.signOut({ scope: "local" });
      if (error) throw error;
      window.location.replace("/auth/login");
    } catch { setError("Sign out could not be completed. Please retry."); setSigningOut(false); }
  }
  return <div className="mx-auto max-w-5xl px-5 py-8 md:px-10">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="flex items-center gap-2 font-mono text-sm text-primary"><Cloud size={18} />JARVISH / CLOUD</p><h1 className="mt-3 text-balance text-3xl font-semibold">Your private workspace.</h1><p className="mt-2 break-all text-sm text-muted-foreground">{email}</p></div>
      <button className="btn btn-ghost" disabled={signingOut} onClick={signOut}><LogOut size={16} />{signingOut ? "Signing out…" : "Sign out"}</button>
    </header>
    {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
    <div className="my-7 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-foreground"><LockKeyhole className="mt-1 shrink-0 text-primary" size={20} /><p className="text-sm leading-relaxed text-muted-foreground">Cloud storage is separate from your local assistant. SQLite has not been imported. Device control, task execution, and automations remain disabled until their secure workflows are implemented.</p></div>
    <CompanionOnboarding />
    <nav aria-label="Cloud sections" className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.entity} aria-pressed={tab.entity === item.entity} onClick={() => { setTab(item); setConversation(null); }} className={`btn ${tab.entity === item.entity ? "btn-primary" : "btn-ghost"}`}>{item.label}</button>)}</nav>
    <section className="mt-7" aria-label={conversation ? "Conversation messages" : tab.label}>
      {conversation && <button className="mb-4 inline-flex items-center gap-2 text-sm text-primary" onClick={() => setConversation(null)}><ArrowLeft size={16} />All conversations</button>}
      <h2 className="text-xl font-semibold">{conversation ? String(conversation.title) : tab.label}</h2>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted-foreground">{conversation ? "Save messages to this conversation. No model is called, and no actions are executed." : tab.description}</p>
      <CloudRecords key={conversation?.id ?? tab.entity} entity={conversation ? "messages" : tab.entity} userId={userId} conversationId={conversation?.id} onConversation={setConversation} />
    </section>
  </div>;
}
