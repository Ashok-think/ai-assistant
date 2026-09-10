import {
  sqliteTable,
  text,
  integer,
  real,
} from "drizzle-orm/sqlite-core";

// ---------- Settings (single row, id = 1) ----------
export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assistantName: text("assistant_name").notNull().default("Nova"),
  wakeWord: text("wake_word").notNull().default("hey nova"),
  userName: text("user_name").notNull().default("Boss"),
  language: text("language").notNull().default("auto"), // auto | en | hi | hinglish | ja
  activeCharacterId: integer("active_character_id"),
  freeOnlyMode: integer("free_only_mode", { mode: "boolean" }).notNull().default(false),
  safeMode: integer("safe_mode", { mode: "boolean" }).notNull().default(false),
  lowPowerMode: integer("low_power_mode", { mode: "boolean" }).notNull().default(false),
  voiceEnabled: integer("voice_enabled", { mode: "boolean" }).notNull().default(true),
  wakeWordEnabled: integer("wake_word_enabled", { mode: "boolean" }).notNull().default(false),
  // TTS engine preference: auto (Gemini→ElevenLabs→browser) | gemini | elevenlabs | browser
  ttsProvider: text("tts_provider").notNull().default("auto"),
  // ---- Master character voice (ONE locked voice identity across every response) ----
  masterVoiceEnabled: integer("master_voice_enabled", { mode: "boolean" }).notNull().default(true),
  masterGeminiVoice: text("master_gemini_voice").notNull().default("Leda"), // warm female prebuilt
  masterElevenVoiceId: text("master_eleven_voice_id"), // set when a real ElevenLabs voice/clone exists
  voiceSpeed: real("voice_speed").notNull().default(1.0), // 0.7..1.2 base speaking rate
  emotionIntensity: real("emotion_intensity").notNull().default(1.0), // 0..1.5 scales delivery, not identity
  // Custom voice clone status: "none" | "reference_ready" | "active"
  customVoiceStatus: text("custom_voice_status").notNull().default("none"),
  // Character renderer: "video" (emotion clips) | "avatar" (procedural, true lip-sync)
  renderMode: text("render_mode").notNull().default("avatar"),
  lipSyncEnabled: integer("lip_sync_enabled", { mode: "boolean" }).notNull().default(true),
  proactiveEnabled: integer("proactive_enabled", { mode: "boolean" }).notNull().default(true),
  dailyBudgetUsd: real("daily_budget_usd").notNull().default(1.0),
  routerMode: text("router_mode").notNull().default("auto"), // auto | fast | smart | local
  // BYOK keys (env vars take priority). Stored for personal use.
  openaiKey: text("openai_key"),
  groqKey: text("groq_key"),
  openrouterKey: text("openrouter_key"),
  geminiKey: text("gemini_key"),
  elevenLabsKey: text("elevenlabs_key"),
  ollamaUrl: text("ollama_url"),
  // Per-provider model + base-URL overrides for the built-in providers (blank = use default)
  groqBaseUrl: text("groq_base_url"),
  groqFastModel: text("groq_fast_model"),
  groqSmartModel: text("groq_smart_model"),
  openaiBaseUrl: text("openai_base_url"),
  openaiFastModel: text("openai_fast_model"),
  openaiSmartModel: text("openai_smart_model"),
  openrouterBaseUrl: text("openrouter_base_url"),
  openrouterFastModel: text("openrouter_fast_model"),
  openrouterSmartModel: text("openrouter_smart_model"),
  geminiFastModel: text("gemini_fast_model"),
  geminiSmartModel: text("gemini_smart_model"),
  ollamaModel: text("ollama_model"),
  // OpenAI-compatible providers (key + base URL + model id, like jarvish 1.0)
  tokenrouterKey: text("tokenrouter_key"),
  tokenrouterBaseUrl: text("tokenrouter_base_url"),
  tokenrouterModel: text("tokenrouter_model"),
  qwenKey: text("qwen_key"),
  qwenBaseUrl: text("qwen_base_url"),
  qwenModel: text("qwen_model"),
  aihubKey: text("aihub_key"),
  aihubBaseUrl: text("aihub_base_url"),
  aihubModel: text("aihub_model"),
  customKey: text("custom_key"),
  customBaseUrl: text("custom_base_url"),
  customModel: text("custom_model"),
  permissions: text("permissions", { mode: "json" })
    .$type<Record<string, boolean>>()
    .notNull()
    .default({ mic: false, camera: false, location: false, notifications: false }),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Characters ----------
