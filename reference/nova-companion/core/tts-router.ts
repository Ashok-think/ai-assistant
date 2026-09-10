import type { AppConfig, Character, Emotion, Env, VoiceProviderId } from './config'
import { resolveHeaders, substituteEnv } from './config'
import { geminiStylePrefix, parseEmotion, stripAllTags, ttsParams } from './emotion'

export interface TtsResult {
  audio: ArrayBuffer
  mime: string
  provider: VoiceProviderId
  voice: string
  emotion: Emotion
  text: string
  ms: number
  attempts: { provider: VoiceProviderId; status: number | string; ms: number }[]
}

export interface TtsLogEntry {
  ts: string; character: string; provider: VoiceProviderId | 'none'; voice: string; emotion: Emotion; ms: number; ok: boolean; error?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// ---- ElevenLabs voice-name resolution (cached per isolate, 10 min) ------------------------
let elVoiceCache: { at: number; byName: Map<string, string> } | null = null

export async function resolveElevenVoices(cfg: AppConfig, env: Env, log: Console = console): Promise<Map<string, string>> {
  if (elVoiceCache && Date.now() - elVoiceCache.at < 10 * 60_000) return elVoiceCache.byName
  const prov = cfg.voiceRoutes.providers.elevenlabs
  const headers = resolveHeaders(prov.headers, env)
  const byName = new Map<string, string>()
  if (!headers['xi-api-key']) return byName
  try {
    const r = await fetch(prov.voicesUrl ?? 'https://api.elevenlabs.io/v1/voices', { headers })
    if (r.ok) {
      const j: any = await r.json()
      for (const v of j.voices ?? []) byName.set(String(v.name).toLowerCase(), v.voice_id)
      log.info(`[tts] ElevenLabs voices loaded: ${byName.size}`)
    } else log.warn(`[tts] ElevenLabs /v1/voices -> ${r.status}`)
  } catch (e) { log.warn(`[tts] ElevenLabs /v1/voices failed: ${(e as Error).message}`) }
  elVoiceCache = { at: Date.now(), byName }
  return byName
}

export async function elevenVoiceId(cfg: AppConfig, ch: Character, env: Env, override?: string, log: Console = console): Promise<string> {
  if (override?.trim()) { log.info(`[tts] ElevenLabs voice: user-pasted id ${override}`); return override.trim() }
  const pasted = cfg.voiceRoutes.providers.elevenlabs.userPastedId
  if (pasted?.trim()) { log.info(`[tts] ElevenLabs voice: settings-pasted id ${pasted}`); return pasted.trim() }
  const byName = await resolveElevenVoices(cfg, env, log)
  const found = byName.get(ch.voice.elevenlabs.name.toLowerCase())
  if (found) { log.info(`[tts] ElevenLabs voice "${ch.voice.elevenlabs.name}" matched by name -> ${found}`); return found }
  log.info(`[tts] ElevenLabs voice "${ch.voice.elevenlabs.name}" not found by name, using hard-coded id ${ch.voice.elevenlabs.id}`)
  return ch.voice.elevenlabs.id
}

// ---- Provider adapters --------------------------------------------------------------------
type AdapterArgs = { cfg: AppConfig; ch: Character; env: Env; text: string; emotion: Emotion; voiceOverride?: string; log: Console }
type Adapter = (a: AdapterArgs) => Promise<{ res: Response; voice: string } | { skip: string }>

const adapters: Record<VoiceProviderId, Adapter> = {
  async elevenlabs({ cfg, ch, env, text, emotion, voiceOverride, log }) {
    const prov = cfg.voiceRoutes.providers.elevenlabs
    const headers = resolveHeaders(prov.headers, env)
    if (!headers['xi-api-key']) return { skip: 'no ELEVENLABS_API_KEY' }
    const voice = await elevenVoiceId(cfg, ch, env, voiceOverride, log)
    const p = ttsParams(cfg, ch, emotion)
    const url = substituteEnv(prov.baseUrl, env).replace('{voice_id}', voice) + '?output_format=mp3_44100_128'
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text, model_id: prov.model ?? 'eleven_multilingual_v2',
        voice_settings: { stability: p.stability, style: p.style, speed: p.speed, similarity_boost: 0.8, use_speaker_boost: true },
      }),
    })
    return { res, voice }
  },

  async gemini_tts({ cfg, ch, env, text, emotion, voiceOverride }) {
    const prov = cfg.voiceRoutes.providers.gemini_tts
    const headers = resolveHeaders(prov.headers, env)
    if (!headers['x-goog-api-key']) return { skip: 'no GEMINI_API_KEY' }
    const voice = voiceOverride?.trim() || ch.voice.gemini
    const prefix = geminiStylePrefix(cfg, ch, emotion)
    const res = await fetch(substituteEnv(prov.baseUrl, env), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${prefix} ${text}` }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    })
    return { res, voice }
  },

  async edge_tts({ cfg, ch, env, text, emotion, voiceOverride }) {
    // openai-edge-tts compatible proxy (default localhost:5050)
    const prov = cfg.voiceRoutes.providers.edge_tts
    const voice = voiceOverride?.trim() || ch.voice.edge
    const p = ttsParams(cfg, ch, emotion)
    const res = await fetch(substituteEnv(prov.baseUrl, env), {
      method: 'POST',
      headers: { ...resolveHeaders(prov.headers, env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'tts-1', input: text, voice, speed: p.speed, response_format: 'mp3' }),
    })
    return { res, voice }
  },

  async kokoro_local({ cfg, ch, env, text, emotion, voiceOverride }) {
    const prov = cfg.voiceRoutes.providers.kokoro_local
    const voice = voiceOverride?.trim() || ch.voice.kokoro
    const p = ttsParams(cfg, ch, emotion)
    const res = await fetch(substituteEnv(prov.baseUrl, env), {
      method: 'POST',
      headers: { ...resolveHeaders(prov.headers, env), 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: prov.model ?? 'kokoro', input: text, voice, speed: p.speed, response_format: 'mp3' }),
    })
    return { res, voice }
  },

  async openai_tts({ cfg, ch, env, text, emotion, voiceOverride }) {
    const prov = cfg.voiceRoutes.providers.openai_tts
    const headers = resolveHeaders(prov.headers, env)
    if (!headers['Authorization']) return { skip: 'no OPENAI_API_KEY' }
    const voice = voiceOverride?.trim() || ch.voice.openai
    const p = ttsParams(cfg, ch, emotion)
    const res = await fetch(substituteEnv(prov.baseUrl, env), {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: prov.model ?? 'gpt-4o-mini-tts', input: text, voice, speed: p.speed, response_format: 'mp3',
        instructions: geminiStylePrefix(cfg, ch, emotion),
      }),
    })
    return { res, voice }
  },
}

// Gemini returns base64 PCM inside JSON; wrap in a WAV header so browsers can play it.
async function extractAudio(provider: VoiceProviderId, res: Response): Promise<{ audio: ArrayBuffer; mime: string } | null> {
  if (provider !== 'gemini_tts') {
    const buf = await res.arrayBuffer()
    if (buf.byteLength < 100) return null
    return { audio: buf, mime: res.headers.get('content-type') ?? 'audio/mpeg' }
  }
  const j: any = await res.json()
  const part = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)
  if (!part) return null
  const pcm = Uint8Array.from(atob(part.inlineData.data), c => c.charCodeAt(0))
  const rateM = String(part.inlineData.mimeType ?? '').match(/rate=(\d+)/)
  return { audio: pcmToWav(pcm, rateM ? +rateM[1] : 24000), mime: 'audio/wav' }
}

function pcmToWav(pcm: Uint8Array, sampleRate: number, channels = 1, bits = 16): ArrayBuffer {
  const header = new ArrayBuffer(44); const v = new DataView(header)
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, channels, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * channels * bits / 8, true)
  v.setUint16(32, channels * bits / 8, true); v.setUint16(34, bits, true); w(36, 'data'); v.setUint32(40, pcm.length, true)
  const out = new Uint8Array(44 + pcm.length); out.set(new Uint8Array(header)); out.set(pcm, 44)
  return out.buffer
}

// ---- Router ------------------------------------------------------------------------------
export class TTSRouter {
  readonly log: TtsLogEntry[] = []
  constructor(private cfg: AppConfig, private env: Env, private logger: Console = console) {}

  async speak(opts: { character: Character; rawReply: string; provider?: VoiceProviderId; voiceOverride?: string }): Promise<TtsResult> {
    const ch = opts.character
    const parsed = parseEmotion(opts.rawReply, ch.defaultEmotion, this.cfg.characterEngine.emotions)
    const emotion = parsed.emotion
    const text = stripAllTags(parsed.text)
    const order = opts.provider ? [opts.provider] : this.cfg.voiceRoutes.priority
    const attempts: TtsResult['attempts'] = []
    const started = Date.now()

    for (const provider of order) {
      const t0 = Date.now()
      try {
        const r = await adapters[provider]({ cfg: this.cfg, ch, env: this.env, text, emotion, voiceOverride: opts.voiceOverride, log: this.logger })
        if ('skip' in r) { attempts.push({ provider, status: `skip: ${r.skip}`, ms: 0 }); continue }
        const ms = Date.now() - t0
        if (!r.res.ok) {
          attempts.push({ provider, status: r.res.status, ms })
          this.logger.warn(`[tts] ${provider} -> ${r.res.status}, falling back`)
          await sleep(this.cfg.voiceRoutes.fallbackDelayMs); continue
        }
        const a = await extractAudio(provider, r.res)
        if (!a) { attempts.push({ provider, status: 'empty', ms }); await sleep(this.cfg.voiceRoutes.fallbackDelayMs); continue }
        attempts.push({ provider, status: 200, ms })
        this.logger.info(`[tts] served by ${provider} voice=${r.voice} emotion=${emotion} ${ms}ms`)
        this.log.push({ ts: new Date().toISOString(), character: ch.id, provider, voice: r.voice, emotion, ms, ok: true })
        return { ...a, provider, voice: r.voice, emotion, text, ms: Date.now() - started, attempts }
      } catch (e) {
        attempts.push({ provider, status: `error: ${(e as Error).message}`, ms: Date.now() - t0 })
        this.logger.warn(`[tts] ${provider} threw: ${(e as Error).message}`)
        await sleep(this.cfg.voiceRoutes.fallbackDelayMs)
      }
    }
    this.log.push({ ts: new Date().toISOString(), character: ch.id, provider: 'none', voice: '', emotion, ms: Date.now() - started, ok: false, error: JSON.stringify(attempts) })
    const err = new Error('All TTS providers failed') as Error & { attempts: typeof attempts; text: string; emotion: Emotion }
    err.attempts = attempts; err.text = text; err.emotion = emotion
    throw err
  }
}
