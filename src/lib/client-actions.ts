"use client";

/**
 * CLIENT ACTION EXECUTOR
 *
 * The other half of `lib/actions.ts`. The server decides what should happen; this runs it in the
 * browser and reports back. Everything here is best-effort by design — a browser can refuse to
 * open a tab, refuse clipboard access, or have the user cancel a screen picker, and each of those
 * is a normal outcome that the assistant should be told about rather than a crash.
 */

import { isAllowedUrl, type ClientAction } from "./actions";

export type ActionState = {
  id: string;
  action: ClientAction;
  /** pending → waiting for the user (blocked popup, or an off-allowlist host needing a tap). */
  status: "running" | "done" | "failed" | "pending";
  detail: string;
  at: number;
};

/**
 * Popups only open while the page still has "user activation" — the click that sent the message.
 * A streamed reply can take seconds, by which time the activation is gone and `window.open`
 * returns null. That is not an error to hide: we surface a one-tap card in the timeline instead.
 */
function openTab(url: string): { ok: boolean; detail: string } {
  try {
    const w = window.open(url, "_blank", "noopener,noreferrer");
    if (!w) return { ok: false, detail: "Browser blocked the popup — tap the card to open it." };
    return { ok: true, detail: `Opened ${new URL(url).hostname.replace(/^www\./, "")}` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "could not open" };
  }
}

/** Grab a single frame of a display/window the user picks, as a JPEG data URL. */
async function grabScreenFrame(): Promise<string> {
  const md = navigator.mediaDevices as MediaDevices & { getDisplayMedia?: (c: DisplayMediaStreamOptions) => Promise<MediaStream> };
  if (!md?.getDisplayMedia) throw new Error("this browser can't share a screen");
  const stream = await md.getDisplayMedia({ video: { frameRate: 1 }, audio: false });
  try {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    // One frame can be black if we snapshot before the compositor has painted.
    await new Promise((r) => setTimeout(r, 350));
    const s = track.getSettings();
    const w = Math.min(s.width ?? video.videoWidth ?? 1280, 1600);
    const h = Math.round((w / (video.videoWidth || w)) * (video.videoHeight || 900));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h || 900;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;
    return canvas.toDataURL("image/jpeg", 0.72);
  } finally {
    for (const t of stream.getTracks()) t.stop(); // always drop the capture, even on failure
  }
}

/**
 * Perform one action. `confirm` is called for anything that needs the user's blessing (an
 * off-allowlist host); returning false cancels without an error.
 */
export async function performAction(
  action: ClientAction,
  opts: { confirm?: (a: ClientAction) => Promise<boolean>; userInitiated?: boolean } = {},
): Promise<{ ok: boolean; detail: string; needsTap?: boolean; screenshot?: string }> {
  switch (action.kind) {
    case "download_artifact": {
      if (!opts.userInitiated) return { ok: false, needsTap: true, detail: "Review this document, then tap Download. No file has been generated yet." };
      try {
        const response = await fetch("/api/files/export", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: action.title, format: action.format, content: action.content }), signal: AbortSignal.timeout(30000) });
        if (!response.ok) { const error = await response.json(); return { ok: false, detail: error.error || "Export failed." }; }
        const blob = await response.blob();
        if (!blob.size) return { ok: false, detail: "Export returned an empty file." };
        const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
        const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
        if (hash !== response.headers.get("x-artifact-sha256")) return { ok: false, detail: "Export checksum mismatch; download was blocked." };
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url; link.download = response.headers.get("content-disposition")?.match(/filename="([a-zA-Z0-9_.-]+)"/)?.[1] || `document.${action.format}`;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 30000);
        return { ok: true, detail: `Generated ${blob.size.toLocaleString()} bytes; checksum verified. Download handed to the browser. Saving to disk cannot be verified. No cloud copy is retained.` };
      } catch { return { ok: false, detail: "Document generation or download failed. You may retry this export." }; }
    }
    case "open_url": {
      if (!isAllowedUrl(action.url)) {
        const ok = opts.confirm ? await opts.confirm(action) : false;
        if (!ok) return { ok: false, detail: "User declined to open that site." };
      }
      const r = openTab(action.url);
      return { ...r, needsTap: !r.ok };
    }
    case "compose_message": {
      const r = openTab(action.url);
      return {
        ok: r.ok,
        detail: r.ok ? `${action.app} draft opened — press send to deliver it.` : r.detail,
        needsTap: !r.ok,
      };
    }
    case "clipboard": {
      try {
        await navigator.clipboard.writeText(action.text);
        return { ok: true, detail: `Copied ${action.text.length} characters.` };
      } catch {
        return { ok: false, detail: "Clipboard access denied by the browser." };
      }
    }
    case "capture_screen": {
      try {
        const dataUrl = await grabScreenFrame();
        const res = await fetch("/api/vision/screen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image: dataUrl, question: action.question }),
        });
        const j = (await res.json()) as { description?: string; error?: string };
        if (!res.ok || !j.description) return { ok: false, detail: j.error ?? "couldn't read the screen" };
        return { ok: true, detail: j.description };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "screen capture failed";
        return { ok: false, detail: /denied|dismissed|abort/i.test(msg) ? "You cancelled the screen picker." : msg };
      }
    }
  }
}
