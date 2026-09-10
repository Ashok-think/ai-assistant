# Reference: Nova companion (Cloudflare Workers prototype)

Read-only material salvaged from the `genspark-…` Hono/Workers prototype that lived beside
this project. Nothing here is compiled, linted or shipped — `tsconfig.json` and
`eslint.config.mjs` both exclude this folder. It is kept as a design source.

## What was already ported into the app

| From here | Into | What it gave us |
| --- | --- | --- |
| `voice/emotions.ts`, `core/emotion.ts` | `src/lib/voice-emotion.ts` | emotion → voice-settings table, per-character bias, tag stripping |
| `core/tts-router.ts` (`pcmToWav`) | `src/lib/voice-emotion.ts` | **bug fix**: Gemini TTS returns headerless 16-bit PCM, which no browser plays — it now gets a RIFF/WAVE header |
| `core/tts-router.ts` (`geminiStylePrefix`) | `src/app/api/tts/route.ts` | Gemini/OpenAI TTS have no numeric knobs, so delivery is steered with a plain-English instruction per emotion |
| `config.json` → `characterEngine.characters[].voice` | `src/lib/voice-emotion.ts` (`CHARACTER_VOICES`) | a distinct Gemini + ElevenLabs voice per character instead of one shared voice |
| `config.json` → `voiceRoutes.priority` | `src/app/api/tts/route.ts` | provider fallback order with per-attempt reporting in `X-TTS-*` response headers |

## What is here for later, not yet used

- `core/llm-router.ts` — ping-based provider health checks and a latency-ordered fallback
  chain. This app routes on cost/complexity instead (`src/lib/router.ts`); the ping idea is
  worth stealing if a provider ever starts hanging instead of erroring.
- `core/config.ts` + `config.json` — the whole app as one editable JSON document
  (`${ENV_VAR}` substitution, per-provider headers, tool registry, agent risk categories).
- `style-prompt.md` — the spoken-reply rules. `buildSystemPrompt()` in
  `src/lib/characters.ts` covers most of it; the "react first, then help" and "no emojis in
  spoken replies" rules are the parts still missing.
- `avatars/*.svg` — flat character portraits. The app draws animated procedural faces
  instead (`src/components/CharacterAvatar.tsx`), so these are unused; they would work as
  static thumbnails. Names map to this app's characters as:
  kaito→naruto, yuki→nezuko, ryo→gojo, rei→levi, zera→zerotwo, taro→luffy.
- `android/` — Kotlin sources for a native client: `Config.kt`, `LLMRouter.kt`,
  `TTSRouter.kt`, `ToolExecutor.kt` (accessibility-service intent execution) and
  `SettingsScreen.kt`. Useful if the companion ever gets a real Android shell instead of
  the browser.
