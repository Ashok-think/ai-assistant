"use client";

import { Check, ChevronDown, CircleAlert, Clock3, FileText, Globe2, Mail, Monitor, MousePointer2, Search, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ActionState } from "@/lib/client-actions";

const ICON: Record<ActionState["action"]["kind"], typeof Globe2> = {
  open_url: Globe2,
  compose_message: Mail,
  capture_screen: Monitor,
  clipboard: MousePointer2,
  download_artifact: FileText,
};

function friendlyLabel(action: ActionState["action"]) {
  const label = action.label.toLowerCase();
  if (label.includes("search") || label.includes("find")) return "Explored the web";
  if (action.kind === "open_url") return "Opened a website";
  if (action.kind === "compose_message") return "Prepared a message";
  if (action.kind === "capture_screen") return "Read the screen";
  if (action.kind === "clipboard") return "Updated the clipboard";
  if (action.kind === "download_artifact") return "Created a file";
  return "Completed a task";
}

function statusLabel(status: ActionState["status"]) {
  if (status === "running") return "Working";
  if (status === "pending") return "Waiting for approval";
  if (status === "failed") return "Needs attention";
  return "Done";
}

export default function ActionTimeline({
  actions,
  onRetry,
  onDismiss,
}: {
  actions: ActionState[];
  onRetry: (a: ActionState) => void;
  onDismiss: (id: string) => void;
}) {
  const [debugOpen, setDebugOpen] = useState(false);
  const completed = actions.filter((a) => a.status === "done").length;
  const visible = useMemo(() => [...actions].reverse(), [actions]);
  if (!actions.length) return null;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-border/80 bg-background/70 shadow-sm" aria-label="Assistant activity">
      <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-primary" aria-hidden="true" />
          <span className="text-sm font-medium text-foreground">What I did</span>
        </div>
        <span className="text-xs text-muted-foreground">{completed}/{actions.length} complete</span>
      </div>
      <ol className="divide-y divide-border/50">
        {visible.map((item) => {
          const Icon = ICON[item.action.kind] ?? Search;
          const failed = item.status === "failed";
          return (
            <li key={item.id} className="flex gap-3 px-4 py-3">
              <div className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full ${failed ? "bg-destructive/10 text-destructive" : item.status === "done" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                {item.status === "done" ? <Check size={14} /> : failed ? <CircleAlert size={14} /> : item.status === "running" ? <Clock3 size={14} className="animate-pulse" /> : <Icon size={14} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm text-foreground">{friendlyLabel(item.action)}</p>
                  <time className="shrink-0 text-[11px] text-muted-foreground" dateTime={new Date(item.at).toISOString()}>{new Date(item.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                </div>
                <p className={`mt-0.5 text-xs ${failed ? "text-destructive" : "text-muted-foreground"}`}>{failed ? item.detail || "This step could not be completed." : statusLabel(item.status)}</p>
                {(item.status === "pending" || failed) && (item.action.kind === "open_url" || item.action.kind === "compose_message" || item.action.kind === "download_artifact") && <button className="mt-2 rounded-lg border border-border px-2.5 py-1 text-xs text-foreground hover:bg-muted" onClick={() => onRetry(item)}>{item.action.kind === "download_artifact" ? "Download" : "Try again"}</button>}
              </div>
              <button className="self-start text-muted-foreground hover:text-foreground" onClick={() => onDismiss(item.id)} aria-label="Dismiss activity"><X size={14} /></button>
            </li>
          );
        })}
      </ol>
      <div className="border-t border-border/50 px-4 py-2">
        <button className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setDebugOpen((open) => !open)} aria-expanded={debugOpen}>
          <ChevronDown size={13} className={debugOpen ? "rotate-180" : ""} /> Technical details
        </button>
        {debugOpen && <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded-lg bg-muted/60 p-2 text-[10px] text-muted-foreground">{actions.map((item) => `${item.action.kind}: ${item.action.label} — ${item.status}${item.detail ? ` — ${item.detail}` : ""}`).join("\n")}</pre>}
      </div>
    </section>
  );
}
