import { getActiveCharacter, getSettings } from "@/lib/bootstrap";
import { adaptivePenalty, getTtsPolicies, orderTtsProviders, recordTtsMetric, type TtsProvider } from "@/lib/tts-policy";
import type { Emotion } from "@/lib/characters";
import {
  CHARACTER_VOICES,
  FALLBACK_GEMINI_VOICE,
  isEmotion,
  isPcmMime,
  pcmToWav,
  sampleRateFromMime,
  stripSpokenTags,
  stylePrefix,
  ttsParamsFor,
} from "@/lib/voice-emotion";

export const dynamic = "force-dynamic";

type Body = {
  text?: string;
  voiceId?: string; // ElevenLabs voice id override
  geminiVoice?: string; // Gemini prebuilt voice name override
  emotion?: string;
  provider?: "gemini" | "elevenlabs" | "openrouter-fish";
  model?: string;
  policies?: Record<string, { enabled?: boolean; priority?: number; timeoutMs?: number; streaming?: boolean }>;
  voice?: string;
};

type Attempt = { provider: string; status: string | number };

/**
 * TTS proxy. Priority: Gemini (free) → ElevenLabs (paid) → 204 (browser speechSynthesis).
 *
 * The emotion tag the LLM produced drives the delivery: numeric voice settings for
 * ElevenLabs, a spoken-style instruction for Gemini. Each character has its own voice,
 * and the personality sliders bias the result. See src/lib/voice-emotion.ts.
 */
