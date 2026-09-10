import type { ToolDef } from "./tools";

/**
 * ANDROID TOOLS
 * -------------
 * Real on-device control through the native Android Agent bridge. Gated behind the `android`
 * skill. If the bridge/accessibility service isn't connected, each tool returns the actual
 * failure so the assistant says the truth ("the phone agent isn't connected") instead of faking.
 *
 * Common package names are mapped so "open YouTube on my phone" resolves to a real launch intent.
 */

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : Number(v) || d);

async function ax() {
  return (await import("@/server/android/executor")).android;
}

const APP_PACKAGES: Record<string, string> = {
  youtube: "com.google.android.youtube",
  chrome: "com.android.chrome",
  gmail: "com.google.android.gm",
  maps: "com.google.android.apps.maps",
  whatsapp: "com.whatsapp",
  telegram: "org.telegram.messenger",
  spotify: "com.spotify.music",
  settings: "com.android.settings",
  playstore: "com.android.vending",
  camera: "com.android.camera",
  instagram: "com.instagram.android",
};

function resolvePackage(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, "");
  return APP_PACKAGES[key] ?? name;
}

export const ANDROID_TOOLS: ToolDef[] = [
  {
    name: "android_launch",
    skillKey: "android",
    description:
      "Launch an app on the connected Android phone. Accepts a common name (youtube, chrome, gmail, whatsapp, maps, spotify, settings) or a package id. Use for 'open X on my phone'.",
    parameters: { type: "object", properties: { app: { type: "string" } }, required: ["app"] },
    run: async (a) => {
      const r = await (await ax()).launch(resolvePackage(str(a.app)));
      return r.ok ? `Launched ${str(a.app)} on the phone.` : `Could not launch on phone: ${r.error}`;
    },
  },
  {
    name: "android_read",
    skillKey: "android",
    description: "Read the current Android screen's UI tree: the foreground app and visible/clickable elements with indexes and tap coordinates.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const r = await (await ax()).read();
      if (!r.ok) return `Could not read the phone screen: ${r.error}`;
      const d = r.data as { package?: string; nodes?: { i: number; text: string; desc: string; clickable: boolean; cx: number; cy: number }[] };
      const nodes = (d.nodes ?? []).slice(0, 25).map((n) => `[${n.i}] ${n.text || n.desc}${n.clickable ? " (tappable)" : ""} @${n.cx},${n.cy}`).join("\n");
      return `Foreground app: ${d.package ?? "?"}\n${nodes || "(no readable elements)"}`;
    },
  },
  {
    name: "android_tap_text",
    skillKey: "android",
    description: "Tap the first on-screen element whose text or description matches. Use after android_read to act on a labelled button/result.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (a) => {
      const r = await (await ax()).tapText(str(a.text));
      return r.ok ? `Tapped "${str(a.text)}" on the phone.` : `Could not tap that: ${r.error}`;
    },
  },
  {
    name: "android_tap",
    skillKey: "android",
    description: "Tap at exact screen coordinates (from android_read's @x,y). Use when there is no clear text to match.",
    parameters: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } }, required: ["x", "y"] },
    run: async (a) => {
      const r = await (await ax()).tap(num(a.x), num(a.y));
      return r.ok ? `Tapped (${num(a.x)}, ${num(a.y)}).` : `Could not tap: ${r.error}`;
    },
  },
  {
    name: "android_type",
    skillKey: "android",
    description: "Type text into the currently focused input field on the phone (tap the field first).",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (a) => {
      const r = await (await ax()).type(str(a.text));
      return r.ok ? `Typed into the focused field.` : `Could not type: ${r.error}`;
    },
  },
  {
    name: "android_scroll",
    skillKey: "android",
    description: "Scroll the current phone screen up or down.",
    parameters: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } } },
    run: async (a) => {
      const r = await (await ax()).scroll(str(a.direction, "down") === "up" ? "up" : "down");
      return r.ok ? `Scrolled ${str(a.direction, "down")}.` : `Could not scroll: ${r.error}`;
    },
  },
  {
    name: "android_back",
    skillKey: "android",
    description: "Press the Android back button.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const r = await (await ax()).back();
      return r.ok ? "Pressed back." : `Could not go back: ${r.error}`;
    },
  },
  {
    name: "android_home",
    skillKey: "android",
    description: "Go to the Android home screen.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const r = await (await ax()).home();
      return r.ok ? "Went to the home screen." : `Could not go home: ${r.error}`;
    },
  },
  {
    name: "android_verify",
    skillKey: "android",
    description:
      "Verify the phone is on the expected screen BEFORE telling the user something worked. Provide packageContains (e.g. 'youtube') and/or textContains. Returns matched true/false — only claim success when matched.",
    parameters: { type: "object", properties: { packageContains: { type: "string" }, textContains: { type: "string" } } },
    run: async (a) => {
      const r = await (await ax()).verify({ packageContains: a.packageContains ? str(a.packageContains) : undefined, textContains: a.textContains ? str(a.textContains) : undefined });
      if (!r.ok) return `Verify failed: ${r.error}`;
      const d = r.data as { matched?: boolean; package?: string };
      return `VERIFY matched=${Boolean(d.matched)} (foreground: ${d.package ?? "?"}).`;
    },
  },
];
