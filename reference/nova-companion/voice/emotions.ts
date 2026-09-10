// Emotion tag -> ElevenLabs voice_settings.
// LLM replies start with a single tag, e.g.  "<emo=tender> Hey. Come here. Tell me what happened."
// We strip the tag before TTS and use it to pick voice settings.

export type Emotion =
  | 'neutral' | 'warm' | 'playful' | 'excited'
  | 'tender' | 'sad' | 'serious' | 'flustered' | 'sleepy'

export interface VoiceSettings {
  stability: number        // low = more expressive/variable, high = flat/steady
  similarity_boost: number
  style: number            // v2 models only; higher = more exaggerated delivery (+latency)
  use_speaker_boost: boolean
  speed: number            // 0.7 – 1.2
}

// Base values per emotion (for eleven_multilingual_v2 / eleven_turbo_v2_5).
export const EMOTION_SETTINGS: Record<Emotion, VoiceSettings> = {
  neutral:   { stability: 0.50, similarity_boost: 0.75, style: 0.20, use_speaker_boost: true, speed: 1.00 },
  warm:      { stability: 0.55, similarity_boost: 0.80, style: 0.35, use_speaker_boost: true, speed: 1.00 },
  playful:   { stability: 0.35, similarity_boost: 0.75, style: 0.65, use_speaker_boost: true, speed: 1.05 },
  excited:   { stability: 0.25, similarity_boost: 0.70, style: 0.80, use_speaker_boost: true, speed: 1.10 },
  tender:    { stability: 0.70, similarity_boost: 0.85, style: 0.30, use_speaker_boost: true, speed: 0.90 },
  sad:       { stability: 0.60, similarity_boost: 0.80, style: 0.45, use_speaker_boost: true, speed: 0.88 },
  serious:   { stability: 0.80, similarity_boost: 0.80, style: 0.15, use_speaker_boost: true, speed: 0.97 },
  flustered: { stability: 0.30, similarity_boost: 0.75, style: 0.60, use_speaker_boost: true, speed: 1.08 },
  sleepy:    { stability: 0.75, similarity_boost: 0.80, style: 0.25, use_speaker_boost: true, speed: 0.85 },
}

// Per-character voice + personality bias. Bias is added on top of the emotion values.
export interface CharacterVoice {
  voiceId: string
  bias: Partial<Pick<VoiceSettings, 'stability' | 'style' | 'speed'>>
}

// Replace voiceIds with your ElevenLabs voice IDs; rename keys to your real roster.
export const CHARACTERS: Record<string, CharacterVoice> = {
  nova: { voiceId: 'VOICE_ID_NOVA', bias: { stability: 0.00, style: +0.05, speed: 0.00 } }, // warm, witty
  kira: { voiceId: 'VOICE_ID_KIRA', bias: { stability: -0.10, style: +0.15, speed: +0.03 } }, // sharp tsundere
  sora: { voiceId: 'VOICE_ID_SORA', bias: { stability: +0.10, style: -0.10, speed: -0.05 } }, // soft, gentle
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export function parseReply(raw: string): { emotion: Emotion; text: string } {
  const m = raw.match(/^\s*<emo=([a-z]+)>\s*/i)
  const emotion = (m && m[1].toLowerCase() in EMOTION_SETTINGS ? m[1].toLowerCase() : 'neutral') as Emotion
  return { emotion, text: m ? raw.slice(m[0].length).trim() : raw.trim() }
}

export function settingsFor(character: string, emotion: Emotion): VoiceSettings {
  const base = EMOTION_SETTINGS[emotion]
  const bias = CHARACTERS[character]?.bias ?? {}
  return {
    ...base,
    stability: clamp(base.stability + (bias.stability ?? 0), 0, 1),
    style: clamp(base.style + (bias.style ?? 0), 0, 1),
    speed: clamp(base.speed + (bias.speed ?? 0), 0.7, 1.2),
  }
}

// Build the ElevenLabs TTS request. Call from a server route; never expose the API key to the browser.
export function buildTtsRequest(character: string, rawReply: string, apiKey: string) {
  const { emotion, text } = parseReply(rawReply)
  const voiceId = CHARACTERS[character]?.voiceId
  if (!voiceId) throw new Error(`Unknown character: ${character}`)
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
    init: {
      method: 'POST',
      headers: { 'xi-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2',
        voice_settings: settingsFor(character, emotion),
      }),
    } satisfies RequestInit,
    emotion,
    text,
  }
}