export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: "invalid JSON body" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const clean = stripSpokenTags(body.text ?? "").slice(0, 1200);
  if (!clean) return new Response(null, { status: 204 });

  const st = await getSettings();
  const character = await getActiveCharacter(st);
  const emotion: Emotion = isEmotion(body.emotion)
    ? body.emotion
    : isEmotion(character?.defaultMood)
      ? (character.defaultMood as Emotion)
      : "neutral";

  const preset = character ? CHARACTER_VOICES[character.slug] : undefined;

  // MASTER VOICE: when locked (default), the character ALWAYS uses one voice identity. Emotion
  // only changes delivery. We scale the emotion's deviation from neutral by emotionIntensity so a
  // lower setting stays closer to the neutral master delivery — identity never shifts.
  const masterOn = st.masterVoiceEnabled ?? true;
  const intensity = typeof st.emotionIntensity === "number" ? st.emotionIntensity : 1;
  const speedBase = typeof st.voiceSpeed === "number" ? st.voiceSpeed : 1;
  const raw = ttsParamsFor(emotion, masterOn ? null : character?.sliders); // ignore per-character bias when locked
  const neutral = ttsParamsFor("neutral", null);
  const lerp = (from: number, to: number) => from + (to - from) * Math.max(0, Math.min(1.5, intensity));
  const params = masterOn
    ? {
        stability: lerp(neutral.stability, raw.stability),
        style: lerp(neutral.style, raw.style),
        similarityBoost: raw.similarityBoost,
        // Speed = master base × the emotion's speed factor (also intensity-scaled).
        speed: Math.max(0.7, Math.min(1.2, speedBase * lerp(1, raw.speed))),
      }
    : raw;
  const attempts: Attempt[] = [];
  const startedAt = Date.now();
  const policies = getTtsPolicies(body.policies ?? st.ttsPolicies);

  // Respect the user's engine preference from Settings, then softly prefer providers
  // with better recent measured outcomes. Measurements are advisory, not guarantees.
  const pref = (st.ttsProvider ?? "auto") as "auto" | "gemini" | "elevenlabs" | "openrouter-fish" | "fish-audio" | "browser";
  let order: ("gemini" | "elevenlabs" | "openrouter-fish")[];
  if (body.provider) order = [body.provider];
  else if (pref === "browser") order = [];
  else if (pref === "gemini") order = ["gemini", "openrouter-fish", "elevenlabs"];
  else if (pref === "elevenlabs") order = ["elevenlabs", "openrouter-fish", "gemini"];
  else if (pref === "openrouter-fish" || pref === "fish-audio") order = ["openrouter-fish", "gemini", "elevenlabs"];
  else order = ["openrouter-fish", "gemini", "elevenlabs"];
  const configured = orderTtsProviders(policies, body.provider ?? (pref === "auto" ? undefined : pref === "fish-audio" ? "openrouter-fish" : pref)) as TtsProvider[];
  order = configured.filter((provider): provider is "gemini" | "elevenlabs" | "openrouter-fish" => order.includes(provider as typeof order[number])).sort((a, b) => (policies[a].priority + adaptivePenalty(a) / 10000) - (policies[b].priority + adaptivePenalty(b) / 10000));

  for (const provider of order) {
    const providerStartedAt = Date.now();
    const timeoutMs = policies[provider]?.timeoutMs ?? 12000;
    const recordFailure = (status: string | number) => recordTtsMetric({ provider, ok: false, timeToFirstAudioMs: null, totalAudioLatencyMs: Date.now() - providerStartedAt, bytes: 0, error: String(status), measuredAt: new Date().toISOString() });
    // ---- OpenRouter Fish Audio (OpenAI-compatible speech endpoint) ----
    if (provider === "openrouter-fish") {
      const key = process.env.OPENROUTER_API_KEY?.trim() || st.openrouterKey?.trim();
      if (!key) { attempts.push({ provider, status: "skip: no OPENROUTER_API_KEY" }); continue; }
      const model = body.model?.trim() || st.ttsModel?.trim() || "fish-audio/s2.1-pro";
      const voice = body.voice?.trim() || st.ttsVoice?.trim() || "";
      try {
        const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": new URL(req.url).origin, "X-Title": "JARVISH" },
          body: JSON.stringify({ model, input: clean, ...(voice && voice !== "default" ? { voice } : {}), response_format: "mp3" }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!r.ok) { attempts.push({ provider, status: r.status }); continue; }
        const bytes = new Uint8Array(await r.arrayBuffer());
        if (!bytes.byteLength) { attempts.push({ provider, status: "empty" }); continue; }
        attempts.push({ provider, status: 200 });
        recordTtsMetric({ provider, ok: true, timeToFirstAudioMs: Date.now() - providerStartedAt, totalAudioLatencyMs: Date.now() - startedAt, bytes: bytes.byteLength, measuredAt: new Date().toISOString() });
        return audioResponse(toArrayBuffer(bytes), "audio/mpeg", provider, `${model}:${voice}`, emotion, attempts, Date.now() - providerStartedAt);
      } catch (e) { attempts.push({ provider, status: `error: ${(e as Error).message}` }); continue; }
    }

    // ---- 1) Gemini TTS (free tier, good quality, steered with a style instruction) ----
    if (provider === "gemini") {
      const geminiKey = process.env.GEMINI_API_KEY?.trim() || st.geminiKey?.trim();
      if (!geminiKey) {
        attempts.push({ provider, status: "skip: no GEMINI_API_KEY" });
        continue;
      }
      // Locked master voice wins over per-character/preset so the identity never changes.
      const voice = masterOn
        ? st.masterGeminiVoice?.trim() || FALLBACK_GEMINI_VOICE
        : body.geminiVoice?.trim() || character?.voice?.geminiVoice?.trim() || preset?.gemini || FALLBACK_GEMINI_VOICE;
      // Emotion still steers DELIVERY via a spoken-style instruction (identity unchanged).
      const prefix = character ? stylePrefix(character, emotion) : "";
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prefix ? `${prefix} ${clean}` : clean }] }],
              generationConfig: {
                responseModalities: ["AUDIO"],
                speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
              },
            }),
            signal: AbortSignal.timeout(timeoutMs),
          },
        );
        if (!r.ok) {
          attempts.push({ provider, status: r.status });
          continue;
        }
        const j = (await r.json()) as {
          candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[];
        };
        const audio = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
        if (!audio?.data) {
          attempts.push({ provider, status: "empty" });
          continue;
        }
        const raw = Buffer.from(audio.data, "base64");
        // Gemini hands back headerless 16-bit PCM — wrap it so <audio> can play it.
        const bytes = isPcmMime(audio.mimeType)
          ? pcmToWav(new Uint8Array(raw), sampleRateFromMime(audio.mimeType))
          : new Uint8Array(raw);
        const mime = isPcmMime(audio.mimeType) ? "audio/wav" : audio.mimeType || "audio/mpeg";
        attempts.push({ provider, status: 200 });
        recordTtsMetric({ provider, ok: true, timeToFirstAudioMs: Date.now() - providerStartedAt, totalAudioLatencyMs: Date.now() - startedAt, bytes: bytes.byteLength, measuredAt: new Date().toISOString() });
        return audioResponse(toArrayBuffer(bytes), mime, provider, voice, emotion, attempts, Date.now() - providerStartedAt);
      } catch (e) {
        attempts.push({ provider, status: `error: ${(e as Error).message}` });
        continue;
      }
    }

    // ---- 2) ElevenLabs (paid, premium quality, emotion-aware voice settings) ----
    const elevenKey = process.env.ELEVENLABS_API_KEY?.trim() || st.elevenLabsKey?.trim();
    if (!elevenKey) {
      attempts.push({ provider, status: "skip: no ELEVENLABS_API_KEY" });
      continue;
    }
    // Locked master ElevenLabs voice (or clone) wins; falls back to a single default female id.
    const vid = masterOn
      ? st.masterElevenVoiceId?.trim() || process.env.ELEVENLABS_VOICE_ID?.trim() || "EXAVITQu4vr4xnSDxMaL"
      : body.voiceId?.trim() || character?.voice?.elevenLabsVoiceId?.trim() || preset?.elevenLabs || process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
    try {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${vid}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": elevenKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: clean,
          model_id: process.env.ELEVENLABS_MODEL?.trim() || "eleven_multilingual_v2",
          voice_settings: {
            stability: params.stability,
            similarity_boost: params.similarityBoost,
            style: params.style,
            speed: params.speed,
            use_speaker_boost: true,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!r.ok) {
        attempts.push({ provider, status: r.status });
        continue;
      }
      attempts.push({ provider, status: 200 });
      recordTtsMetric({ provider, ok: true, timeToFirstAudioMs: Date.now() - providerStartedAt, totalAudioLatencyMs: Date.now() - startedAt, bytes: Number(r.headers.get("content-length") ?? 0), measuredAt: new Date().toISOString() });
      return audioResponse(r.body, "audio/mpeg", provider, vid, emotion, attempts, Date.now() - providerStartedAt);
    } catch (e) {
      attempts.push({ provider, status: `error: ${(e as Error).message}` });
    }
  }

  // ---- 3) Nothing available → let the browser speak it (honest reason for the UI) ----
  return new Response(null, {
    status: 204,
    headers: {
      "X-TTS-Attempts": JSON.stringify(attempts),
      "X-TTS-Emotion": emotion,
      "X-TTS-Fallback-Reason": fallbackReason(attempts),
    },
  });
}

