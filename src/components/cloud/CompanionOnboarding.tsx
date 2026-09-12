"use client";

import { useState } from "react";
import { Check, ChevronRight, Download, FolderLock, Laptop, ShieldCheck, Smartphone, Wifi } from "lucide-react";

const permissions = [
  { id: "microphone", label: "Microphone", detail: "Voice commands and hands-free mode." },
  { id: "files", label: "Jarvish folder", detail: "A dedicated folder for notes, exports, and approved files." },
  { id: "browser", label: "Browser control", detail: "Open and navigate tabs only after you approve an action." },
  { id: "screen", label: "Screen reading", detail: "Let Jarvish inspect a selected window when you ask." },
] as const;

const skills = [
  ["Web search", "Cloud", "Search the web and summarize sources."],
  ["YouTube finder", "Cloud + local", "Find videos and open the chosen result."],
  ["Notes and memory", "Local", "Save only what you explicitly ask Jarvish to remember."],
  ["Screen reader", "Local", "Describe a selected window and help correct what it sees."],
  ["File organizer", "Local", "Create, rename, and sort files inside the Jarvish folder."],
  ["Reminders", "Cloud", "Schedule reminders that sync across signed-in devices."],
];

export default function CompanionOnboarding() {
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return (
    <section className="mb-8 overflow-hidden rounded-3xl border border-primary/25 bg-card shadow-[0_24px_80px_rgba(34,211,238,0.08)]">
      <div className="border-b border-border bg-primary/[0.06] p-6 md:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="max-w-2xl">
            <div className="mb-3 flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-primary"><Laptop size={15} /> Windows companion</div>
            <h2 className="text-balance text-2xl font-semibold md:text-3xl">Make Jarvish useful on your computer.</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">Start in the browser with no commands or installation. Chat, research, YouTube discovery, voice, memory, exports, and settings are ready now. Download the Windows companion only when you want local microphone, screen, browser, and file actions.</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-400/25 px-3 py-1.5 text-xs text-emerald-300"><Wifi size={14} /> Web ready — no install</div>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <a className="btn btn-primary" href="/download"><Download size={16} />Download for Windows</a>
          <button className="btn btn-ghost" onClick={() => setNotice("Android support is planned after the Windows companion foundation.")}><Smartphone size={16} />Android later</button>
        </div>
        {notice && <p role="status" className="mt-4 text-sm text-primary">{notice}</p>}
      </div>
      <div className="grid gap-6 p-6 md:grid-cols-[1fr_1.15fr] md:p-8">
        <div>
          <div className="mb-4 flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /><h3 className="font-semibold">Choose permissions</h3></div>
          <p className="mb-4 text-sm leading-relaxed text-muted-foreground">Nothing is enabled silently. Choose access now, revoke it later, and Jarvish will ask again before sensitive actions.</p>
          <div className="flex flex-col gap-2">
            {permissions.map((permission) => {
              const active = selected.includes(permission.id);
              return <button key={permission.id} type="button" aria-pressed={active} onClick={() => toggle(permission.id)} className={`flex items-start gap-3 rounded-2xl border p-3 text-left transition ${active ? "border-primary/60 bg-primary/[0.08]" : "border-border bg-background/30 hover:border-primary/30"}`}>
                <span className={`mt-0.5 grid size-5 place-items-center rounded-md border ${active ? "border-primary bg-primary text-background" : "border-border"}`}>{active && <Check size={13} />}</span>
                <span className="min-w-0"><span className="block text-sm font-medium">{permission.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{permission.detail}</span></span>
              </button>;
            })}
          </div>
          <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><FolderLock size={14} /> Stored in a separate Jarvish folder.</div>
        </div>
        <div>
          <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-semibold">Useful skills</h3><p className="mt-1 text-xs text-muted-foreground">Every skill shows where it runs.</p></div><ChevronRight size={18} className="text-muted-foreground" /></div>
          <div className="grid gap-2 sm:grid-cols-2">
            {skills.map(([name, location, detail]) => <article key={name} className="rounded-2xl border border-border bg-background/30 p-3"><div className="flex items-start justify-between gap-2"><h4 className="text-sm font-medium">{name}</h4><span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">{location}</span></div><p className="mt-2 text-xs leading-relaxed text-muted-foreground">{detail}</p></article>)}
          </div>
          <div className="mt-4 rounded-2xl border border-border bg-background/30 p-4 text-xs leading-relaxed text-muted-foreground"><strong className="text-foreground">Correction learning:</strong> Jarvish can remember a correction only after you confirm it. It never silently records your screen, microphone, or files.</div>
        </div>
      </div>
    </section>
  );
}
