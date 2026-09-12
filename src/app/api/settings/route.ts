import { db } from "@/db";
import { settings } from "@/db/schema";
import { getSettings } from "@/lib/bootstrap";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "assistantName", "wakeWord", "userName", "language", "activeCharacterId", "freeOnlyMode", "safeMode", "lowPowerMode",
  "voiceEnabled", "wakeWordEnabled", "proactiveEnabled", "dailyBudgetUsd", "routerMode", "openaiKey", "groqKey",
  "openrouterKey", "geminiKey", "elevenLabsKey", "ollamaUrl", "permissions", "ttsProvider", "ttsModel", "ttsVoice", "chatModelMode", "chatProvider", "chatModel", "thinkingModelMode", "thinkingProvider", "thinkingModel",
  "masterVoiceEnabled", "masterGeminiVoice", "masterElevenVoiceId", "voiceSpeed", "emotionIntensity",
  "customVoiceStatus", "renderMode", "lipSyncEnabled",
  "tokenrouterKey", "tokenrouterBaseUrl", "tokenrouterModel",
  "qwenKey", "qwenBaseUrl", "qwenModel",
  "aihubKey", "aihubBaseUrl", "aihubModel",
  "customKey", "customBaseUrl", "customModel",
  "groqBaseUrl", "groqFastModel", "groqSmartModel",
  "openaiBaseUrl", "openaiFastModel", "openaiSmartModel",
  "openrouterBaseUrl", "openrouterFastModel", "openrouterSmartModel",
  "geminiFastModel", "geminiSmartModel", "ollamaModel",
]);

export async function GET() {
  const st = await getSettings();
  return Response.json({
    ...st,
    openaiKey: st.openaiKey ? "••••" : "",
    groqKey: st.groqKey ? "••••" : "",
    openrouterKey: st.openrouterKey ? "••••" : "",
    geminiKey: st.geminiKey ? "••••" : "",
    elevenLabsKey: st.elevenLabsKey ? "••••" : "",
    tokenrouterKey: st.tokenrouterKey ? "••••" : "",
    qwenKey: st.qwenKey ? "••••" : "",
    aihubKey: st.aihubKey ? "••••" : "",
    customKey: st.customKey ? "••••" : "",
    envKeys: {
      openai: Boolean(process.env.OPENAI_API_KEY), groq: Boolean(process.env.GROQ_API_KEY),
      openrouter: Boolean(process.env.OPENROUTER_API_KEY), gemini: Boolean(process.env.GEMINI_API_KEY),
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY), ollama: Boolean(process.env.OLLAMA_BASE_URL),
      tokenrouter: Boolean(process.env.TOKENROUTER_API_KEY), qwen: Boolean(process.env.QWEN_API_KEY),
      aihub: Boolean(process.env.AIHUB_API_KEY), custom: Boolean(process.env.CUSTOM_LLM_API_KEY),
    },
  });
}

export async function PATCH(req: Request) {
  await getSettings();
  const body = (await req.json()) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!ALLOWED.has(k)) continue;
    if (typeof v === "string" && v === "••••") continue; // masked, unchanged
    patch[k] = v === "" ? null : v;
  }
  if (typeof patch.wakeWord === "string") patch.wakeWord = patch.wakeWord.toLowerCase().trim();
  patch.updatedAt = new Date();
  const [row] = await db.update(settings).set(patch).where(eq(settings.id, 1)).returning().all();
  return Response.json({
    ok: true,
    settings: {
      ...row,
      openaiKey: row.openaiKey ? "••••" : "",
      groqKey: row.groqKey ? "••••" : "",
      openrouterKey: row.openrouterKey ? "••••" : "",
      geminiKey: row.geminiKey ? "••••" : "",
      elevenLabsKey: row.elevenLabsKey ? "••••" : "",
      tokenrouterKey: row.tokenrouterKey ? "••••" : "",
      qwenKey: row.qwenKey ? "••••" : "",
      aihubKey: row.aihubKey ? "••••" : "",
      customKey: row.customKey ? "••••" : "",
    },
  });
}