/**
 * Turn the per-provider attempt log into one honest, user-facing reason for the browser fallback.
 * Never claims premium quality — this is exactly why the browser voice is speaking.
 */
function fallbackReason(attempts: Attempt[]): string {
  const fish = attempts.find((a) => a.provider === "openrouter-fish");
  const gem = attempts.find((a) => a.provider === "gemini");
  const el = attempts.find((a) => a.provider === "elevenlabs");
  const parts: string[] = [];
  if (fish) {
    if (typeof fish.status === "string" && fish.status.startsWith("skip")) parts.push("no OpenRouter key");
    else if (fish.status !== 200) parts.push(`Fish Audio TTS error ${fish.status}`);
  }
  if (gem) {
    if (gem.status === 429) parts.push("Gemini TTS rate/quota limit (429)");
    else if (typeof gem.status === "string" && gem.status.startsWith("skip")) parts.push("no Gemini key");
    else if (gem.status !== 200) parts.push(`Gemini TTS error ${gem.status}`);
  }
  if (el) {
    if (el.status === 401) parts.push("ElevenLabs auth/account restriction (401)");
    else if (typeof el.status === "string" && el.status.startsWith("skip")) parts.push("no ElevenLabs key");
    else if (el.status !== 200) parts.push(`ElevenLabs error ${el.status}`);
  }
  return parts.length ? parts.join(" · ") : "no server TTS provider available";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function audioResponse(
  payload: BodyInit | null,
  mime: string,
  provider: string,
  voice: string,
  emotion: Emotion,
  attempts: Attempt[],
  timeToFirstAudioMs: number,
) {
  return new Response(payload, {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "X-TTS-Provider": provider,
      "X-TTS-Voice": voice,
      "X-TTS-Time-To-First-Audio-Ms": String(timeToFirstAudioMs),
      "X-TTS-Emotion": emotion,
      "X-TTS-Attempts": JSON.stringify(attempts),
    },
  });
}
