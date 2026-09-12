import type { ToolDef } from "./tools";
import { SITE_SHORTCUTS } from "./actions";

/**
 * PC BROWSER TOOLS
 * ----------------
 * Real browser control through the server-side Playwright executor. These run inside the same
 * tool loop as every other tool, so the model calls them and gets a real, verified result — a
 * genuine click/type/verify, never a simulated "opened successfully".
 *
 * They are gated behind the `pc_browser` skill. When the executor can't run (Playwright/Chromium
 * missing, or launch fails) the tool returns the actual error so the assistant reports the truth
 * instead of pretending. The executor is dynamically imported so the heavy dep never touches the
 * client bundle and a machine without it still boots.
 */

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : Number(v) || d);

async function ex() {
  return import("@/server/browser/executor");
}

/** Compact a page snapshot into text the model can reason over without blowing the context. */
function snap(s: { url: string; title: string; text: string; links?: { i: number; text: string }[] }): string {
  const links = (s.links ?? []).slice(0, 15).map((l) => `[${l.i}] ${l.text}`).join("\n");
  return `URL: ${s.url}\nTITLE: ${s.title}\nTEXT (trimmed):\n${(s.text || "").slice(0, 1500)}${links ? `\n\nLINKS:\n${links}` : ""}`;
}

export const BROWSER_TOOLS: ToolDef[] = [
  {
    name: "pc_open",
    skillKey: "pc_browser",
    description:
      "Open a website in the server-side controlled Chromium session, not the user's laptop browser. Use this only when the pc_browser skill is authenticated and available. If the result says pairing/authentication/blocked/unavailable, report that once and stop: do not retry pc_open, pc_read, pc_click, or pc_youtube tools. For the user's own browser, use the client open_url action instead. Accepts a site name or full URL.",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async (a) => {
      const { open } = await ex();
      // Resolve common shortcuts ("chatgpt" → https://chatgpt.com) so voice "open X" works.
      const raw = str(a.url).trim();
      const key = raw.toLowerCase().replace(/^(open|go to|launch|visit)\s+/, "").replace(/\s+/g, "");
      const target = SITE_SHORTCUTS[key] ?? (/^https?:\/\//.test(raw) ? raw : `https://${raw.replace(/\s+/g, "")}`);
      const r = await open(target);
      return r.ok ? `Opened (verified). ${snap(r.data)}` : `Could not open ${target}: ${r.error}`;
    },
  },
  {
    name: "pc_read",
    skillKey: "pc_browser",
    description: "Read the current page in the controlled browser: title, URL, visible text and the top links (with indexes you can click).",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { read } = await ex();
      const r = await read();
      return r.ok ? snap(r.data) : `Could not read page: ${r.error}`;
    },
  },
  {
    name: "pc_type",
    skillKey: "pc_browser",
    description: "Type text into an input on the current page, selected by CSS selector. Set submit=true to press Enter afterwards (e.g. a search box).",
    parameters: {
      type: "object",
      properties: { selector: { type: "string" }, text: { type: "string" }, submit: { type: "boolean" } },
      required: ["selector", "text"],
    },
    run: async (a) => {
      const { typeText } = await ex();
      const r = await typeText(str(a.selector), str(a.text), Boolean(a.submit));
      return r.ok ? `Typed. ${snap(r.data)}` : `Could not type: ${r.error}`;
    },
  },
  {
    name: "pc_click",
    skillKey: "pc_browser",
    description: "Click an element on the current page. Provide one of: index (from the LINKS list of a read/search), a CSS selector, or visible text.",
    parameters: {
      type: "object",
      properties: { index: { type: "number" }, selector: { type: "string" }, text: { type: "string" } },
    },
    run: async (a) => {
      const { click } = await ex();
      const target: { selector?: string; text?: string; index?: number } = {};
      if (a.index !== undefined) target.index = num(a.index);
      if (a.selector) target.selector = str(a.selector);
      if (a.text) target.text = str(a.text);
      const r = await click(target);
      return r.ok ? `Clicked. ${snap(r.data)}` : `Could not click: ${r.error}`;
    },
  },
  {
    name: "pc_scroll",
    skillKey: "pc_browser",
    description: "Scroll the current page up or down.",
    parameters: { type: "object", properties: { direction: { type: "string", enum: ["down", "up"] } } },
    run: async (a) => {
      const { scroll } = await ex();
      const r = await scroll(str(a.direction, "down") === "up" ? "up" : "down");
      return r.ok ? `Scrolled. ${snap(r.data)}` : `Could not scroll: ${r.error}`;
    },
  },
  {
    name: "pc_back",
    skillKey: "pc_browser",
    description: "Go back to the previous page in the controlled browser.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const { back } = await ex();
      const r = await back();
      return r.ok ? `Went back. ${snap(r.data)}` : `Could not go back: ${r.error}`;
    },
  },
  {
    name: "pc_verify",
    skillKey: "pc_browser",
    description:
      "Verify the current page matches an expectation before you tell the user something succeeded. Provide any of urlIncludes / titleIncludes / textIncludes. Returns matched true/false — only claim success when matched is true.",
    parameters: {
      type: "object",
      properties: { urlIncludes: { type: "string" }, titleIncludes: { type: "string" }, textIncludes: { type: "string" } },
    },
    run: async (a) => {
      const { verify } = await ex();
      const r = await verify({ urlIncludes: a.urlIncludes ? str(a.urlIncludes) : undefined, titleIncludes: a.titleIncludes ? str(a.titleIncludes) : undefined, textIncludes: a.textIncludes ? str(a.textIncludes) : undefined });
      if (!r.ok) return `Verify failed: ${r.error}`;
      return `VERIFY matched=${r.data.matched}. ${snap(r.data.snapshot)}`;
    },
  },
  {
    name: "pc_google_search",
    skillKey: "pc_browser",
    description: "Run a real Google search in the controlled browser and return the organic result titles + links (with indexes). Then use pc_click to open one.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const { googleSearch } = await ex();
      const r = await googleSearch(str(a.query));
      if (!r.ok) return `Google search failed: ${r.error}`;
      const list = r.data.results.map((x) => `[${x.i}] ${x.title} — ${x.href}`).join("\n");
      return list ? `Google results:\n${list}` : "No results parsed from the page.";
    },
  },
  {
    name: "pc_youtube_search",
    skillKey: "pc_browser",
    description: "Run a YouTube search in the authenticated server-side controlled browser and return video titles + watch links. This is not the user's laptop. If authentication/pairing is blocked, report the failure once and stop; do not retry or claim playback.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const { youtubeSearch } = await ex();
      const r = await youtubeSearch(str(a.query));
      if (!r.ok) return `YouTube search failed: ${r.error}`;
      const list = r.data.results.map((x) => `[${x.i}] ${x.title} — ${x.href}`).join("\n");
      return list ? `YouTube results:\n${list}` : "No videos parsed from the results page.";
    },
  },
  {
    name: "pc_youtube_open",
    skillKey: "pc_browser",
    description:
      "Open a YouTube watch URL in the authenticated server-side controlled browser and verify it. This does not control the user's laptop. If pairing/authentication/browser access is blocked, report once and stop; never retry or claim the video played.",
    parameters: { type: "object", properties: { href: { type: "string" } }, required: ["href"] },
    run: async (a) => {
      const { youtubeOpen } = await ex();
      const r = await youtubeOpen(str(a.href));
      return r.ok
        ? `Opened video (verified). Title: "${r.data.title}". URL: ${r.data.url}. Playing: ${r.data.playing}.`
        : `Could not open/verify that video: ${r.error}`;
    },
  },
  {
    name: "pc_youtube_play",
    skillKey: "pc_browser",
    description: "Play or pause the video currently open in the controlled browser. play=true to play, play=false to pause.",
    parameters: { type: "object", properties: { play: { type: "boolean" } }, required: ["play"] },
    run: async (a) => {
      const { youtubePlayPause } = await ex();
      const r = await youtubePlayPause(a.play !== false);
      return r.ok ? `Playback ${r.data.playing ? "playing" : "paused"} (verified).` : `Could not control playback: ${r.error}`;
    },
  },
];
