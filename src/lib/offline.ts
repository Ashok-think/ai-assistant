/**
 * OFFLINE PERSONA ENGINE
 * Rule-based intent parsing + in-character templated replies.
 * Used when no LLM provider is configured, when offline, or as the "on-device" tier.
 */
import type { CharacterLike, Emotion } from "./characters";
import type { ClientAction, MessageApp } from "./actions";
import { runTool } from "./tools";

export type OfflineResult = {
  text: string; // includes [emotion] tag
  toolCalls: { name: string; args: Record<string, unknown>; result: string }[];
  /** Browser work the reply set in motion (open a tab, draft a message, read the screen). */
  action?: ClientAction;
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function flavor(c: CharacterLike, base: string, emotion: Emotion = "happy", nick = c.nickname || "friend"): string {
  const phrase = Math.random() < 0.5 && c.catchphrases.length ? ` ${pick(c.catchphrases)}` : "";
  let text = base.replace(/\{nick\}/g, nick);
  if (c.sliders.calm < 33) text = text.replace(/\.$/, "!");
  if (c.sliders.soft > 66) text = text.replace(/!$/, "~");
  return `[${emotion}] ${text}${phrase}`;
}

function detectLang(m: string): "hi" | "ja" | "en" {
  if (/[\u0900-\u097F]/.test(m)) return "hi";
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(m)) return "ja";
  if (/\b(kya|hai|kaise|nahi|haan|yaar|bhai|acha|theek|kar|mujhe|batao)\b/i.test(m)) return "hi";
  return "en";
}

/**
 * Rule-matched reply. The inner function collects any browser action into `sink` so the ~25 early
 * returns below don't each have to remember to pass it along.
 */
export async function offlineRespond(c: CharacterLike, message: string, userName: string): Promise<OfflineResult> {
  const sink: { action?: ClientAction } = {};
  const r = await respond(c, message, userName, sink);
  return sink.action ? { ...r, action: sink.action } : r;
}

