import { db } from "@/db";
import { memories, reminders, todos, notes, moods, skills } from "@/db/schema";
import { toolPolicyBlock, validateToolArguments, type ToolStatus } from "./tool-policy";
import { desc, eq } from "drizzle-orm";
import { composeUrl, isAllowedUrl, normalizeUrl, SITE_SHORTCUTS, type ClientAction, type MessageApp } from "./actions";
import { BROWSER_TOOLS } from "./browser-tools";
import { ANDROID_TOOLS } from "./android-tools";

/**
 * What a tool hands back. `text` is what the model and the user read; `action` is work only the
 * browser can do (open a tab, read the screen) and is forwarded to the client as an SSE event.
 */
export type ToolRun = { text: string; action?: ClientAction; status?: ToolStatus };

export type ToolDef = {
  name: string;
  skillKey: string;
  description: string;
  parameters: Record<string, unknown>;
  requiresConfirmation?: boolean;
  run: (args: Record<string, unknown>) => Promise<string | ToolRun>;
};

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown, d = 0) => (typeof v === "number" ? v : Number(v) || d);

/** Pair a client-side action with the sentence the model sees, so it knows what it just set in motion. */
const action = (a: ClientAction, text: string): ToolRun => ({ text, action: a });

/**
 * Turn whatever the model said into something openable: a bare site name ("youtube"), a hostname
 * ("news.ycombinator.com") or a full URL. Off-allowlist hosts still open, but the client marks them
 * as needing a tap first — see `isAllowedUrl`.
 */
function openTarget(raw: string, label = ""): ToolRun | string {
  const key = raw.trim().toLowerCase().replace(/^(open|go to|launch|visit)\s+/, "");
  const url = SITE_SHORTCUTS[key] ?? normalizeUrl(raw);
  if (!url) return `"${raw}" doesn't look like a website I can open. Give me a name like "youtube" or a full address.`;
  const host = new URL(url).hostname.replace(/^www\./, "");
  return action(
    { kind: "open_url", url, label: label || host },
    isAllowedUrl(url)
      ? `Requested opening ${host}; waiting for the user's browser to confirm.`
      : `Offered to open ${host}. It's not on the trusted list, so the user has to confirm it first.`,
  );
}

async function geocode(city: string) {
  const r = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    { signal: AbortSignal.timeout(8000) },
  );
  const j = (await r.json()) as { results?: { latitude: number; longitude: number; name: string; country: string }[] };
  return j.results?.[0] ?? null;
}

const WMO: Record<number, string> = {
  0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "foggy", 48: "icy fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "rain showers", 81: "rain showers", 82: "violent showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
};

export function parseWhen(input: string, now = new Date()): Date | null {
  const s = input.toLowerCase().trim();
  const iso = Date.parse(input);
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(input)) return new Date(iso);
  const rel = s.match(/in\s+(\d+)\s*(second|sec|minute|min|hour|hr|day)s?/);
  if (rel) {
    const n = Number(rel[1]);
    const unit = rel[2];
    const ms = unit.startsWith("sec") ? 1000 : unit.startsWith("min") ? 60000 : unit.startsWith("h") ? 3600000 : 86400000;
    return new Date(now.getTime() + n * ms);
  }
  const t = s.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/);
  if (t) {
    let h = Number(t[1]);
    const m = Number(t[2] ?? 0);
    if (t[3] === "pm" && h < 12) h += 12;
    if (t[3] === "am" && h === 12) h = 0;
    const d = new Date(now);
    d.setHours(h, m, 0, 0);
    if (s.includes("tomorrow") || d.getTime() < now.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }
  if (s.includes("tomorrow")) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }
  return null;
}

