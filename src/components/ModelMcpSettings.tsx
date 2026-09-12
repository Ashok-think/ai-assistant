"use client";

import { useState } from "react";

type Provider = { id: string; name: string; baseUrl: string; format: string; models: string[]; connected: boolean };
type Mcp = { id: string; name: string; description: string; category: string; installed: boolean };

const starterMcps: Mcp[] = [
  { id: "browser", name: "Browser Use", description: "Search, navigate, and complete web tasks with confirmation.", category: "Productivity", installed: true },
  { id: "files", name: "Local Files", description: "Read and organize files inside your Jarvish folder.", category: "System", installed: false },
  { id: "github", name: "GitHub", description: "Issues, pull requests, repositories, and code search.", category: "Developer", installed: false },
  { id: "notion", name: "Notion", description: "Search and update pages, notes, and project databases.", category: "Productivity", installed: false },
  { id: "calendar", name: "Calendar", description: "Find availability and create events with confirmation.", category: "Productivity", installed: false },
  { id: "home", name: "Home Assistant", description: "Control connected devices only after explicit permission.", category: "Smart home", installed: false },
];

export default function ModelMcpSettings() {
  const [providers, setProviders] = useState<Provider[]>([
    { id: "gateway", name: "Vercel AI Gateway", baseUrl: "Managed by Vercel", format: "Gateway", models: ["fast", "smart"], connected: true },
  ]);
  const [selected, setSelected] = useState("gateway");
  const [draft, setDraft] = useState({ name: "", baseUrl: "", key: "", format: "OpenAI-compatible", model: "" });
  const [mcps, setMcps] = useState(starterMcps);
  const [notice, setNotice] = useState("");
  const [companion, setCompanion] = useState("Not paired");

  const active = providers.find((provider) => provider.id === selected) ?? providers[0];
  const saveProvider = async () => {
    if (!draft.name.trim() || !draft.baseUrl.trim() || !draft.model.trim()) return setNotice("Add a name, base URL, and at least one model.");
    const provider = { id: crypto.randomUUID(), name: draft.name.trim(), baseUrl: draft.baseUrl.trim(), format: draft.format, models: [draft.model.trim()], connected: Boolean(draft.key.trim()) };
    setProviders((current) => [...current, provider]);
    setSelected(provider.id);
    setDraft({ name: "", baseUrl: "", key: "", format: "OpenAI-compatible", model: "" });
    setNotice(`${provider.name} added. API keys stay masked and are never shown again.`);
  };

  const addModel = () => {
    if (!active || !draft.model.trim() || active.models.includes(draft.model.trim())) return;
    setProviders((current) => current.map((provider) => provider.id === active.id ? { ...provider, models: [...provider.models, draft.model.trim()] } : provider));
    setDraft((current) => ({ ...current, model: "" }));
  };

  return (
    <section className="panel p-4 lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-semibold uppercase tracking-widest text-slate-300">Models, providers & MCP servers</h2><p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500">Connect as many model providers and tools as you need. Secrets are masked, each tool shows its permissions, and local actions still require the Windows companion.</p></div>
        <span className={`chip ${companion === "Paired" ? "text-emerald-300" : "text-amber-300"}`}>Companion: {companion}</span>
      </div>
      <div className="grid gap-4 xl:grid-cols-[220px_1fr]">
        <div className="rounded-xl border border-white/10 bg-black/10 p-2">
          <div className="px-2 py-2 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Providers</div>
          {providers.map((provider) => <button key={provider.id} onClick={() => setSelected(provider.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${selected === provider.id ? "bg-white/10 text-white" : "text-slate-400 hover:bg-white/5"}`}><span>{provider.name}</span><span className={provider.connected ? "text-emerald-300" : "text-amber-300"}>●</span></button>)}
          <button onClick={() => setSelected("new")} className="mt-2 w-full rounded-lg border border-dashed border-white/15 px-3 py-2 text-left text-sm text-cyan-200 hover:bg-white/5">+ Add provider</button>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-black/10 p-4">
            {selected === "new" ? <>
              <h3 className="font-semibold text-slate-100">Add model provider</h3><p className="mt-1 text-xs text-slate-500">Works with OpenAI-compatible, Anthropic, Ollama, and custom endpoints.</p>
              <div className="mt-4 grid gap-3"><input className="input" placeholder="Provider name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /><input className="input" placeholder="https://api.example.com/v1" value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} /><input className="input" type="password" placeholder="API key (stored masked)" value={draft.key} onChange={(e) => setDraft({ ...draft, key: e.target.value })} /><select className="input" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })}><option>OpenAI-compatible</option><option>Anthropic messages</option><option>Ollama</option><option>Custom HTTP</option></select><input className="input" placeholder="Initial model ID" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /><button className="btn btn-primary" onClick={saveProvider}>Add provider</button></div>
            </> : <>
              <div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-100">{active?.name}</h3><p className="mt-1 text-xs text-slate-500">{active?.baseUrl}</p></div><span className="chip text-emerald-300">{active?.connected ? "Connected" : "Needs key"}</span></div>
              <div className="mt-4"><div className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-500">Model list</div><div className="flex flex-wrap gap-2">{active?.models.map((model) => <span key={model} className="chip text-cyan-200">{model}</span>)}</div><div className="mt-3 flex gap-2"><input className="input" placeholder="Add model ID" value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} /><button className="btn btn-ghost" onClick={addModel}>Add</button></div></div>
            </>}
          </div>
          <div className="rounded-xl border border-white/10 bg-black/10 p-4"><div className="flex items-center justify-between"><div><h3 className="font-semibold text-slate-100">Windows companion</h3><p className="mt-1 text-xs text-slate-500">Update the downloaded companion without replacing your Jarvish data folder.</p></div><button className="btn btn-ghost text-xs" onClick={() => setCompanion("Checking…")}>Check</button></div><div className="mt-4 grid gap-2 text-xs text-slate-400"><div className="flex justify-between rounded-lg bg-white/5 p-3"><span>Installed version</span><span className="text-slate-200">Bootstrap 0.1</span></div><div className="flex justify-between rounded-lg bg-white/5 p-3"><span>Data folder</span><span className="text-slate-200">%USERPROFILE%\\Jarvish</span></div></div><a className="btn btn-primary mt-3 inline-flex" href="/api/companion/download">Download latest setup</a></div>
        </div>
      </div>
      <div className="mt-5 border-t border-white/10 pt-4"><div className="mb-3 flex items-center justify-between"><div><h3 className="font-semibold text-slate-100">MCP server marketplace</h3><p className="mt-1 text-xs text-slate-500">Install capabilities, then review the permissions before enabling them.</p></div><span className="chip text-slate-400">{mcps.filter((mcp) => mcp.installed).length} installed</span></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{mcps.map((mcp) => <div key={mcp.id} className="rounded-xl border border-white/10 bg-black/10 p-3"><div className="flex items-start justify-between gap-2"><div><div className="font-medium text-slate-100">{mcp.name}</div><div className="mt-1 text-[10px] uppercase tracking-wider text-cyan-200">{mcp.category}</div></div><button className={`btn !px-2 !py-1 text-xs ${mcp.installed ? "btn-ghost" : "btn-primary"}`} onClick={() => { setMcps((current) => current.map((item) => item.id === mcp.id ? { ...item, installed: !item.installed } : item)); setNotice(`${mcp.name} ${mcp.installed ? "disabled" : "enabled"}.`); }}>{mcp.installed ? "Disable" : "Install"}</button></div><p className="mt-3 text-xs leading-relaxed text-slate-400">{mcp.description}</p></div>)}</div></div>
      {notice && <p className="mt-4 text-xs text-cyan-200">{notice}</p>}
    </section>
  );
}
