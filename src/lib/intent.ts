/**
 * INTENT CLASSIFIER
 *
 * Cheap, deterministic first pass over the user's message. It exists for two reasons:
 *
 *  1. The UI wants to show what Jarvish *thinks* you asked for before the model has finished
 *     answering, so an action shows a timeline instead of a spinner.
 *  2. Small models happily answer "open YouTube" with the sentence "Sure, opening YouTube!" and
 *     never call a tool. When we know the message is an action, we can tell the model that a
 *     tool call is mandatory — see `actionDirective`.
 *
 * No network, no tokens, runs in microseconds.
 */

export type IntentKind =
  | "open_site"
  | "search_video"
  | "search_web"
  | "research"
  | "browser_followup"
  | "send_message"
  | "read_screen"
  | "reminder"
  | "todo"
  | "note"
  | "memory"
  | "weather"
  | "media"
  | "device"
  | "chat";

export type Intent = {
  kind: IntentKind;
  /** true when the user expects something to happen, not just to be told something. */
  isAction: boolean;
  /** Human label for the timeline, e.g. "Open a website". */
  label: string;
  /** Tools that can satisfy this intent, most likely first. */
  tools: string[];
  /** 0..1 — how sure the rules are. Below 0.5 the model gets a hint, not an order. */
  confidence: number;
};