export const TOOLS: ToolDef[] = [
  {
    name: "get_weather",
    skillKey: "weather",
    description: "Get current weather and today's forecast for a city.",
    parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
    run: async (a) => {
      const city = str(a.city, "Delhi");
      const g = await geocode(city);
      if (!g) return `Couldn't find a city called ${city}.`;
      const r = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`,
        { signal: AbortSignal.timeout(8000) },
      );
      const j = (await r.json()) as {
        current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; weather_code: number; wind_speed_10m: number };
        daily: { temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[] };
      };
      const c = j.current;
      return `Weather in ${g.name}, ${g.country}: ${c.temperature_2m}°C (feels ${c.apparent_temperature}°C), ${WMO[c.weather_code] ?? "unknown"}, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h. Today: high ${j.daily.temperature_2m_max[0]}°C / low ${j.daily.temperature_2m_min[0]}°C, rain chance ${j.daily.precipitation_probability_max[0]}%.`;
    },
  },
  {
    name: "research",
    skillKey: "research",
    description:
      "Deep web research: finds several real sources, reads them, and returns their text WITH source URLs. Use for 'research X', 'compare X and Y', 'latest news on X', or any answer that needs current info from multiple sources. After it returns, summarize in your own words and CITE the source URLs. Never invent sources.",
    parameters: { type: "object", properties: { query: { type: "string" }, maxSources: { type: "number" } }, required: ["query"] },
    run: async (a) => {
      const { research } = await import("./research");
      const r = await research(str(a.query), Math.min(5, Math.max(2, num(a.maxSources, 3))));
      if (!r.ok) return r.error;
      const blocks = r.sources
        .map((s, i) => `SOURCE ${i + 1}: ${s.title}\nURL: ${s.url}\n${s.text}`)
        .join("\n\n---\n\n");
      return `Collected ${r.sources.length} real sources for "${r.query}". Summarize and cite these URLs:\n\n${blocks}`;
    },
  },
  {
    name: "web_search",
    skillKey: "search",
    description: "Search the web / Wikipedia for facts, news, people, places, definitions.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const q = str(a.query);
      try {
        const r = await fetch(
          `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
          { signal: AbortSignal.timeout(8000) },
        );
        const j = (await r.json()) as { AbstractText?: string; AbstractURL?: string; RelatedTopics?: { Text?: string }[] };
        if (j.AbstractText) return `${j.AbstractText} (source: ${j.AbstractURL})`;
        const rel = (j.RelatedTopics ?? []).map((t) => t.Text).filter(Boolean).slice(0, 3);
        if (rel.length) return rel.join("\n");
      } catch {
        /* fall through */
      }
      try {
        const w = await fetch(
          `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&format=json&utf8=1&srlimit=3&origin=*`,
          { signal: AbortSignal.timeout(8000) },
        );
        const wj = (await w.json()) as { query?: { search?: { title: string; snippet: string }[] } };
        const hits = wj.query?.search ?? [];
        if (hits.length) return hits.map((h) => `${h.title}: ${h.snippet.replace(/<[^>]+>/g, "")}`).join("\n");
      } catch {
        /* ignore */
      }
      return `No results found for "${q}".`;
    },
  },
  {
    name: "set_reminder",
    skillKey: "reminders",
    description: "Set a reminder, alarm or timer. `when` can be natural like 'in 10 minutes', 'tomorrow 7am', '18:30' or ISO date.",
    parameters: { type: "object", properties: { title: { type: "string" }, when: { type: "string" } }, required: ["title", "when"] },
    run: async (a) => {
      const when = parseWhen(str(a.when));
      if (!when) return `Couldn't understand the time "${str(a.when)}".`;
      const [row] = await db.insert(reminders).values({ title: str(a.title, "Reminder"), dueAt: when }).returning().all();
      return `Reminder #${row.id} set: "${row.title}" at ${when.toLocaleString()}.`;
    },
  },
  {
    name: "list_reminders",
    skillKey: "reminders",
    description: "List upcoming reminders.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = await db.select().from(reminders).where(eq(reminders.done, false)).orderBy(reminders.dueAt).limit(10).all();
      return rows.length ? rows.map((r) => `#${r.id} ${r.title} — ${r.dueAt.toLocaleString()}`).join("\n") : "No upcoming reminders.";
    },
  },
  {
    name: "add_todo",
    skillKey: "todos",
    description: "Add a task to the to-do list.",
    parameters: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
    run: async (a) => {
      const [row] = await db.insert(todos).values({ title: str(a.title) }).returning().all();
      return `Added todo #${row.id}: ${row.title}`;
    },
  },
  {
    name: "list_todos",
    skillKey: "todos",
    description: "Show pending to-do items.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      const rows = await db.select().from(todos).where(eq(todos.done, false)).orderBy(desc(todos.createdAt)).limit(15).all();
      return rows.length ? rows.map((r) => `#${r.id} ${r.title}`).join("\n") : "To-do list is empty.";
    },
  },
  {
    name: "complete_todo",
    skillKey: "todos",
    description: "Mark a to-do as done by id.",
    parameters: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
    run: async (a) => {
      await db.update(todos).set({ done: true }).where(eq(todos.id, num(a.id))).run();
      return `Todo #${num(a.id)} marked done.`;
    },
  },
  {
    name: "save_note",
    skillKey: "notes",
    description: "Save a note.",
    parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] },
    run: async (a) => {
      const [row] = await db.insert(notes).values({ title: str(a.title), body: str(a.body) }).returning().all();
      return `Note #${row.id} saved: ${row.title}`;
    },
  },
  {
    name: "remember_fact",
    skillKey: "memory",
    description: "Store a long-term memory about the user (name, birthday, likes, goals, exam dates, people).",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string" },
        kind: { type: "string", enum: ["fact", "preference", "goal", "event", "person"] },
        importance: { type: "number" },
      },
      required: ["content"],
    },
    run: async (a) => {
      await db.insert(memories).values({ content: str(a.content), kind: str(a.kind, "fact"), importance: Math.min(5, Math.max(1, num(a.importance, 3))) }).run();
      return `Remembered: ${str(a.content)}`;
    },
  },
  {
    name: "recall_memories",
    skillKey: "memory",
    description: "Search long-term memory by keyword.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const rows = await db.select().from(memories).orderBy(desc(memories.importance)).all();
      const q = str(a.query).toLowerCase().split(/\s+/).filter(Boolean);
      const hits = rows.filter((r) => q.some((w) => r.content.toLowerCase().includes(w))).slice(0, 8);
      return hits.length ? hits.map((h) => `- ${h.content}`).join("\n") : "Nothing in memory matched.";
    },
  },
  {
    name: "log_mood",
    skillKey: "companion",
    description: "Log the user's mood for daily check-ins.",
    parameters: {
      type: "object",
      properties: { mood: { type: "string", enum: ["great", "good", "okay", "low", "bad"] }, note: { type: "string" } },
      required: ["mood"],
    },
    run: async (a) => {
      await db.insert(moods).values({ mood: str(a.mood, "okay"), note: str(a.note) }).run();
      return `Mood logged: ${str(a.mood)}.`;
    },
  },
  {
    name: "get_time",
    skillKey: "system",
    description: "Get the current date and time.",
    parameters: { type: "object", properties: {} },
    run: async () => ({ status: "succeeded", text: `Server date/time: ${new Date().toISOString()}. This is not a reading of the user's device clock.` }),
  },
  {
    name: "calculate",
    skillKey: "study",
    description: "Evaluate a math expression like '12*7+3' or 'sqrt(144)'.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
    run: async (a) => {
      const expr = str(a.expression).replace(/\^/g, "**");
      if (!/^[\d\s+\-*/().,%a-z]+$/i.test(expr)) return "Invalid expression.";
      try {
        const fn = new Function("Math", `with(Math){return (${expr});}`);
        const v = fn(Math);
        return `${str(a.expression)} = ${v}`;
      } catch {
        return "Couldn't compute that.";
      }
    },
  },
  {
    name: "translate",
    skillKey: "translate",
    description: "Translate text between languages. Use ISO codes like en, hi, ja, es, fr.",
    parameters: { type: "object", properties: { text: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["text", "to"] },
    run: async (a) => {
      const r = await fetch(
        `https://api.mymemory.translated.net/get?q=${encodeURIComponent(str(a.text))}&langpair=${str(a.from, "en")}|${str(a.to, "hi")}`,
        { signal: AbortSignal.timeout(8000) },
      );
      const j = (await r.json()) as { responseData?: { translatedText?: string } };
      return j.responseData?.translatedText ? `Translation (${str(a.to)}): ${j.responseData.translatedText}` : "Translation failed.";
    },
  },
  {
    name: "tell_joke",
    skillKey: "companion",
    description: "Fetch a clean joke.",
    parameters: { type: "object", properties: {} },
    run: async () => {
      try {
        const r = await fetch("https://v2.jokeapi.dev/joke/Any?safe-mode&type=single", { signal: AbortSignal.timeout(6000) });
        const j = (await r.json()) as { joke?: string };
        if (j.joke) return j.joke;
      } catch {
        /* ignore */
      }
      return "Why did the ninja fail math? He kept hiding the variables.";
    },
  },
  {
    name: "define_word",
    skillKey: "study",
    description: "Dictionary definition of an English word.",
    parameters: { type: "object", properties: { word: { type: "string" } }, required: ["word"] },
    run: async (a) => {
      const r = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(str(a.word))}`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return `No definition found for "${str(a.word)}".`;
      const j = (await r.json()) as { meanings?: { partOfSpeech: string; definitions: { definition: string }[] }[] }[];
      const m = j[0]?.meanings?.[0];
      return m ? `${str(a.word)} (${m.partOfSpeech}): ${m.definitions[0]?.definition}` : "No definition found.";
    },
  },
  {
    name: "open_url",
    skillKey: "browser",
    description:
      "Open a website in the user's browser. Accepts a full URL or a well-known site name like 'youtube', 'gmail', 'maps'. Use for 'open X', 'go to X', 'launch X'.",
    parameters: { type: "object", properties: { url: { type: "string" }, label: { type: "string" } }, required: ["url"] },
    run: async (a) => openTarget(str(a.url), str(a.label)),
  },
  {
    name: "search_youtube",
    skillKey: "browser",
    description: "Open YouTube search results. Use for 'find the X trailer', 'play X on YouTube', 'search YouTube for X'.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const q = str(a.query);
      if (!q) return "Need something to search for on YouTube.";
      return action(
        { kind: "open_url", url: `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`, label: `YouTube: ${q}` },
        `Opening YouTube results for "${q}" in the user's browser.`,
      );
    },
  },
  {
    name: "search_google",
    skillKey: "browser",
    description: "Open Google search results in the browser. For a spoken answer use web_search instead — this one opens a tab.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async (a) => {
      const q = str(a.query);
      if (!q) return "Need something to search for.";
      return action(
        { kind: "open_url", url: `https://www.google.com/search?q=${encodeURIComponent(q)}`, label: `Google: ${q}` },
        `Opening Google results for "${q}" in the user's browser.`,
      );
    },
  },
  {
    name: "send_message",
    skillKey: "messaging",
    description:
      "Draft a message to someone on WhatsApp, SMS, email or Telegram. Opens the app with the recipient and text filled in, ready for the user to press send. `to` is a phone number for whatsapp/sms, an address for email, a @handle for telegram.",
    parameters: {
      type: "object",
      properties: {
        app: { type: "string", enum: ["whatsapp", "sms", "email", "telegram"] },
        to: { type: "string" },
        text: { type: "string" },
      },
      required: ["app", "text"],
    },
    run: async (a) => {
      const app = (["whatsapp", "sms", "email", "telegram"].includes(str(a.app)) ? str(a.app) : "whatsapp") as MessageApp;
      const text = str(a.text);
      const to = str(a.to);
      if (!text) return "Need the message text before I can draft it.";
      const url = composeUrl(app, to, text);
      return action(
        { kind: "compose_message", app, to, text, url, label: `${app}${to ? ` → ${to}` : ""}` },
        `Prepared a draft for ${app}${to ? ` to ${to}` : ""}. Opening the app is not yet confirmed. The message has not been sent; the user must review and press send.`,
      );
    },
  },
  {
    name: "capture_screen",
    skillKey: "screen",
    description:
      "Look at the user's screen. The browser asks them to pick a window or display, captures one frame, and describes it. Use for 'what's on my screen', 'read this error', 'what am I looking at'.",
    parameters: { type: "object", properties: { question: { type: "string" } }, required: [] },
    run: async (a) =>
      action(
        { kind: "capture_screen", question: str(a.question, "What is on this screen?"), label: "Screen capture" },
        "Asked the browser to capture the screen. The description arrives in the next turn.",
      ),
  },
  {
    name: "copy_to_clipboard",
    skillKey: "system",
    description: "Put text on the user's clipboard so they can paste it.",
    parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    run: async (a) => {
      const text = str(a.text);
      if (!text) return "Nothing to copy.";
      return action({ kind: "clipboard", text, label: `Copy ${text.length} chars` }, `Requested copying ${text.length} characters. Clipboard access is not yet confirmed.`);
    },
  },
  {
    name: "device_action",
    skillKey: "device",
    description:
      "Phone/system controls that need a native app: calls, volume, brightness, wifi, bluetooth, flashlight. Web build cannot perform these — prefer open_url, send_message or capture_screen, which work here.",
    parameters: { type: "object", properties: { action: { type: "string" }, target: { type: "string" } }, required: ["action"] },
    run: async (a) =>
      `Can't do "${str(a.action)}${a.target ? ` ${str(a.target)}` : ""}" from the browser — that one needs the native app. Opening a site, drafting a message or reading the screen all work here.`,
  },
  // Real PC browser control (Playwright) — server-executed, verified. Gated by the pc_browser skill.
  ...BROWSER_TOOLS,
  // Real Android device control via the native Agent bridge. Gated by the android skill; each
  // tool fails honestly when the phone/accessibility service isn't connected.
  ...ANDROID_TOOLS,
];


