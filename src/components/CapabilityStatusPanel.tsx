"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((response) => response.json());

type Capability = { key: string; label: string; ready: boolean; status: string; detail: string };
type Status = { capabilities: Capability[]; providers: Record<string, boolean>; providerStatus: Record<string, { status: string; configured: boolean }>; recentTtsMetrics: { provider: string; ok: boolean; timeToFirstAudioMs: number | null; totalAudioLatencyMs: number }[] };

export default function CapabilityStatusPanel() {
  const { data, error, isLoading, mutate } = useSWR<Status>("/api/capabilities", fetcher, { revalidateOnFocus: false });
  return <section className="panel p-4" aria-labelledby="capability-status-heading">
    <div className="flex items-center justify-between gap-3">
      <div><h2 id="capability-status-heading" className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Capability status</h2><p className="mt-1 text-xs text-muted-foreground">Routing uses these live states and falls back safely when a provider is unavailable.</p></div>
      <button className="btn btn-ghost !py-1 text-xs" onClick={() => mutate()} disabled={isLoading}>{isLoading ? "Checking…" : "Refresh"}</button>
    </div>
    {error && <p role="alert" className="mt-3 text-sm text-rose-300">Could not load capability status.</p>}
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {(data?.capabilities ?? []).map((capability) => <div key={capability.key} className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"><div><div className="text-sm text-foreground">{capability.label}</div><div className="text-xs text-muted-foreground">{capability.detail}</div></div><span className={`chip shrink-0 ${capability.ready ? "text-emerald-300" : "text-amber-300"}`}>{capability.status}</span></div>)}
    </div>
    {data?.recentTtsMetrics?.length ? <div className="mt-4"><div className="text-xs uppercase tracking-widest text-muted-foreground">Measured TTS latency</div><div className="mt-2 flex flex-wrap gap-2">{data.recentTtsMetrics.slice(0, 4).map((metric, index) => <span className="chip" key={`${metric.provider}-${index}`}>{metric.provider}: {metric.ok ? `${metric.timeToFirstAudioMs ?? metric.totalAudioLatencyMs}ms first audio` : "fallback"}</span>)}</div></div> : null}
  </section>;
}
