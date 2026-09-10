/**
 * EMOTIONAL VOICE LAYER
 * ---------------------
 * The LLM tags every reply with an emotion ([happy], [sad], ...). This module turns that
 * tag into actual voice behaviour:
 *   - numeric knobs (stability / style / speed) for ElevenLabs
 *   - a natural-language delivery instruction for Gemini TTS + OpenAI TTS, which have no knobs
 *   - a per-character bias derived from the character's personality sliders, so a calm
 *     character stays steady and a hyper one gets loose and fast — including custom ones
 *   - PCM -> WAV wrapping, because Gemini returns raw 16-bit PCM that browsers can't play
 *
 * Ported and adapted from the Nova companion project (see reference/nova-companion/).
 */
import type { CharacterSliders } from "@/db/schema";
import { EMOTIONS, type Emotion } from "./characters";

/** ElevenLabs-style knobs. `speed` is also reused by the OpenAI/Edge/Kokoro style endpoints. */
export type TtsParams = {
  stability: number; // 0..1 — low = expressive and variable, high = flat and steady
  style: number; // 0..1 — higher = more exaggerated delivery (costs latency)
  speed: number; // 0.7..1.2
  similarityBoost: number; // 0..1
};

/** Base delivery per emotion tag. */
export const EMOTION_TTS: Record<Emotion, TtsParams> = {
  excited: { stability: 0.28, style: 0.8, speed: 1.1, similarityBoost: 0.72 },
  happy: { stability: 0.42, style: 0.6, speed: 1.05, similarityBoost: 0.78 },
  angry: { stability: 0.35, style: 0.72, speed: 1.06, similarityBoost: 0.75 },
  shy: { stability: 0.58, style: 0.45, speed: 0.95, similarityBoost: 0.82 },
  sad: { stability: 0.7, style: 0.4, speed: 0.88, similarityBoost: 0.8 },
  sleepy: { stability: 0.8, style: 0.22, speed: 0.84, similarityBoost: 0.8 },
  thinking: { stability: 0.72, style: 0.25, speed: 0.94, similarityBoost: 0.78 },
  neutral: { stability: 0.6, style: 0.22, speed: 1.0, similarityBoost: 0.78 },
};

