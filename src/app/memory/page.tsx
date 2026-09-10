"use client";

import { useCallback, useEffect, useState } from "react";

type Memory = { id: number; kind: string; content: string; importance: number; source: string; createdAt: string };
type Conv = { id: number; title: string; createdAt: string };
type Msg = { id: number; role: string; content: string; emotion: string | null; model: string | null; createdAt: string };

const KINDS = ["fact", "preference", "goal", "event", "person"];

export default function MemoryPage() {
  const [mems, setMems] = useState<Memory[]>([]);
  const [convs, setConvs] = useState<Conv[]>([]);
  const [open, setOpen] = useState<{ id: number; msgs: Msg[] } | null>(null);
  const [draft, setDraft] = useState({ content: "", kind: "fact", importance: 3 });
  const [editId, setEditId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");

  const load = useCallback(async () => {
    const [m, c] = await Promise.all([fetch("/api/memories").then((r) => r.json()), fetch("/api/conversations").then((r) => r.json())]);
    setMems(m);
    setConvs(c);
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!draft.content.trim()) return;
    await fetch("/api/memories", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
    setDraft({ content: "", kind: "fact", importance: 3 });
    load();
  };
  const saveEdit = async (id: number) => {
    await fetch("/api/memories", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, content: editText }) });
    setEditId(null);
    load();
  };
  const del = async (id?: number) => {
    if (!id && !confirm("Wipe ALL long-term memory? This cannot be undone.")) return;
    await fetch(`/api/memories${id ? `?id=${id}` : "?all=1"}`, { method: "DELETE" });
    load();
  };
  const openConv = async (id: number) => {
    const msgs = await fetch(`/api/conversations?id=${id}`).then((r) => r.json());
    setOpen({ id, msgs });
  };
  const delConv = async (id?: number) => {
    if (!id && !confirm("Delete ALL chat history?")) return;
    await fetch(`/api/conversations${id ? `?id=${id}` : "?all=1"}`, { method: "DELETE" });
    setOpen(null);
    load();
  };

  return (
    <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-2">
      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-white">🧠 Long-term memory</h1>
            <p className="text-xs text-slate-400">Privacy mode: everything here is yours to view, edit or wipe. Stored locally in your PostgreSQL.</p>
          </div>
          <button className="btn btn-ghost text-xs text-rose-300" onClick={() => del()}>Wipe all</button>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="Teach me something: 'My exam is on 12 March', 'I love lo-fi music'…" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add()} />
          <select className="input w-32" value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
          <select className="input w-24" value={draft.importance} onChange={(e) => setDraft({ ...draft, importance: Number(e.target.value) })}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>★{n}</option>)}</select>
          <button className="btn btn-primary" onClick={add}>Remember</button>
        </div>
        <ul className="mt-4 space-y-2">
          {mems.length === 0 && <li className="text-sm text-slate-500">No memories yet. Chat naturally — I&apos;ll learn your name, likes, goals and dates automatically.</li>}
          {mems.map((m) => (
            <li key={m.id} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
              <span className="chip mt-0.5 shrink-0">{m.kind}</span>
              <div className="min-w-0 flex-1">
                {editId === m.id ? (
                  <div className="flex gap-2"><input className="input" value={editText} onChange={(e) => setEditText(e.target.value)} /><button className="btn btn-primary !py-1" onClick={() => saveEdit(m.id)}>Save</button></div>
                ) : (
                  <p className="text-slate-100">{m.content}</p>
                )}
                <p className="mt-1 text-[10px] text-slate-500">{"★".repeat(m.importance)} · {m.source} · {new Date(m.createdAt).toLocaleDateString()}</p>
              </div>
              <button className="text-xs text-slate-400 hover:text-white" onClick={() => { setEditId(m.id); setEditText(m.content); }}>Edit</button>
              <button className="text-xs text-rose-300" onClick={() => del(m.id)}>✕</button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel p-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-white">💬 Chat history</h2>
            <p className="text-xs text-slate-400">Short-term context is the last 16 turns of the active conversation.</p>
          </div>
          <button className="btn btn-ghost text-xs text-rose-300" onClick={() => delConv()}>Clear all</button>
        </div>
        {open ? (
          <div className="mt-4">
            <div className="flex items-center justify-between"><button className="text-xs text-cyan-300" onClick={() => setOpen(null)}>← Back</button><button className="text-xs text-rose-300" onClick={() => delConv(open.id)}>Delete conversation</button></div>
            <div className="mt-3 max-h-[60vh] space-y-2 overflow-y-auto">
              {open.msgs.map((m) => (
                <div key={m.id} className={`rounded-xl p-3 text-sm ${m.role === "user" ? "bg-violet-600/30" : "bg-white/5"}`}>
                  <div className="text-[10px] uppercase text-slate-500">{m.role}{m.emotion ? ` · ${m.emotion}` : ""}{m.model ? ` · ${m.model}` : ""}</div>
                  <div className="whitespace-pre-wrap text-slate-100">{m.content}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {convs.length === 0 && <li className="text-sm text-slate-500">No conversations yet.</li>}
            {convs.map((c) => (
              <li key={c.id}>
                <button className="w-full rounded-xl border border-white/10 bg-white/5 p-3 text-left text-sm hover:bg-white/10" onClick={() => openConv(c.id)}>
                  <div className="truncate text-slate-100">{c.title}</div>
                  <div className="text-[10px] text-slate-500">{new Date(c.createdAt).toLocaleString()}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
