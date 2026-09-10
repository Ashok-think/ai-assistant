import type { AppConfig, Character, Emotion, TtsParams } from './config'

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

// Accepts "<emo=soft> text", "[soft] text", "[emotion: soft] text".
export function parseEmotion(raw: string, fallback: Emotion, known: string[]): { emotion: Emotion; text: string } {
  const m = raw.match(/^\s*(?:<emo=([a-z]+)>|\[(?:emotion:\s*)?([a-z]+)\])\s*/i)
  if (!m) return { emotion: fallback, text: raw.trim() }
  const tag = (m[1] ?? m[2]).toLowerCase()
  return {
    emotion: (known.includes(tag) ? tag : fallback) as Emotion,
    text: raw.slice(m[0].length).trim(),
  }
}

// Strip any tags that leaked into the middle of a reply too.
export function stripAllTags(text: string): string {
  return text.replace(/<emo=[a-z]+>|\[(?:emotion:\s*)?[a-z]+\]/gi, '').replace(/\s{2,}/g, ' ').trim()
}

export function ttsParams(cfg: AppConfig, ch: Character, emotion: Emotion): TtsParams {
  const base = cfg.characterEngine.emotionToTts[emotion] ?? cfg.characterEngine.emotionToTts[ch.defaultEmotion]
  const b = ch.bias ?? {}
  return {
    stability: clamp(base.stability + (b.stability ?? 0), 0, 1),
    style: clamp(base.style + (b.style ?? 0), 0, 1),
    speed: clamp(base.speed + (b.speed ?? 0), 0.7, 1.2),
  }
}

// Gemini TTS has no numeric knobs; we steer it with a natural-language prefix.
export function geminiStylePrefix(cfg: AppConfig, ch: Character, emotion: Emotion): string {
  const how = cfg.characterEngine.geminiStyleByEmotion[emotion] ?? cfg.characterEngine.geminiStyleByEmotion[ch.defaultEmotion]
  return `You are ${ch.name}: ${ch.style} Say this ${how}:`
}

export function systemPrompt(cfg: AppConfig, ch: Character): string {
  const emos = cfg.characterEngine.emotions.join(', ')
  return [
    `You are ${ch.name}, an anime-inspired companion (${ch.inspiredBy}). You are speaking out loud.`,
    `Personality: ${ch.personality}`,
    `Speaking style: ${ch.style}`,
    `Catchphrases (use sparingly, max one per reply): ${ch.catchphrases.join(' | ')}`,
    ``,
    `RULES:`,
    `1. Start EVERY reply with exactly one emotion tag: <emo=X> where X is one of: ${emos}. Nothing before it.`,
    `2. 1-2 sentences, under ~25 words, unless the user asks for detail. React first, then help.`,
    `3. Never say "As an AI", never "How can I assist", never list options, no emojis (they get read aloud).`,
    `4. If the user asks you to DO something (open an app, search, play, remind), call the matching tool AND say it in 4 words or fewer.`,
    `5. Stay in character no matter the topic.`,
  ].join('\n')
}
