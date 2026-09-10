"use client";

import { useState } from "react";

type Step = { title: string; status: string; detail?: string };

const EXAMPLES = [
  "Plan my 3-day trip to Goa next month",
  "Help me prepare for my physics exam next week",
  "Set up my morning: weather in Mumbai, my todos, and a motivational line",
  "Research the best budget laptops for coding and remind me to decide tomorrow",
];

export default function AgentPage() {
  const [goal, setGoal] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [status, setStatus] = useState("");
  const [route, setRoute] = useState<{ tier: string; model: string; reason: string } | null>(null);
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);

  const run = async (g: string) => {
    if (!g.trim() || running) return;
    setRunning(true);
    setSteps([]);
    setResult("");
    setStatus("Starting agent…");
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goal: g }) });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() ?? "";
        for (const p of parts) {
          if (!p.startsWith("data: ")) continue;
          const ev = JSON.parse(p.slice(6));
          if (ev.type === "route") setRoute(ev);
          else if (ev.type === "status") setStatus(ev.text);
          else if (ev.type === "plan") setSteps(ev.steps);
          else if (ev.type === "step") setSteps((s) => s.map((x, i) => (i === ev.index ? { ...x, status: ev.status, detail: ev.detail ?? x.detail } : x)));
          else if (ev.type === "final") { setResult(ev.result); setStatus("Done ✔"); }
          else if (ev.type === "error") setStatus(`Error: ${ev.error}`);
        }
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold text-white">🤖 Agent Mode</h1>
        <p className="text-sm text-slate-400">Give a multi-step goal. The agent plans, calls tools (search, weather, reminders, todos, notes), and composes the result in your character&apos;s voice — with a live progress view.</p>
      </header>

      <div className="panel p-4">
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(goal); }}>
          <input className="input" placeholder="e.g. Plan my trip to Goa" value={goal} onChange={(e) => setGoal(e.target.value)} disabled={running} />
          <button className="btn btn-primary" disabled={running || !goal.trim()}>{running ? "Running…" : "Run agent"}</button>
        </form>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((e) => <button key={e} className="chip hover:bg-white/10" onClick={() => { setGoal(e); run(e); }} disabled={running}>{e}</button>)}
        </div>
      </div>

      {(steps.length > 0 || status) && (
        <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
          <div className="panel p-4">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span className="uppercase tracking-widest">Live progress</span>
              {route && <span className="chip">{route.tier} · {route.model}</span>}
            </div>
            <p className="mt-1 text-xs text-cyan-300">{status}</p>
            <ol className="mt-3 space-y-2">
              {steps.map((s, i) => (
                <li key={i} className="rounded-xl border border-white/10 bg-black/20 p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${s.status === "done" ? "bg-emerald-500/30 text-emerald-300" : s.status === "running" ? "bg-cyan-500/30 text-cyan-200 animate-pulse" : "bg-white/10 text-slate-400"}`}>{s.status === "done" ? "✓" : s.status === "running" ? "…" : i + 1}</span>
                    <span className={s.status === "pending" ? "text-slate-400" : "text-slate-100"}>{s.title}</span>
                  </div>
                  {s.detail && <p className="mt-1 line-clamp-3 pl-7 text-xs text-slate-400">{s.detail}</p>}
                </li>
              ))}
            </ol>
          </div>
          <div className="panel p-4">
            <div className="text-xs uppercase tracking-widest text-slate-400">Result</div>
            {result ? <div className="prose-chat mt-2 whitespace-pre-wrap text-sm text-slate-100">{result}</div> : <p className="mt-2 text-sm text-slate-500">The final plan will appear here…</p>}
          </div>
        </div>
      )}
    </div>
  );
}
