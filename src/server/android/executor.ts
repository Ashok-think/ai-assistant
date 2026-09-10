import "server-only";

/**
 * ANDROID EXECUTOR (bridge client)
 * --------------------------------
 * The web app's client for the native Android Agent module (see /android-agent). The native app
 * runs a local bridge (default http://127.0.0.1:8756) exposing a small command protocol backed by
 * an AccessibilityService — the real "hands" on the device.
 *
 * This module NEVER fakes a result: if the bridge is unreachable or the accessibility service is
 * off, it returns a structured failure the agent reports honestly. It sends only whitelisted
 * actions and never transmits credentials.
 *
 * Connection: the bridge listens on the phone's loopback. To reach it from a PC-hosted web app,
 * use `adb reverse tcp:8756 tcp:8756` (phone→PC) or run the web app on the phone. Override the
 * target with JARVISH_ANDROID_BRIDGE (e.g. http://<phone-ip>:8756) when appropriate.
 */

const BRIDGE = (process.env.JARVISH_ANDROID_BRIDGE || "http://127.0.0.1:8756").replace(/\/+$/, "");

export type AndroidResult = { ok: true; data?: Record<string, unknown> } | { ok: false; error: string };

// The only actions the web side will ever send. Mirrors the native allowlist.
const ALLOWED = new Set(["status", "read", "tap", "tap_text", "type", "scroll", "swipe", "back", "home", "launch", "verify"]);

let cmdSeq = 0;

async function send(action: string, args: Record<string, unknown> = {}, timeoutMs = 12000): Promise<AndroidResult> {
  if (!ALLOWED.has(action)) return { ok: false, error: `action not allowed: ${action}` };
  const id = `and_${Date.now().toString(36)}_${(cmdSeq++).toString(36)}`;
  try {
    const r = await fetch(`${BRIDGE}/cmd`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action, args }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, error: `bridge HTTP ${r.status}` };
    const j = (await r.json()) as { ok?: boolean; data?: Record<string, unknown>; error?: string };
    return j.ok ? { ok: true, data: j.data } : { ok: false, error: j.error ?? "device action failed" };
  } catch (e) {
    const msg = (e as Error).name === "TimeoutError" ? "timed out" : (e as Error).message;
    return { ok: false, error: `Android bridge not reachable (${msg}). Is the Jarvish Agent app running with the accessibility service enabled, and the bridge reachable at ${BRIDGE}?` };
  }
}

export type AndroidStatus = {
  connected: boolean;
  bridge: boolean;
  accessibilityEnabled: boolean;
  target: string;
  detail: string;
};

/** Probe the bridge: is it running, and is the accessibility service enabled? Real, not assumed. */
export async function androidStatus(): Promise<AndroidStatus> {
  const r = await send("status", {}, 4000);
  if (!r.ok) return { connected: false, bridge: false, accessibilityEnabled: false, target: BRIDGE, detail: r.error };
  const d = r.data ?? {};
  const accessibilityEnabled = Boolean(d.accessibilityEnabled);
  return {
    connected: true,
    bridge: true,
    accessibilityEnabled,
    target: BRIDGE,
    detail: accessibilityEnabled ? "connected" : "bridge up, accessibility service OFF — enable Jarvish Agent in Settings → Accessibility",
  };
}

export const android = {
  status: androidStatus,
  read: () => send("read"),
  tapText: (text: string) => send("tap_text", { text }),
  tap: (x: number, y: number) => send("tap", { x, y }),
  type: (text: string) => send("type", { text }),
  scroll: (direction: "down" | "up" = "down") => send("scroll", { direction }),
  swipe: (x1: number, y1: number, x2: number, y2: number, durationMs = 250) => send("swipe", { x1, y1, x2, y2, durationMs }),
  back: () => send("back"),
  home: () => send("home"),
  launch: (pkg: string) => send("launch", { package: pkg }),
  verify: (expect: { packageContains?: string; textContains?: string }) => send("verify", expect),
};
