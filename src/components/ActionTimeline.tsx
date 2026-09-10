"use client";

import type { ActionState } from "@/lib/client-actions";

const DOT: Record<ActionState["status"], string> = {
  running: "bg-cyan-300 animate-pulse",
  done: "bg-emerald-400",
  failed: "bg-rose-400",
  pending: "bg-amber-300 animate-pulse",
};

const ICON: Record<ActionState["action"]["kind"], string> = {
  open_url: "🌐",
  compose_message: "✉️",
  capture_screen: "🖥️",
  clipboard: "📋",
};

/**
 * What the assistant actually did in the browser, as it happens.
 *
 * The "tap to open" button matters more than it looks: a popup opened from an async stream has
 * lost user activation, so the browser blocks it. Rather than silently failing, the blocked action
 * lands here with a button that carries a fresh click.
 */
export default function ActionTimeline({
  actions,
  onRetry,
  onDismiss,
}: {
  actions: ActionState[];
  onRetry: (a: ActionState) => void;
  onDismiss: (id: string) => void;
}) {
  if (!actions.length) return null;
  return (
    <div className="mt-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.04] p-2.5">
      <div className="mb-1.5 flex items-center justify-between text-[10px] uppercase tracking-[0.2em] text-cyan-300/80">
        <span>Action timeline</span>
        <span className="text-slate-500">{actions.filter((a) => a.status === "done").length}/{actions.length} done</span>
      </div>
      <ul className="space-y-1.5">
        {actions.map((a) => (
          <li key={a.id} className="anim-fade-up flex items-start gap-2 text-xs">
            <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${DOT[a.status]}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span>{ICON[a.action.kind]}</span>
                <span className="truncate font-medium text-slate-200">{a.action.label}</span>
                <span className="ml-auto flex-none text-[10px] text-slate-500">
                  {new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              {a.detail && <p className={`mt-0.5 break-words ${a.status === "failed" ? "text-rose-300/90" : "text-slate-400"}`}>{a.detail}</p>}
              {(a.status === "pending" || a.status === "failed") && (a.action.kind === "open_url" || a.action.kind === "compose_message") && (
                <button className="btn btn-ghost mt-1 !px-2.5 !py-1 text-[11px]" onClick={() => onRetry(a)}>
                  ↗ Open it now
                </button>
              )}
            </div>
            <button className="flex-none text-slate-600 hover:text-slate-300" onClick={() => onDismiss(a.id)} aria-label="Dismiss action">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
