import { client, db } from "@/db";
import { characters, settings, skills, routines } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_CHARACTERS } from "./characters";
import { SKILL_CATALOG } from "./tools";
import { CHARACTER_VOICES } from "./voice-emotion";

let seeded = false;

/** Create all tables if they don't exist. Runs raw SQL for maximum compatibility. */
async function ensureTables() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      assistant_name TEXT NOT NULL DEFAULT 'Nova',
      wake_word TEXT NOT NULL DEFAULT 'hey nova',
      user_name TEXT NOT NULL DEFAULT 'Boss',
      language TEXT NOT NULL DEFAULT 'auto',
      active_character_id INTEGER,
      free_only_mode INTEGER NOT NULL DEFAULT 0,
      safe_mode INTEGER NOT NULL DEFAULT 0,
      low_power_mode INTEGER NOT NULL DEFAULT 0,
      voice_enabled INTEGER NOT NULL DEFAULT 1,
      wake_word_enabled INTEGER NOT NULL DEFAULT 0,
      proactive_enabled INTEGER NOT NULL DEFAULT 1,
      daily_budget_usd REAL NOT NULL DEFAULT 1.0,
      router_mode TEXT NOT NULL DEFAULT 'auto',
      tts_provider TEXT NOT NULL DEFAULT 'auto',
      tts_model TEXT NOT NULL DEFAULT 'fish-audio/s2.1-pro',
      tts_voice TEXT NOT NULL DEFAULT 'default',
      chat_model_mode TEXT NOT NULL DEFAULT 'auto',
      chat_provider TEXT,
      chat_model TEXT,
      thinking_model_mode TEXT NOT NULL DEFAULT 'auto',
      thinking_provider TEXT,
      thinking_model TEXT,
      openai_key TEXT,
      groq_key TEXT,
      openrouter_key TEXT,
      gemini_key TEXT,
      elevenlabs_key TEXT,
      ollama_url TEXT,
      tokenrouter_key TEXT,
      tokenrouter_base_url TEXT,
      tokenrouter_model TEXT,
      qwen_key TEXT,
      qwen_base_url TEXT,
      qwen_model TEXT,
      aihub_key TEXT,
      aihub_base_url TEXT,
      aihub_model TEXT,
      custom_key TEXT,
      custom_base_url TEXT,
      custom_model TEXT,
      permissions TEXT NOT NULL DEFAULT '{"mic":false,"camera":false,"location":false,"notifications":false}',
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      tagline TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '✨',
      color TEXT NOT NULL DEFAULT '#7c3aed',
      accent TEXT NOT NULL DEFAULT '#22d3ee',
      personality_prompt TEXT NOT NULL,
      speaking_style TEXT NOT NULL DEFAULT '',
      catchphrases TEXT NOT NULL DEFAULT '[]',
      nickname TEXT NOT NULL DEFAULT '',
      sliders TEXT NOT NULL DEFAULT '{"funny":50,"soft":50,"calm":50}',
      voice TEXT NOT NULL DEFAULT '{"pitch":1,"rate":1,"warmth":50}',
      default_mood TEXT NOT NULL DEFAULT 'happy',
      is_custom INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL DEFAULT 'New chat',
      character_id INTEGER,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      character_id INTEGER,
      emotion TEXT,
      model TEXT,
      tier TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      importance INTEGER NOT NULL DEFAULT 3,
      source TEXT NOT NULL DEFAULT 'auto',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS moods (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mood TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'general',
      enabled INTEGER NOT NULL DEFAULT 1,
      builtin INTEGER NOT NULL DEFAULT 1,
      requires_key TEXT
    );

    CREATE TABLE IF NOT EXISTS routines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      steps TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      tier TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      latency_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      steps TEXT NOT NULL DEFAULT '[]',
      result TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );
  `);
}

/** Add columns that were introduced after the initial schema (CREATE TABLE IF NOT EXISTS doesn't touch existing DBs). */
async function migrate() {
  const cols = await client.execute("PRAGMA table_info(settings)");
  const have = new Set(cols.rows.map((c) => String(c.name)));
  const added: [string, string][] = [
    ["tokenrouter_key", "TEXT"], ["tokenrouter_base_url", "TEXT"], ["tokenrouter_model", "TEXT"],
    ["qwen_key", "TEXT"], ["qwen_base_url", "TEXT"], ["qwen_model", "TEXT"],
    ["aihub_key", "TEXT"], ["aihub_base_url", "TEXT"], ["aihub_model", "TEXT"],
    ["custom_key", "TEXT"], ["custom_base_url", "TEXT"], ["custom_model", "TEXT"],
    // Voice and model selection preferences
    ["tts_provider", "TEXT NOT NULL DEFAULT 'auto'"], ["tts_model", "TEXT NOT NULL DEFAULT 'fish-audio/s2.1-pro'"], ["tts_voice", "TEXT NOT NULL DEFAULT 'default'"],
    ["chat_model_mode", "TEXT NOT NULL DEFAULT 'auto'"], ["chat_provider", "TEXT"], ["chat_model", "TEXT"], ["thinking_model_mode", "TEXT NOT NULL DEFAULT 'auto'"], ["thinking_provider", "TEXT"], ["thinking_model", "TEXT"],
    // Master character voice (one locked identity + emotion-as-delivery)
    ["master_voice_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["master_gemini_voice", "TEXT NOT NULL DEFAULT 'Leda'"],
    ["master_eleven_voice_id", "TEXT"],
    ["voice_speed", "REAL NOT NULL DEFAULT 1.0"],
    ["emotion_intensity", "REAL NOT NULL DEFAULT 1.0"],
    ["custom_voice_status", "TEXT NOT NULL DEFAULT 'none'"],
    ["render_mode", "TEXT NOT NULL DEFAULT 'avatar'"],
    ["lip_sync_enabled", "INTEGER NOT NULL DEFAULT 1"],
    // Per-provider model + base-URL overrides for the built-in providers (task 6)
    ["groq_base_url", "TEXT"], ["groq_fast_model", "TEXT"], ["groq_smart_model", "TEXT"],
    ["openai_base_url", "TEXT"], ["openai_fast_model", "TEXT"], ["openai_smart_model", "TEXT"],
    ["openrouter_base_url", "TEXT"], ["openrouter_fast_model", "TEXT"], ["openrouter_smart_model", "TEXT"],
    ["gemini_fast_model", "TEXT"], ["gemini_smart_model", "TEXT"],
    ["ollama_model", "TEXT"],
  ];
  for (const [name, type] of added) {
    if (!have.has(name)) await client.execute(`ALTER TABLE settings ADD COLUMN ${name} ${type}`);
  }
  await backfillCharacterVoices();
  // The prerecorded MP4 must never be the live conversational renderer. Any existing
  // renderMode='video' is migrated to the live avatar (video stays available as a preview only).
  try {
    await client.execute("UPDATE settings SET render_mode='avatar' WHERE render_mode='video'");
  } catch {
    /* column may not exist on very old DBs; ensureTables/migrate handles that */
  }
  try {
    await client.execute("UPDATE settings SET tts_model='fish-audio/s2.1-pro' WHERE tts_model='fish-audio/s2.1-pro:free' OR tts_model='fish-audio/s2.1-pro-free:free' OR tts_model IS NULL OR tts_model=''");
  } catch {
    /* ignore */
  }
  // Default wake word is "hey rio" (the character is Rio). Migrate the old default only.
  try {
    await client.execute("UPDATE settings SET wake_word='hey rio' WHERE wake_word='hey nova' OR wake_word IS NULL OR wake_word=''");
  } catch {
    /* ignore */
  }
}

/** Give the built-in characters their per-engine voices (added after the first release). */
async function backfillCharacterVoices() {
  for (const [slug, v] of Object.entries(CHARACTER_VOICES)) {
    const [row] = await db.select().from(characters).where(eq(characters.slug, slug)).all();
    if (!row) continue;
    if (row.voice?.geminiVoice && row.voice?.elevenLabsVoiceId) continue;
    await db
      .update(characters)
      .set({ voice: { ...row.voice, geminiVoice: row.voice?.geminiVoice ?? v.gemini, elevenLabsVoiceId: row.voice?.elevenLabsVoiceId ?? v.elevenLabs } })
      .where(eq(characters.id, row.id))
      .run();
  }
}

export async function ensureSeeded() {
  if (seeded) return;
  await ensureTables();
  await migrate();

  const existing = await db.select().from(characters).limit(1).all();
  if (existing.length === 0) {
    for (const c of DEFAULT_CHARACTERS) {
      const preset = CHARACTER_VOICES[c.slug];
      await db
        .insert(characters)
        .values({
          ...c,
          voice: preset ? { ...c.voice, geminiVoice: preset.gemini, elevenLabsVoiceId: preset.elevenLabs } : c.voice,
          isCustom: false,
        })
        .run();
    }
  }
  for (const s of SKILL_CATALOG) {
    try {
      await db.insert(skills)
        .values({ key: s.key, name: s.name, description: s.description, category: s.category, requiresKey: s.requiresKey ?? null, enabled: !s.requiresKey, builtin: true })
        .onConflictDoNothing()
        .run();
    } catch { /* already exists */ }
  }
  const [st] = await db.select().from(settings).where(eq(settings.id, 1)).all();
  if (!st) {
    const [first] = await db.select().from(characters).where(eq(characters.slug, "naruto")).all();
    await db.insert(settings).values({ id: 1, activeCharacterId: first?.id ?? null }).run();
  }
  const rt = await db.select().from(routines).limit(1).all();
  if (rt.length === 0) {
    await db.insert(routines).values([
      {
        name: "Good Morning Routine",
        description: "Weather + upcoming reminders + todos + a motivational line in character voice.",
        schedule: "07:00",
        steps: [
          { tool: "get_weather", args: { city: "Delhi" } },
          { tool: "list_reminders", args: {} },
          { tool: "list_todos", args: {} },
          { tool: "tell_joke", args: {} },
        ],
      },
      {
        name: "Wind Down",
        description: "Review tomorrow, log mood, set alarm.",
        schedule: "22:30",
        steps: [
          { tool: "list_reminders", args: {} },
          { tool: "set_reminder", args: { title: "Wake up", when: "tomorrow 7am" } },
        ],
      },
    ]).run();
  }
  seeded = true;
}

export async function getSettings() {
  await ensureSeeded();
  const [st] = await db.select().from(settings).where(eq(settings.id, 1)).all();
  return st;
}

export async function getActiveCharacter(st?: typeof settings.$inferSelect) {
  const s = st ?? await getSettings();
  if (s.activeCharacterId) {
    const [c] = await db.select().from(characters).where(eq(characters.id, s.activeCharacterId)).all();
    if (c) return c;
  }
  const [c] = await db.select().from(characters).limit(1).all();
  return c;
}