export const SKILL_CATALOG = [
  { key: "weather", name: "Weather", description: "Live weather via Open-Meteo (free, no key).", category: "information" },
  { key: "search", name: "Web Search & Wikipedia", description: "DuckDuckGo instant answers + Wikipedia.", category: "information" },
  { key: "research", name: "Deep Web Research", description: "Finds and reads multiple real sources, then summarizes with citations. Keyless (DuckDuckGo + Wikipedia).", category: "information" },
  { key: "browser", name: "Browser Control", description: "Really opens tabs in your browser — sites, YouTube and Google searches.", category: "agent" },
  { key: "pc_browser", name: "PC Browser Agent (Playwright)", description: "Drives a real Chromium on the PC: navigate, search, click, type, scroll, read and verify pages. The genuine hands for multi-step web tasks. Needs the Playwright browser installed on the machine running the server.", category: "agent" },
  { key: "android", name: "Android Device Agent", description: "Controls a connected Android phone via the native Jarvish Agent app (AccessibilityService): launch apps, tap, type, scroll, read the screen and verify. Needs the native app running with accessibility enabled — tools report honestly when it isn't connected.", category: "agent", requiresKey: "JARVISH_ANDROID_BRIDGE" },
  { key: "reminders", name: "Reminders, Alarms & Timers", description: "Natural-language reminders with proactive alerts.", category: "productivity" },
  { key: "todos", name: "To-do List", description: "Add, list and complete tasks.", category: "productivity" },
  { key: "notes", name: "Notes", description: "Quick notes storage.", category: "productivity" },
  { key: "memory", name: "Long-term Memory", description: "Remember and recall facts about you.", category: "intelligence" },
  { key: "companion", name: "Companion Mode", description: "Mood check-ins, jokes, 'I'm bored' mode.", category: "companion" },
  { key: "system", name: "System Info", description: "Time, date and status.", category: "system" },
  { key: "study", name: "Study Buddy", description: "Calculator, dictionary, quizzes, flashcards.", category: "study" },
  { key: "translate", name: "Live Translate", description: "Translate between languages (MyMemory free API).", category: "information" },
  { key: "device", name: "Phone Control", description: "Calls, volume, flashlight — needs the native app; the web build says so instead of pretending.", category: "device" },
  { key: "messaging", name: "Messaging", description: "Drafts WhatsApp / SMS / email / Telegram messages with the text prefilled. You press send.", category: "agent" },
  { key: "screen", name: "Screen Reading", description: "'What's on my screen?' — the browser captures a window you pick and describes it.", category: "agent" },
  { key: "smart_home", name: "Smart Home", description: "Home Assistant / Google Home / Alexa bridge.", category: "smart", requiresKey: "HOME_ASSISTANT_TOKEN" },
  { key: "spotify", name: "Spotify Control", description: "Play, pause, search music.", category: "fun", requiresKey: "SPOTIFY_CLIENT_ID" },
  { key: "vision", name: "Camera & Screen Vision", description: "Point the camera, or ask 'what's on my screen' and it reads the screen.", category: "smart", requiresKey: "OPENAI_API_KEY" },
  { key: "image_gen", name: "Image Generation", description: "Generate images from text.", category: "creativity", requiresKey: "OPENAI_API_KEY" },
  { key: "email", name: "Email", description: "Read, summarize, reply (Gmail API).", category: "productivity", requiresKey: "GOOGLE_OAUTH" },
];

