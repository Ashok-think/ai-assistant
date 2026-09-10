// Config loader: bundled defaults (public/static/config.json) + user overrides + env substitution.
// Every route/base_url/model_id is overridable by the user via /api/config (PUT).

import defaults from '../../public/static/config.json'

export type Emotion = 'hype' | 'happy' | 'soft' | 'serious' | 'teasing' | 'sad'

export interface TtsParams { stability: number; style: number; speed: number }

export interface Character {
  id: string
  name: string
  avatar: string
  inspiredBy: string
  gender: string
  personality: string
  style: string
  catchphrases: string[]
  defaultEmotion: Emotion
  bias: Partial<TtsParams>
  voice: {
    elevenlabs: { name: string; id: string; stability: number; style: number }
    gemini: string
    edge: string
    kokoro: string
    openai: string
  }
  samples: Record<string, string[]>
}

export type VoiceProviderId = 'elevenlabs' | 'gemini_tts' | 'edge_tts' | 'kokoro_local' | 'openai_tts'

export interface VoiceProvider {
  baseUrl: string
  voicesUrl?: string
  headers: Record<string, string>
  model?: string
  voices: string[]
  userPastedId?: string
}

export interface RouterProfile {
  id: string
  name: string
  provider: 'openrouter' | 'openai_compat' | 'gemini'
  baseUrl: string
  apiKeyEnv: string
  apiKey?: string            // user-entered key (stored client side / encrypted prefs on Android)
  headers: Record<string, string>
  modelIds: string[]
  paidModelId: string
  maxTokens: number
  temperature: number
}

export interface ToolDef {
  name: string
  description: string
  kind: 'android_intent' | 'url' | 'http' | 'android_local'
  risky?: boolean
  urlTemplate?: string
  androidAction?: string
  androidService?: string
  parameters: Record<string, unknown>
}

export interface AppConfig {
  version: number
  characterEngine: {
    activeCharacterId: string
    emotions: Emotion[]
    emotionToTts: Record<Emotion, TtsParams>
    geminiStyleByEmotion: Record<Emotion, string>
    characters: Character[]
  }
  voiceRoutes: {
    priority: VoiceProviderId[]
    fallbackDelayMs: number
    providers: Record<VoiceProviderId, VoiceProvider>
  }
  llmRouter: {
    activeProfileId: string
    auto: boolean
    pingTimeoutMs: number
    fallbackModel: { profileId: string; modelId: string }
    profiles: RouterProfile[]
    pricingPer1MTokens: Record<string, { in: number; out: number }>
  }
  tools: ToolDef[]
  agent: {
    accessibilityExecutor: string
    screenVerifier: { mode: string; useLlmProfile: string }
    retryLimit: number
    confirmRisky: boolean
    riskyCategories: string[]
  }
  modelIdTable: { router: string; free: string[]; paid: string[] }[]
}

export type Env = Record<string, string | undefined>

export const DEFAULT_CONFIG = defaults as unknown as AppConfig

// Deep merge (objects merge, arrays/primitives replace).
export function deepMerge<T>(base: T, patch: Partial<T> | undefined): T {
  if (!patch) return base
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return (patch as T) ?? base
  const out: any = { ...base }
  for (const [k, v] of Object.entries(patch as any)) {
    out[k] = v !== null && typeof v === 'object' && !Array.isArray(v) && typeof (base as any)[k] === 'object'
      ? deepMerge((base as any)[k], v)
      : v
  }
  return out
}

// Replace ${VAR} with env value; missing -> ''.
export function substituteEnv(s: string, env: Env): string {
  return s.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => env[k] ?? '')
}

export function resolveHeaders(h: Record<string, string>, env: Env): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) {
    const val = substituteEnv(v, env)
    if (val.trim() && !/^Bearer\s*$/.test(val)) out[k] = val
  }
  return out
}

export function loadConfig(env: Env, userOverrides?: Partial<AppConfig>): AppConfig {
  return deepMerge(DEFAULT_CONFIG, userOverrides)
}

export function getCharacter(cfg: AppConfig, id?: string): Character {
  const list = cfg.characterEngine.characters
  return list.find(c => c.id === (id ?? cfg.characterEngine.activeCharacterId)) ?? list[0]
}

export function getProfile(cfg: AppConfig, id?: string): RouterProfile {
  const list = cfg.llmRouter.profiles
  return list.find(p => p.id === (id ?? cfg.llmRouter.activeProfileId)) ?? list[0]
}

// Key resolution: user-entered key wins, then env var named in profile.
export function profileKey(p: RouterProfile, env: Env): string {
  return (p.apiKey && p.apiKey.trim()) || (p.apiKeyEnv ? env[p.apiKeyEnv] ?? '' : '')
}

// Mask secrets before sending config to browser.
export function redact(cfg: AppConfig): AppConfig {
  const c = JSON.parse(JSON.stringify(cfg)) as AppConfig
  for (const p of c.llmRouter.profiles) if (p.apiKey) p.apiKey = '••••' + p.apiKey.slice(-4)
  return c
}
