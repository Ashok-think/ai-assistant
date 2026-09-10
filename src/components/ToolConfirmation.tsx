"use client";

import type { ClientAction } from "@/lib/actions";

/**
 * Consent gate for actions the allowlist doesn't cover.
 *
 * The server has no authentication, so anything that reaches it can ask the browser to navigate
 * somewhere. For known-good hosts that is fine; for everything else a human confirms first. The
 * full URL is shown unshortened on purpose — the hostname is the thing being decided.
 */
export default function ToolConfirmation({
  action,
  onAllow,
  onDeny,
}: {
  action: ClientAction | null;
  onAllow: () => void;
  onDeny: () => void;
}) {
  if (!action) return null;
  const url = action.kind === "open_url" ? action.url : action.kind === "compose_message" ? action.url : "";
  let host = "";
  try {
    host = url ? new URL(url).hostname : "";
  } catch {
    host = url;
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="panel anim-fade-up w-full max-w-md p-5">
        <div className="text-[10px] uppercase tracking-[0.25em] text-amber-300/90">Confirm action</div>
        <h2 id="confirm-title" className="mt-1 text-lg font-semibold text-slate-100">
          Open {host || "this link"}?
        </h2>
        <p className="mt-2 text-sm text-slate-400">
          This site isn&apos;t on the trusted list, so I won&apos;t open it without your say-so.
        </p>
        <div className="mt-3 break-all rounded-xl border border-white/10 bg-black/40 p-2.5 font-mono text-[11px] text-cyan-200">{url}</div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={onDeny} autoFocus>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onAllow}>
            Open it
          </button>
        </div>
      </div>
    </div>
  );
}
