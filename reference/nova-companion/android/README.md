# Nova Companion — Android module

Kotlin + Jetpack Compose source for the mobile "hands". Not buildable in the web sandbox; open in Android Studio.

## Setup
1. `File → New → New Project → Empty Activity (Compose)`, package `com.nova.companion`, minSdk 26.
2. Copy `app/src/main/java/com/nova/companion/**` from this folder over the generated sources.
3. Copy `../public/static/config.json` → `app/src/main/assets/config.json`
   and `../public/static/avatars/*.svg` → `app/src/main/assets/static/avatars/` (the `avatar` paths in config are `/static/avatars/<id>.svg`).
4. `app/build.gradle.kts` dependencies:
   ```kotlin
   implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
   implementation("com.squareup.okhttp3:okhttp:4.12.0")
   implementation("androidx.security:security-crypto:1.1.0-alpha06")
   implementation("io.coil-kt:coil-compose:2.7.0")
   implementation("io.coil-kt:coil-svg:2.7.0")
   implementation("androidx.compose.material:material-icons-extended")
   ```
   plus `plugins { id("org.jetbrains.kotlin.plugin.serialization") }`.
5. Manifest: `INTERNET`, `RECORD_AUDIO`, `SCHEDULE_EXACT_ALARM`, `POST_NOTIFICATIONS`; register `tools.ReminderReceiver`.
6. Coil SVG: `ImageLoader.Builder(ctx).components { add(SvgDecoder.Factory()) }`.

## Files
| File | Purpose |
|---|---|
| `config/Config.kt` | Data classes for every section of config.json + `ConfigStore` (assets defaults → EncryptedSharedPreferences overrides, keys under `key:<ENV_NAME>`) |
| `router/LLMRouter.kt` | Profiles, 1-token ping (<2 s), fallback chain (active → OpenRouter free list → paid → Gemini Flash → Ollama), SSE streaming, header injection, call log with cost |
| `tts/TTSRouter.kt` | ElevenLabs (name-matched via /v1/voices) → Gemini TTS (style prefix) → Edge → Kokoro → OpenAI → Android system TTS. Emotion tag parse/strip → stability/style/speed |
| `ui/SettingsScreen.kt` | Character cards, voice provider/ID picker + Test Voice, router editor w/ hidden key, model-ID table, Router Health, Save/Reset |
| `tools/ToolExecutor.kt` | Section D tools as Intents / AlarmManager / HTTP with risky-confirm |

## Zero-key behaviour
No keys → LLM chain falls to `local_ollama` (if running on the LAN) else the in-character offline reply; TTS falls to Android system TTS. Nothing crashes.

## Phase 3 (not yet written)
`AccessibilityExecutorService` (tap/type/scroll), `ScreenVerifier` (MediaProjection screenshot → vision call via LLMRouter), `NotificationReader`. See `/TASKS.md`.