export function toolsForLLM(enabledSkillKeys: Set<string>) {
  return TOOLS.filter((t) => enabledSkillKeys.has(t.skillKey)).map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

/**
 * Run a tool and always hand back a `ToolRun`, so callers never have to care whether a tool
 * returned a plain sentence or a sentence plus a browser action.
 */
export async function runTool(name: string, args: unknown): Promise<ToolRun & { status: ToolStatus }> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) return { status: "blocked", text: `Unknown tool ${name}. No action was performed.` };
  const invalid = validateToolArguments(t.parameters, args);
  if (invalid) return { status: "blocked", text: invalid };
  try {
    const enabled = await db.select({ key: skills.key }).from(skills).where(eq(skills.enabled, true)).all();
    const blocked = toolPolicyBlock(t, new Set(enabled.map((skill) => skill.key)));
    if (blocked) return { status: "blocked", text: blocked };
    const result = await t.run(args as Record<string, unknown>);
    const output = typeof result === "string" ? { text: result } : result;
    if (output.action) return { ...output, status: "awaiting_user", text: `Client action requested, not verified: ${output.text}` };
    // Legacy text is not execution evidence. Only structured tool results can report success.
    return { ...output, status: output.status ?? "unverified" };
  } catch {
    return { status: "failed", text: `Tool ${name} failed. The outcome is not confirmed; do not retry a state-changing action without checking it first.` };
  }
}

/** For the callers that only want the sentence (routines, offline fallbacks). */
export async function runToolText(name: string, args: Record<string, unknown>): Promise<string> {
  return (await runTool(name, args)).text;
}