export type CharacterSliders = { funny: number; soft: number; calm: number }; // 0..100
export type VoiceSettings = {
  pitch: number; // 0.5 - 2
  rate: number; // 0.5 - 2
  warmth: number; // 0 - 100
  elevenLabsVoiceId?: string;
  geminiVoice?: string; // Aoede, Charon, Fenrir, Kore, Puck
  lang?: string;
};

export const characters = sqliteTable("characters", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  tagline: text("tagline").notNull().default(""),
  emoji: text("emoji").notNull().default("✨"),
  color: text("color").notNull().default("#7c3aed"),
  accent: text("accent").notNull().default("#22d3ee"),
  personalityPrompt: text("personality_prompt").notNull(),
  speakingStyle: text("speaking_style").notNull().default(""),
  catchphrases: text("catchphrases", { mode: "json" }).$type<string[]>().notNull().default([]),
  nickname: text("nickname").notNull().default(""), // what they call the user
  sliders: text("sliders", { mode: "json" }).$type<CharacterSliders>().notNull().default({ funny: 50, soft: 50, calm: 50 }),
  voice: text("voice", { mode: "json" }).$type<VoiceSettings>().notNull().default({ pitch: 1, rate: 1, warmth: 50 }),
  defaultMood: text("default_mood").notNull().default("happy"),
  isCustom: integer("is_custom", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Conversations & messages ----------
export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull().default("New chat"),
  characterId: integer("character_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export type ToolCallLog = { name: string; args: Record<string, unknown>; result: string };

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // user | assistant | system
  content: text("content").notNull(),
  characterId: integer("character_id"),
  emotion: text("emotion"),
  model: text("model"),
  tier: text("tier"),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  toolCalls: text("tool_calls", { mode: "json" }).$type<ToolCallLog[]>().notNull().default([]),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Long-term memory ----------
export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull().default("fact"), // fact | preference | goal | event | person
  content: text("content").notNull(),
  importance: integer("importance").notNull().default(3), // 1..5
  source: text("source").notNull().default("auto"), // auto | user
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Productivity ----------
export const reminders = sqliteTable("reminders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  dueAt: integer("due_at", { mode: "timestamp_ms" }).notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  notified: integer("notified", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  body: text("body").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const moods = sqliteTable("moods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  mood: text("mood").notNull(), // great | good | okay | low | bad
  note: text("note").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Skills / plugins ----------
export const skills = sqliteTable("skills", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  category: text("category").notNull().default("general"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  builtin: integer("builtin", { mode: "boolean" }).notNull().default(true),
  requiresKey: text("requires_key"),
});

// ---------- Routines ----------
export type RoutineStep = { tool: string; args: Record<string, unknown> };
export const routines = sqliteTable("routines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  steps: text("steps", { mode: "json" }).$type<RoutineStep[]>().notNull().default([]),
  schedule: text("schedule").notNull().default(""), // e.g. "07:00"
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Token router usage logs ----------
export const usageLogs = sqliteTable("usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  provider: text("provider").notNull(),
  model: text("model").notNull(),
  tier: text("tier").notNull(), // fast | smart | local | offline
  reason: text("reason").notNull().default(""),
  tokensIn: integer("tokens_in").notNull().default(0),
  tokensOut: integer("tokens_out").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  latencyMs: integer("latency_ms").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// ---------- Agent runs ----------
export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  goal: text("goal").notNull(),
  status: text("status").notNull().default("running"), // running | done | failed
  steps: text("steps", { mode: "json" }).$type<{ title: string; status: string; detail?: string }[]>().notNull().default([]),
  result: text("result").notNull().default(""),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