/** Gemini TTS / OpenAI TTS take a plain-English delivery note instead of numbers. */
export const GEMINI_STYLE_BY_EMOTION: Record<Emotion, string> = {
  excited: "with huge energy, fast and bright, like you're hyping someone up",
  happy: "cheerfully and warmly, smiling the whole time",
  angry: "sharply and firmly, tense but controlled — never shouting",
  shy: "quietly and a little flustered, trailing off softly",
  sad: "gently and quietly, with real weight, slower than usual",
  sleepy: "drowsily and very slowly, half asleep, with soft pauses",
  thinking: "slowly and thoughtfully, like you're working it out mid-sentence",
  neutral: "in a calm, even, natural voice",
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * Turn the personality sliders into a voice bias. Reproduces the hand-tuned per-character
 * numbers from the source project, but works for user-created characters too.
 */
export function biasFromSliders(s: CharacterSliders): Pick<TtsParams, "stability" | "style" | "speed"> {
  const n = (v: number) => (v - 50) / 50; // 0..100 -> -1..1
  return {
    stability: n(s.calm) * 0.15 + n(s.soft) * 0.05,
    style: n(s.funny) * 0.15,
    speed: -n(s.calm) * 0.06 - n(s.soft) * 0.03,
  };
}

export function isEmotion(v: unknown): v is Emotion {
  return typeof v === "string" && (EMOTIONS as readonly string[]).includes(v);
}

export function ttsParamsFor(emotion: Emotion, sliders?: CharacterSliders | null): TtsParams {
  const base = EMOTION_TTS[emotion] ?? EMOTION_TTS.neutral;
  if (!sliders) return base;
  const b = biasFromSliders(sliders);
  return {
    stability: clamp(base.stability + b.stability, 0, 1),
    style: clamp(base.style + b.style, 0, 1),
    speed: clamp(base.speed + b.speed, 0.7, 1.2),
    similarityBoost: base.similarityBoost,
  };
}

/** Delivery instruction for engines that are steered with words, not numbers. */
export function stylePrefix(c: { name: string; speakingStyle?: string | null }, emotion: Emotion): string {
  const how = GEMINI_STYLE_BY_EMOTION[emotion] ?? GEMINI_STYLE_BY_EMOTION.neutral;
  const style = c.speakingStyle?.trim() ? ` ${c.speakingStyle.trim()}` : "";
  return `You are ${c.name}.${style} Say the following ${how}. Speak only the words, do not describe them:`;
}

/**
 * Make text safe to speak: drop emotion tags that leaked past the first one, markdown
 * decoration, and code fences (they get read out loud character by character otherwise).
 */
export function stripSpokenTags(text: string): string {
  return (text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<emo=[a-z]+>/gi, " ")
    .replace(/\[(?:emotion:\s*)?(?:happy|excited|sad|angry|shy|sleepy|neutral|thinking)\]/gi, " ")
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Gemini TTS answers with base64 16-bit little-endian mono PCM (audio/L16;rate=24000).
 * No browser will play that, so give it a RIFF/WAVE header.
 */
export function pcmToWav(pcm: Uint8Array, sampleRate = 24000, channels = 1, bits = 16): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const view = new DataView(out.buffer);
  const ascii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  const byteRate = (sampleRate * channels * bits) / 8;
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, (channels * bits) / 8, true); // block align
  view.setUint16(34, bits, true);
  ascii(36, "data");
  view.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/** Pull the sample rate out of "audio/L16;codec=pcm;rate=24000". */
export function sampleRateFromMime(mime: string | undefined, fallback = 24000): number {
  const m = /rate=(\d+)/.exec(mime ?? "");
  return m ? Number(m[1]) : fallback;
}

export function isPcmMime(mime: string | undefined): boolean {
  return /l16|pcm/i.test(mime ?? "");
}

/**
 * Default voice per built-in character, per engine.
 * Gemini names are prebuilt voices; ElevenLabs ids are public premade library voices.
 * Both are overridable per character from the Characters screen (voice.geminiVoice /
 * voice.elevenLabsVoiceId) and per request.
 */
export const CHARACTER_VOICES: Record<string, { gemini: string; elevenLabs: string; note: string }> = {
  naruto: { gemini: "Puck", elevenLabs: "TxGEqnHWrfWFTfGW9XjX", note: "Josh — young, energetic" },
  nezuko: { gemini: "Leda", elevenLabs: "pFZP5JQG7iQjIQuC4Bku", note: "Lily — soft, gentle" },
  gojo: { gemini: "Iapetus", elevenLabs: "IKne3meq5aSn9XLyUdCD", note: "Charlie — casual, cocky" },
  levi: { gemini: "Charon", elevenLabs: "onwK4e9ZLuTAKqWW03F9", note: "Daniel — deep, flat" },
  zerotwo: { gemini: "Aoede", elevenLabs: "cgSgspJ2msm6clMCkdW9", note: "Jessica — playful, teasing" },
  luffy: { gemini: "Fenrir", elevenLabs: "cjVigY5qzO86Huf0OWal", note: "Eric — warm, loud" },
  makima: { gemini: "Kore", elevenLabs: "Xb7hH8MSUJpSbSDYk0k2", note: "Alice — composed, smooth" },
};

/** All prebuilt Gemini TTS voice names (used to populate the Settings voice picker). */
export const GEMINI_VOICE_NAMES = [
  "Zephyr", "Puck", "Charon", "Kore", "Fenrir", "Leda", "Orus", "Aoede", "Callirrhoe",
  "Autonoe", "Enceladus", "Iapetus", "Umbriel", "Algieba", "Despina", "Erinome", "Algenib",
  "Rasalgethi", "Laomedeia", "Achernar", "Alnilam", "Schedar", "Gacrux", "Pulcherrima",
  "Achird", "Zubenelgenubi", "Vindemiatrix", "Sadachbia", "Sadaltager", "Sulafat",
] as const;

export const FALLBACK_GEMINI_VOICE = "Kore";
const FALLBACK_ELEVENLABS_VOICE = "Xb7hH8MSUJpSbSDYk0k2";

function voiceOf(slug: string): { gemini: string; elevenLabs: string } {
  const v = CHARACTER_VOICES[slug];
  return { gemini: v?.gemini ?? FALLBACK_GEMINI_VOICE, elevenLabs: v?.elevenLabs ?? FALLBACK_ELEVENLABS_VOICE };
}

/**
 * Voice for a user-created character. The personality sliders pick the archetype, so a new
 * character sounds like itself instead of every custom character sharing the default voice.
 */
export function pickVoiceForSliders(s: CharacterSliders): { gemini: string; elevenLabs: string } {
  if (s.soft >= 65 && s.calm >= 55) return voiceOf("nezuko"); // gentle, breathy
  if (s.calm >= 70) return voiceOf("levi"); // deep, flat
  if (s.funny >= 65 && s.soft < 50) return voiceOf("zerotwo"); // playful, teasing
  if (s.funny >= 65) return voiceOf("naruto"); // bright, energetic
  if (s.calm < 40) return voiceOf("luffy"); // warm, loud
  return voiceOf("makima"); // composed, smooth
}
