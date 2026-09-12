"use client";
import { useState } from "react";
import { Cloud, LogOut, ArrowLeft, LockKeyhole, ArrowRight, Mic, Search, FileText, Brain, Settings, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import CloudRecords, { type CloudRow } from "./CloudRecords";
import CompanionOnboarding from "./CompanionOnboarding";

const tabs = [
  { entity: "memories", label: "Memory", description: "Facts, preferences, and goals you explicitly choose to save." },
  { entity: "conversations", label: "Conversations", description: "Stored conversation records from your private workspace. Use the Jarvish assistant above to chat and then save important threads here." },
  { entity: "character_profiles", label: "Characters", description: "Character profiles for the browser experience. Local animation upgrades are optional." },
  { entity: "voice_profiles", label: "Voice", description: "Persistent voice preferences used by the web assistant and browser speech controls." },
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
  const webFeatures = [
    { href: "/", label: "Jarvish assistant", detail: "Chat, voice commands, planning, and actions", icon: Sparkles },
    { href: "/skills", label: "Skills", detail: "Research, YouTube, browser tools, and exports", icon: Search },
    { href: "/memory", label: "Memory", detail: "Review and manage what Jarvish remembers", icon: Brain },
    { href: "/docs", label: "Documents", detail: "Create and export text, PDF, and XLSX files", icon: FileText },
    { href: "/characters", label: "Characters", detail: "Configure the web character experience", icon: Mic },
    { href: "/settings", label: "Settings", detail: "Providers, voice, permissions, and BYOK", icon: Settings },
  ];
  return <div className="mx-auto max-w-5xl px-5 py-8 md:px-10">
    <header className="flex flex-wrap items-start justify-between gap-5">
      <div><p className="flex items-center gap-2 font-mono text-sm text-primary"><Cloud size={18} />JARVISH / CLOUD</p><h1 className="mt-3 text-balance text-3xl font-semibold">Your private workspace.</h1><p className="mt-2 break-all text-sm text-muted-foreground">{email}</p></div>
      <button className="btn btn-ghost" disabled={signingOut} onClick={signOut}><LogOut size={16} />{signingOut ? "Signing out…" : "Sign out"}</button>
    </header>
    {error && <p role="alert" className="mt-4 text-sm">{error}</p>}
    <div className="my-7 flex items-start gap-3 rounded-2xl border border-border bg-card p-4 text-foreground"><LockKeyhole className="mt-1 shrink-0 text-primary" size={20} /><div><p className="text-sm font-semibold text-foreground">Web workspace is ready now</p><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Chat, research, YouTube discovery, voice, memory, exports, and settings work in this browser without installing anything. The optional Windows companion adds local file, screen, microphone, and computer actions after you download and pair it.</p></div></div>
    <section className="mb-7 rounded-2xl border border-primary/25 bg-primary/5 p-5">
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="font-mono text-xs uppercase tracking-[0.2em] text-primary">Everything in the browser</p><h2 className="mt-2 text-2xl font-semibold">Use Jarvish now — no download required.</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Open any workspace below. These are the web product features. The Windows companion is optional and only adds deeper local computer access.</p></div><a href="/" className="btn btn-primary">Open assistant <ArrowRight size={16} /></a></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{webFeatures.map(({ href, label, detail, icon: Icon }) => <a key={href} href={href} className="group rounded-xl border border-border bg-background/60 p-4 transition-colors hover:border-primary/50"><div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 font-medium"><Icon size={17} className="text-primary" />{label}</span><ArrowRight size={15} className="text-muted-foreground transition-transform group-hover:translate-x-1" /></div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{detail}</p></a>)}</div>
    </section>
    <CompanionOnboarding />
    <nav aria-label="Cloud sections" className="flex flex-wrap gap-2">{tabs.map((item) => <button key={item.entity} aria-pressed={tab.entity === item.entity} onClick={() => { setTab(item); setConversation(null); }} className={`btn ${tab.entity === item.entity ? "btn-primary" : "btn-ghost"}`}>{item.label}</button>)}</nav>
    <section className="mt-7" aria-label={conversation ? "Conversation messages" : tab.label}>
      {conversation && <button className="mb-4 inline-flex items-center gap-2 text-sm text-primary" onClick={() => setConversation(null)}><ArrowLeft size={16} />All conversations</button>}
      <h2 className="text-xl font-semibold">{conversation ? String(conversation.title) : tab.label}</h2>
      <p className="mb-6 mt-2 text-sm leading-relaxed text-muted-foreground">{conversation ? "Save messages to this conversation. Cloud records are separate from the browser assistant session." : tab.description}</p>
      <CloudRecords key={conversation?.id ?? tab.entity} entity={conversation ? "messages" : tab.entity} userId={userId} conversationId={conversation?.id} onConversation={setConversation} />
    </section>
  </div>;
}
