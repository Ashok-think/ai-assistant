"use client";

import { useState } from "react";
import useSWR from "swr";
import ArtifactExportPanel from "@/components/ArtifactExportPanel";

async function fetchList(url: string) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok || !Array.isArray(data)) throw new Error(data.error || "Could not load this local workspace.");
  return data;
}

type Skill = { id: number; key: string; name: string; description: string; category: string; enabled: boolean; builtin: boolean; requiresKey: string | null; readiness?: "guidance" | "adapted" | "blocked"; source?: string };
type Routine = { id: number; name: string; description: string; schedule: string; steps: { tool: string; args: Record<string, unknown> }[] };

export default function SkillsPage() {
  const { data: skills = [], error, mutate: refreshSkills } = useSWR<Skill[]>("/api/skills", fetchList);
  const { data: routines = [], mutate: refreshRoutines } = useSWR<Routine[]>("/api/routines", fetchList);
  const [output, setOutput] = useState<string>("");
  const [newSkill, setNewSkill] = useState({ key: "", name: "", description: "" });
  const [newRoutine, setNewRoutine] = useState({ name: "", schedule: "07:00", city: "Delhi" });

  const load = () => Promise.all([refreshSkills(), refreshRoutines()]);

  const toggle = async (s: Skill) => {
    try {
      const response = await fetch("/api/skills", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, enabled: !s.enabled }) });
      if (!response.ok) throw new Error((await response.json()).error || "Skill update failed.");
      await load();
    } catch (error) { setOutput(error instanceof Error ? error.message : "Skill update failed."); }
  };
  const addSkill = async () => {
    if (!newSkill.key || !newSkill.name) return;
    await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newSkill) });
    setNewSkill({ key: "", name: "", description: "" });
    load();
  };
  const runRoutine = async (r: Routine) => {
    setOutput(`Running ${r.name}…`);
    const j = await fetch("/api/routines", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ run: true, id: r.id }) }).then((x) => x.json());
    setOutput(j.summary ?? JSON.stringify(j));
  };
  const addRoutine = async () => {
    if (!newRoutine.name) return;
    await fetch("/api/routines", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newRoutine.name, schedule: newRoutine.schedule, description: "Custom routine", steps: [{ tool: "get_weather", args: { city: newRoutine.city } }, { tool: "list_reminders", args: {} }, { tool: "list_todos", args: {} }, { tool: "tell_joke", args: {} }] }),
    });
    setNewRoutine({ name: "", schedule: "07:00", city: "Delhi" });
    load();
  };
  const delRoutine = async (id: number) => { await fetch(`/api/routines?id=${id}`, { method: "DELETE" }); load(); };

  const cats = Array.from(new Set(skills.map((s) => s.category)));

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Skills & routines</h1>
        <p className="text-sm text-muted-foreground">Local workspace abilities. Reviewed guidance is not a completed task; adapted tools use the existing execution policy. Unavailable runtimes cannot be enabled.</p>
        {error && <p role="alert" className="text-sm text-muted-foreground">{error.message}</p>}
      </header>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="space-y-4">
          {cats.map((cat) => (
            <div key={cat} className="panel p-4">
              <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">{cat}</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {skills.filter((s) => s.category === cat).map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-100">{s.name} {!s.builtin && <span className="chip">custom</span>}</div>
                      <div className="text-xs text-slate-400">{s.description}</div>
                      {s.readiness && <p className="text-sm text-primary">{s.readiness === "blocked" ? "Runtime unavailable" : s.readiness === "guidance" ? "Reviewed guidance" : "Adapted tool"}</p>}
                      {s.source && <p className="break-words text-sm text-muted-foreground">Source: {s.source}</p>}
                      {s.requiresKey && !s.readiness && <div className="text-sm text-muted-foreground">Requires {s.requiresKey}</div>}
                    </div>
                    <button role="switch" aria-label={`${s.name} enabled`} aria-checked={s.enabled} disabled={s.readiness === "blocked"} onClick={() => toggle(s)} className={`btn min-w-16 !px-2 ${s.enabled ? "btn-primary" : "btn-ghost"}`}>
                      {s.readiness === "blocked" ? "Locked" : s.enabled ? "On" : "Off"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="panel p-4">
            <div className="mb-2 text-xs uppercase tracking-widest text-slate-400">Add a plugin (manifest)</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="input" placeholder="key e.g. notion" value={newSkill.key} onChange={(e) => setNewSkill({ ...newSkill, key: e.target.value })} />
              <input className="input" placeholder="Name" value={newSkill.name} onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })} />
              <input className="input" placeholder="Description" value={newSkill.description} onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })} />
            </div>
            <button className="btn btn-primary mt-2" onClick={addSkill}>Register plugin</button>
            <p className="mt-2 text-[11px] text-slate-500">Registering a plugin adds it to the store; implement its tool in <code>src/lib/tools.ts</code> with the same <code>skillKey</code> to wire it into function calling.</p>
          </div>
        </section>

        <section className="flex flex-col gap-4">
          <ArtifactExportPanel enabled={skills.some((skill) => skill.key === "document_export" && skill.enabled)} />
          <div className="panel p-4">
            <div className="mb-2 text-sm uppercase tracking-widest text-muted-foreground">Routines</div>
            <ul className="space-y-2">
              {routines.map((r) => (
                <li key={r.id} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <div><div className="text-sm font-medium text-slate-100">{r.name} <span className="chip">{r.schedule || "manual"}</span></div><div className="text-xs text-slate-400">{r.description}</div></div>
                    <div className="flex gap-1"><button className="btn btn-primary !py-1 text-xs" onClick={() => runRoutine(r)}>▶ Run</button><button className="btn btn-ghost !py-1 text-xs text-rose-300" onClick={() => delRoutine(r.id)}>✕</button></div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1 text-[10px]">{r.steps.map((s, i) => <span key={i} className="chip">{s.tool}</span>)}</div>
                </li>
              ))}
            </ul>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <input className="input" placeholder="Routine name" value={newRoutine.name} onChange={(e) => setNewRoutine({ ...newRoutine, name: e.target.value })} />
              <input className="input" type="time" value={newRoutine.schedule} onChange={(e) => setNewRoutine({ ...newRoutine, schedule: e.target.value })} />
              <input className="input" placeholder="City" value={newRoutine.city} onChange={(e) => setNewRoutine({ ...newRoutine, city: e.target.value })} />
            </div>
            <button className="btn btn-ghost mt-2" onClick={addRoutine}>＋ Create routine</button>
          </div>
          {output && (
            <div className="panel p-4">
              <div className="mb-1 text-xs uppercase tracking-widest text-slate-400">Routine output</div>
              <pre className="whitespace-pre-wrap text-sm text-slate-100">{output}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