const RULES: { kind: IntentKind; label: string; tools: string[]; re: RegExp; weight?: number }[] = [
  {
    kind: "read_screen",
    label: "Read the screen",
    tools: ["capture_screen"],
    re: /\b(?:on|in) my screen\b|\bread (?:my|the) screen\b|\b(?:see|look at|check) my screen\b|what am i (?:looking at|seeing)\b|\bshare my screen\b/i,
  },
  {
    kind: "send_message",
    label: "Draft a message",
    tools: ["send_message"],
    re: /\b(?:send|write|draft|shoot)\b.{0,20}\b(?:message|msg|text|whatsapp|sms|email|mail|telegram)\b|^(?:message|msg|text|whatsapp|email)\s+\S+/i,
  },
  {
    kind: "search_video",
    label: "Find a video",
    // pc_browser tools first (real search + click + verify), then the lighter open-a-tab fallback.
    tools: ["pc_youtube_search", "pc_youtube_open", "pc_youtube_play", "search_youtube", "open_url"],
    re: /\byoutube\b|\btrailer\b|\b(?:play|watch)\b.{0,30}\b(?:video|song|music|episode|movie)\b|^(?:play|watch)\s+/i,
  },
  {
    kind: "open_site",
    label: "Open a website",
    tools: ["pc_open", "open_url"],
    re: /^(?:open|go to|launch|visit|take me to)\s+(?!the door|a reminder|my todo)/i,
  },
  {
    kind: "research",
    label: "Research the web",
    tools: ["research", "web_search", "pc_google_search"],
    re: /\bresearch\b|\blatest news\b|\bwhat'?s (?:the )?latest\b|\bcompare\b.{0,40}\b(?:vs|versus|and|with)\b|\bfind out about\b|\btell me about the latest\b/i,
  },
  {
    kind: "search_web",
    label: "Search the web",
    tools: ["pc_google_search", "web_search", "search_google"],
    re: /^(?:google|search|look up|find out|wiki(?:pedia)?)\b|\bsearch (?:for|the web)\b/i,
  },
  {
    kind: "browser_followup",
    label: "Continue the browser task",
    // Contextual follow-ups that only make sense against the live controlled browser.
    tools: ["pc_read", "pc_click", "pc_scroll", "pc_back", "pc_verify", "pc_youtube_open", "pc_youtube_play"],
    re: /^(?:open|click|play|pause|resume|scroll|go back|read)\b.{0,40}\b(?:it|that|this|first|second|third|result|one|page|video)\b|^(?:click|open) (?:the )?(?:first|second|third|\d+)/i,
  },
  { kind: "reminder", label: "Set a reminder", tools: ["set_reminder", "list_reminders"], re: /\bremind\b|\balarm\b|\btimer\b|yaad dila/i },
  { kind: "todo", label: "Update the to-do list", tools: ["add_todo", "list_todos", "complete_todo"], re: /\bto-?do\b|\btask\b|\bmy list\b/i },
  { kind: "note", label: "Save a note", tools: ["save_note"], re: /^(?:note|save (?:a )?note|take a note|write (?:this )?down)\b/i },
  { kind: "memory", label: "Remember something", tools: ["remember_fact", "recall_memories"], re: /^remember\b|\bdon'?t forget\b|what do you (?:remember|know) about me/i },
  { kind: "weather", label: "Check the weather", tools: ["get_weather"], re: /\bweather\b|\bforecast\b|\bmausam\b|\bमौसम\b|\btemperature\b/i },
  { kind: "media", label: "Control music", tools: ["open_url"], re: /\bspotify\b|\b(?:pause|resume|skip|next) (?:the )?(?:song|track|music)\b/i },
  { kind: "device", label: "Phone control", tools: ["device_action"], re: /\b(?:flashlight|torch|volume|brightness|wifi|bluetooth)\b|\bcall\s+(?:mom|dad|[a-z]+)\b/i },
];

/** Intents where the user is asking for something to *happen*. */
const ACTION_KINDS = new Set<IntentKind>([
  "open_site", "search_video", "search_web", "research", "browser_followup", "send_message", "read_screen", "reminder", "todo", "note", "memory", "media", "device",
]);

/** Classify a message. Never throws; falls back to plain conversation. */
export function classify(message: string): Intent {
  const m = message.trim();
  for (const r of RULES) {
    if (r.re.test(m)) {
      return { kind: r.kind, label: r.label, tools: r.tools, isAction: ACTION_KINDS.has(r.kind), confidence: r.weight ?? 0.8 };
    }
  }
  return { kind: "chat", label: "Conversation", tools: [], isAction: false, confidence: 0.9 };
}

/**
 * Extra system-prompt line for action intents. Weak models otherwise reply "Opening YouTube!"
 * without calling anything, which is exactly the failure this whole layer exists to kill.
 */
export function actionDirective(intent: Intent, availableTools: string[]): string | null {
  if (!intent.isAction) return null;
  const usable = intent.tools.filter((t) => availableTools.includes(t));
  if (!usable.length) return null;

  const hasPcBrowser = usable.some((t) => t.startsWith("pc_"));
  const lines = [
    `ACTION REQUIRED: the user's message is a request to DO something (${intent.label}).`,
    `You MUST call one of these tools before replying: ${usable.join(", ")}.`,
    `Do not claim you did it without calling the tool — saying "opening it now" without a tool call is a failure.`,
  ];

  if (hasPcBrowser) {
    // Teach the real multi-step browser loop. The pc_* tools drive a genuine Chromium and return
    // real page state, so the model must actually observe and verify — never assume.
    lines.push(
      `You control a REAL browser through the pc_* tools. Work in steps: (1) search/open, (2) READ the returned results/page, (3) pick the correct item by its actual title, (4) click/open it, (5) check the tool's verified result BEFORE telling the user it worked.`,
      `ONLY use the pc_* tools for this — do NOT also call open_url or search_youtube (those just open a blank tab and would be redundant).`,
      `Never say "Done", "opened" or "playing" unless a tool result actually confirmed it. If a tool returns an error, tell the user exactly what failed instead of pretending.`,
      `For a YouTube request: call pc_youtube_search → choose the best matching title from the results → call pc_youtube_open with that href (it verifies the watch page loaded) → if the user asked to play, call pc_youtube_play. In your final reply state the REAL video title the tool returned, not a generic sentence.`,
    );
  } else {
    lines.push(`After the tool result comes back, confirm in one short sentence, in character.`);
  }
  return lines.join(" ");
}