async function respond(c: CharacterLike, message: string, userName: string, sink: { action?: ClientAction }): Promise<OfflineResult> {
  const m = message.trim();
  const lower = m.toLowerCase();
  const lang = detectLang(m);
  const nick = c.nickname || userName;
  const say = (base: string, emotion?: Emotion) => flavor(c, base, emotion, nick);
  const calls: OfflineResult["toolCalls"] = [];

  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await runTool(name, args);
    calls.push({ name, args, result: r.text });
    if (r.action) sink.action = r.action; // last action wins; offline replies only ever raise one
    return r.text;
  };

  // --- Weather ---
  const mm = lower.match(/weather\s+(?:in|at|for)?\s*([a-z\s]+?)(?:\?|$|today|now)/) || lower.match(/(?:mausam|तापमान|मौसम)\s*(?:in|me|mein)?\s*([a-z\s]+)?/);
  if (lower.includes("weather") || lower.includes("mausam") || lower.includes("मौसम")) {
    const city = (mm?.[1] ?? "").trim() || "Delhi";
    const r = await call("get_weather", { city });
    return { text: say(`Here's the sky report, {nick}: ${r}${lower.includes("rain") ? "" : " Carry water, okay?"}`, "happy"), toolCalls: calls };
  }
  // --- Reminder / alarm / timer ---
  if (/remind|alarm|timer|yaad dila/.test(lower)) {
    const whenMatch = m.match(/(in\s+\d+\s*(?:seconds?|secs?|minutes?|mins?|hours?|hrs?|days?)|tomorrow(?:\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?|\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}(?::\d{2})\s*(?:am|pm)?)/i);
    const when = whenMatch?.[1]?.replace(/^at\s+/i, "") ?? "in 10 minutes";
    let title = m.replace(/remind me( to)?/i, "").replace(/set (an? )?(alarm|timer|reminder)( for| to)?/i, "").replace(whenMatch?.[0] ?? "", "").replace(/\bat\b\s*$/i, "").trim();
    if (!title || /^(alarm|timer)$/i.test(title)) title = /alarm/.test(lower) ? "Alarm" : /timer/.test(lower) ? "Timer" : "Reminder";
    const r = await call("set_reminder", { title, when });
    return { text: say(`Done, {nick}. ${r} I'll poke you when it's time.`, "happy"), toolCalls: calls };
  }
  if (/what.*reminders|list reminders|my reminders|upcoming/.test(lower)) {
    const r = await call("list_reminders", {});
    return { text: say(`Here's what's coming up:\n${r}`, "neutral"), toolCalls: calls };
  }
  // --- Todos ---
  if (/^(add|put)\b.*\b(todo|to-do|task|list)\b|add to my list|todo:/.test(lower)) {
    const title = m.replace(/^(add|put)\s*/i, "").replace(/\b(to|in|on)\s+(my\s+)?(todo|to-do|task)( list)?\b/i, "").replace(/todo:/i, "").trim() || m;
    const r = await call("add_todo", { title });
    return { text: say(`${r}. One step closer, {nick}.`, "happy"), toolCalls: calls };
  }
  if (/(show|list|what).*(todo|to-do|tasks)/.test(lower)) {
    const r = await call("list_todos", {});
    return { text: say(`Your list, {nick}:\n${r}`, "neutral"), toolCalls: calls };
  }
  // --- Notes ---
  if (/^(note|save note|take a note|write down)\b/.test(lower)) {
    const body = m.replace(/^(note|save note|take a note|write down)[:\s]*/i, "").trim();
    const r = await call("save_note", { title: body.slice(0, 40) || "Note", body });
    return { text: say(`${r}. Safe with me.`, "happy"), toolCalls: calls };
  }
  // --- Memory ---
  const remember = m.match(/^(?:remember(?: that)?|my (?:name|birthday|goal|favou?rite [a-z]+) is)\s+(.+)/i) || m.match(/^(i (?:like|love|hate|want to|am from|live in|study|work)\s.+)/i);
  if (remember) {
    const content = /^remember/i.test(m) ? remember[1] : m;
    const kind = /goal|want to/i.test(m) ? "goal" : /birthday|exam|test|interview|deadline|meeting|trip|anniversary/i.test(m) ? "event" : /like|love|hate|favou?rite/i.test(m) ? "preference" : /\b(mom|dad|sister|brother|friend|girlfriend|boyfriend|wife|husband)\b/i.test(m) ? "person" : "fact";
    const r = await call("remember_fact", { content, kind, importance: kind === "event" || kind === "goal" ? 4 : 3 });
    return { text: say(`Got it, {nick}. ${r}. I won't forget.`, "happy"), toolCalls: calls };
  }
  if (/what do you (remember|know) about me|do you remember/.test(lower)) {
    const r = await call("recall_memories", { query: m });
    return { text: say(`Let me think... ${r === "Nothing in memory matched." ? "We're just getting started, tell me about yourself!" : r}`, "thinking"), toolCalls: calls };
  }
  // --- Mood ---
  const moodMatch = lower.match(/i(?:'m| am| feel| feeling)\s+(great|amazing|good|fine|okay|ok|meh|low|sad|tired|bad|terrible|awful|happy|stressed|anxious)/);
  if (moodMatch) {
    const w = moodMatch[1];
    const mood = /great|amazing|happy/.test(w) ? "great" : /good|fine/.test(w) ? "good" : /okay|ok|meh/.test(w) ? "okay" : /low|sad|tired|stressed|anxious/.test(w) ? "low" : "bad";
    await call("log_mood", { mood, note: m });
    const reply =
      mood === "great" || mood === "good"
        ? pick([`Yesss that's what I like to hear, {nick}!`, `Love that energy, {nick}. Let's ride it.`])
        : mood === "okay"
          ? pick([`Okay is okay, {nick}. Want a small win to make it better?`, `Meh days happen. I'm right here.`])
          : pick([`Hey. Come here, {nick}. You're not alone in this. Want to talk or want a distraction?`, `Rough one, huh? Breathe with me. In... out. I've got you, {nick}.`]);
    return { text: say(reply, mood === "low" || mood === "bad" ? "sad" : "happy"), toolCalls: calls };
  }
  // --- Time ---
  if (/what time|time is it|date today|what.*date|kitne baje|समय/.test(lower)) {
    const r = await call("get_time", {});
    return { text: say(`${r}. Make it count, {nick}.`, "neutral"), toolCalls: calls };
  }
  // --- Math ---
  const math = m.match(/(?:calculate|compute|what is|what's|solve)\s+([\d\s+\-*/().^%]+)\s*\??$/i) || (/^[\d\s+\-*/().^%]+$/.test(m) ? [m, m] : null);
  if (math) {
    const r = await call("calculate", { expression: math[1].trim() });
    return { text: say(`${r}. Easy.`, "happy"), toolCalls: calls };
  }
  // --- Translate ---
  const tr = m.match(/translate\s+["“']?(.+?)["”']?\s+(?:to|into|in)\s+([a-z]+)/i);
  if (tr) {
    const map: Record<string, string> = { hindi: "hi", english: "en", japanese: "ja", spanish: "es", french: "fr", german: "de", korean: "ko", chinese: "zh" };
    const r = await call("translate", { text: tr[1], from: "en", to: map[tr[2].toLowerCase()] ?? tr[2].slice(0, 2) });
    return { text: say(r, "happy"), toolCalls: calls };
  }
  // --- Joke / bored ---
  if (/joke|bored|entertain me|make me laugh/.test(lower)) {
    const r = await call("tell_joke", {});
    return { text: say(`Okay okay, {nick}, here: ${r}`, "excited"), toolCalls: calls };
  }
  // --- Define ---
  const def = lower.match(/(?:define|meaning of|what does)\s+([a-z-]+)(?:\s+mean)?/);
  if (def) {
    const r = await call("define_word", { word: def[1] });
    return { text: say(r, "thinking"), toolCalls: calls };
  }
  // --- Screen reading ---
  if (/(on|in) my screen|read (my|the) screen|see my screen|look at my screen|what am i (looking at|seeing)|screen (par|pe) kya/.test(lower)) {
    const r = await call("capture_screen", { question: m });
    return { text: say(`Let me look, {nick}. ${r}`, "thinking"), toolCalls: calls };
  }
  // --- Messaging (draft with the text prefilled; the user hits send) ---
  const msg =
    m.match(/^(?:send |)(?:a )?(?:whatsapp|wa)(?: message)?(?: to)?\s+(\S+)\s+(?:saying|that|:)?\s*(.+)/i) ??
    m.match(/^(?:send |)(?:an? )?(?:sms|text)(?: message)?(?: to)?\s+(\S+)\s+(?:saying|that|:)?\s*(.+)/i) ??
    m.match(/^(?:send |)(?:an? )?(?:email|mail)(?: to)?\s+(\S+)\s+(?:saying|that|:)?\s*(.+)/i) ??
    m.match(/^(?:send |)(?:a )?telegram(?: message)?(?: to)?\s+(\S+)\s+(?:saying|that|:)?\s*(.+)/i) ??
    m.match(/^(?:message|msg|text)\s+(\S+)\s+(?:saying|that|:)?\s*(.+)/i);
  if (msg) {
    const app: MessageApp = /email|mail/i.test(m) ? "email" : /telegram/i.test(m) ? "telegram" : /\bsms\b/i.test(m) ? "sms" : "whatsapp";
    const r = await call("send_message", { app, to: msg[1], text: msg[2].trim() });
    return { text: say(`Drafted it, {nick}. ${r}`, "happy"), toolCalls: calls };
  }
  // --- Open a site ---
  const open = m.match(/^(?:open|go to|launch|visit|start)\s+(.+?)[.!?]?$/i);
  if (open && !/\b(reminder|todo|to-do|note|list|door|window|up|about)\b/i.test(open[1])) {
    const target = open[1].trim();
    const yt = target.match(/^(?:youtube|yt)(?:\s+(?:and\s+)?(?:search\s+(?:for\s+)?|play\s+)?(.+))?$/i);
    if (yt?.[1]?.trim()) {
      const query = yt[1].trim();
      return { text: say(`Opening YouTube search for “${query}”, {nick}.`, "happy"), toolCalls: calls, action: { kind: "youtube_search", query, label: `Search YouTube for ${query}` } };
    }
    const r = yt ? await call("open_url", { url: "https://www.youtube.com" }) : await call("open_url", { url: target });
    return { text: say(`On it, {nick}. ${r}`, "happy"), toolCalls: calls };
  }
  // --- Play / watch something on YouTube ---
  const correctedPlay = m.match(/^(?:not|no)\s+.+?,?\s*(?:play|watch)\s+(?:me\s+)?(.+?)(?:\s+on\s+youtube)?[.!?]?$/i);
  const play = correctedPlay ?? m.match(/^(?:play|watch|find)\s+(?:me\s+)?(.+?)(?:\s+on\s+youtube)?[.!?]?$/i);
  if (play && /youtube|song|video|trailer|music|episode/i.test(lower)) {
    const q = play[1].replace(/\bon youtube\b/i, "").replace(/\b(?:a|some)\s+song\b/i, "song").trim();
    return {
      text: say(`Opening YouTube for “${q}”, {nick}. Choose the matching result and press play.`, "excited"),
      toolCalls: calls,
      action: { kind: "youtube_search", query: q, label: `Search YouTube for ${q}` },
    };
  }
  // --- Google it (opens a tab, unlike web_search which answers) ---
  const goog = m.match(/^(?:google|search google for|look up)\s+(.+)/i);
  if (goog) {
    const r = await call("search_google", { query: goog[1].trim() });
    return { text: say(`Searching, {nick}. ${r}`, "thinking"), toolCalls: calls };
  }
  // --- Native-only device controls (honest refusal) ---
  const dev = lower.match(/\b(call|turn (?:on|off)|increase|decrease)\b\s+(?:the\s+)?([a-z\s]+)/);
  if (dev && /call|flashlight|torch|volume|brightness|wifi|bluetooth/.test(lower)) {
    const r = await call("device_action", { action: dev[1], target: dev[2].trim() });
    return { text: say(r, "neutral"), toolCalls: calls };
  }
  // --- Search / who / what ---
  if (/^(who|what|where|when|which|how many|tell me about|search|google|wiki)\b/.test(lower) && m.length > 8) {
    const r = await call("web_search", { query: m.replace(/^(search|google|wiki|tell me about)\s+/i, "") });
    return { text: say(`Here's what I found, {nick}: ${r}`, "thinking"), toolCalls: calls };
  }
  // --- Greetings / small talk ---
  if (/^(hi|hey|hello|yo|namaste|konnichiwa|ohayo|good (morning|evening|night)|sup)\b/.test(lower)) {
    const hi = lang === "hi" ? `Namaste {nick}! Kaise ho? Aaj kya plan hai?` : lang === "ja" ? `やっほー {nick}! 今日はどうする？` : pick([`Hey {nick}! I was just thinking about you. What's the plan?`, `Yo {nick}! Good to see you. How are we feeling today?`]);
    return { text: say(hi, "excited"), toolCalls: calls };
  }
  if (/thank|shukriya|arigato/.test(lower)) {
    return { text: say(pick([`Anytime, {nick}. That's what I'm here for.`, `Heh, don't mention it, {nick}.`]), "shy"), toolCalls: calls };
  }
  if (/love you|you're the best|cute/.test(lower)) {
    return { text: say(pick([`W-what? {nick}... you can't just say that out of nowhere.`, `Hehe. Right back at you, {nick}.`]), "shy"), toolCalls: calls };
  }
  if (/motivat|give up|can't do|tired of|lazy/.test(lower)) {
    return { text: say(pick([`Listen, {nick}. You've survived 100% of your worst days. Five minutes. Start with just five.`, `Giving up is not in our vocabulary, {nick}. Tiny step now, big step later.`]), "excited"), toolCalls: calls };
  }
  if (/sleep|good night|goodnight|so jao/.test(lower)) {
    return { text: say(`Sleep well, {nick}. I'll guard the night. Want an alarm for tomorrow?`, "sleepy"), toolCalls: calls };
  }
  if (/who are you|your name|what can you do|help/.test(lower)) {
    return {
      text: say(`I'm ${c.name}, your personal companion, {nick}. I can do weather, reminders, todos, notes, memory, moods, search, translate, math and more. Add an API key in Settings and I get a full brain for essays, code and planning.`, "happy"),
      toolCalls: calls,
    };
  }
  // --- Fallback ---
  const fallback =
    lang === "hi"
      ? `Hmm, {nick}, offline mode me main itna deep nahi ja sakta. Settings me ek free Groq key daal do, phir main sab kuch kar dunga!`
      : pick([
          `I can handle that when a text model is available, {nick}. Right now I’m in local fallback mode, so I won’t pretend I completed it.`,
          `I’m in local fallback mode, {nick}. I can still handle weather, reminders, todos, notes, search, translate and moods, but I can’t verify that request yet.`,
        ]);
  return { text: say(fallback, "thinking"), toolCalls: calls };
}
