# Jarvish — Completion Task List

Living document. Work is done **sequentially** top-to-bottom. Each item records the
reported problem, the root cause found during investigation, and the fix.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 0. Baseline (done)
- [x] `npm run typecheck` → passes
- [x] `npm run lint` → passes
- App is Next.js 16 + React 19 + SQLite (Drizzle/libsql). Self-seeds on first request.
- Reference material: `reference/nova-companion/` (voice + android), sibling `jarvish1.0/`.

---

## 1. Voice — "not hearing properly / not waking up"

**Symptoms:** wake word doesn't trigger; STT unreliable.

**Root causes found:**
- `Home.tsx` wake loop restarts recognition inside `onend` with a 400 ms timer; Chrome
  aborts the session on every silence gap, and interim-result matching against the raw
  wake string is brittle (punctuation, casing, partials).
- Wake word stored lowercased in DB; matching only strips a leading `hey `. A one-word
  wake word ("rio") works, but "hey rio" vs "rio" edge cases and fuzzy hearing are not
  normalised.
- Auto-arm needs a user gesture on a fresh load; if `getUserMedia` is blocked the state
  silently reverts.
- No visible feedback when STT errors with `no-speech` / `network` / `aborted`.

**Fixes:**
- [x] Normalise heard text and wake word (`normalizeHeard`), fuzzy near-match
      (`matchesWake` w/ Levenshtein) on a token boundary.
- [x] Wake restart loop already guards double starts; fatal errors now surfaced.
- [x] Show STT errors as toasts (network / audio-capture / not-allowed).
- [x] Language falls back to `en-US` when `auto` and nothing detected.

---

## 2. Voice — "no voice / no audio / no voice selection"

**Symptoms:** replies are silent or use a bad/no voice; can't pick a voice.

**Root causes found:**
- Gemini TTS model `gemini-2.5-flash-preview-tts` frequently fails on free keys, and the
  user's Gemini key is empty (see screenshot) → Gemini branch skipped.
- ElevenLabs default voice IDs baked into `CHARACTER_VOICES` may not exist on the user's
  account → 401/404 → silent fallback.
- Browser `speechSynthesis` fallback can have zero voices loaded at first paint → silence.
- **No UI to choose a voice or to test that TTS actually works.**

**Fixes:**
- [x] `/api/tts/voices` lists live ElevenLabs voices + the Gemini prebuilt voice set.
- [x] Settings → Voice engine: engine preference (auto/gemini/elevenlabs/browser) +
      **Test voice** button that reports the actual provider used.
- [x] Characters editor now uses voice dropdowns (ElevenLabs + Gemini) instead of raw IDs.
- [x] Browser TTS fallback waits for `voiceschanged` (`ensureVoices`) + `resume()` nudge.
- [x] Test voice surfaces `X-TTS-Provider` / `X-TTS-Attempts`.

---

## 3. "Where are my APIs working?" — provider health

**Symptoms:** user has keys entered but no way to know which providers actually work.

**Fixes:**
- [x] `/api/health/providers` probes each configured LLM (`GET /models`) + ElevenLabs
      (voices) + Gemini (models) and returns ok/failing + latency.
- [x] Settings → "Provider health — which APIs work" panel with green/red + status code.

---

## 4. Complete Settings — model IDs & base URLs

**Symptoms:** user wants full control of model IDs / base URLs like jarvish 1.0.

**State:** tokenrouter/qwen/aihub/custom already have key+baseURL+model fields. Groq,
OpenAI, OpenRouter, Gemini use hard-coded model IDs.

**Fixes:**
- [x] Editable Fast/Smart model IDs + base URLs for Groq, OpenAI, OpenRouter, Gemini and
      an Ollama model field, wired through `buildCatalog` (env still wins).
- [x] New columns in schema + `bootstrap.migrate()` ALTER TABLE + settings API allowlist.
- [x] Settings → "Model IDs & base URLs" section.

---

## 5. Open-source assets & licenses (research before use)

**Symptoms:** need real talking anime characters; must use only properly-licensed assets.

**Research (done):**
- **Web Audio `AnalyserNode`** — W3C browser standard, no third-party code. Frequency +
  amplitude of the live TTS audio drives mouth openness and viseme shape. Zero external
  assets/licenses. **← chosen.**
- Frequency-band → viseme heuristic (low = O/U, mid = A, high = E/I) is a well-known public
  technique (e.g. Agora blog). We implement our own version.
- `met4citizen/TalkingHead` + `HeadAudio` + `HeadTTS` (MIT) — powerful but built for 3D
  Ready-Player-Me avatars + Kokoro TTS; would replace our whole avatar stack. Overkill.
- `Rhubarb Lip Sync (WASM)` (MIT) — accurate offline phoneme analysis but file-based/heavy,
  not ideal for streamed TTS.
- **Live2D Cubism** — the "real" anime rig, but the SDK license is proprietary → **avoided**
  per the "properly licensed only" requirement.

**Decision:** drive the existing procedural SVG avatar (our own code) from `AnalyserNode`
for real audio-synced lips, plus support an optional per-character **portrait image** with
an animated mouth overlay. No externally-licensed assets are bundled.
- [x] Approach + licenses documented above.

---

## 6. Animated talking characters + lip-sync

**Symptoms:** characters should really "talk" in sync with audio (video/frames + lipsync).

**State:** current avatar is a procedural SVG face; mouth animation is CSS-only, not
driven by the actual audio.

**Fixes:**
- [x] `attachLipSync()` in voice-client.ts wires a Web Audio `AnalyserNode` to the server
      TTS `<audio>` → live `MouthFrame {level, viseme}` via `onMouth` callback.
- [x] Browser speechSynthesis (no audio node) uses `syntheticMouth()` flap for its duration.
- [x] `CharacterAvatar` renders mouth openness from `mouthLevel` + shape from `viseme`
      (round/wide/mid), with a teeth hint on wide-open. Blink/idle kept.
- [x] Optional per-character `imageUrl` portrait mode with an animated mouth overlay.
- [x] Wired through Home.tsx (main avatar) and Characters preview.

---

## 7. Android support

**Fixes:**
- [x] PWA manifest (`src/app/manifest.ts` → `/manifest.webmanifest`), `standalone` display,
      theme/background, icons.
- [x] Service worker (`public/sw.js`, network-first, never caches `/api/*`) + client
      registration (`ServiceWorker.tsx`) → installable "Add to Home screen" on Android.
- [x] Layout: manifest link, `appleWebApp`, `viewportFit: cover`. UI is already responsive
      (Tailwind, bottom nav on mobile).
- [x] `start:lan` script (`next start -H 0.0.0.0`) so a phone on the same Wi-Fi can reach it.

**Important for Android voice:** the mic / Web Speech API / getUserMedia require a **secure
context** — `https://` or `localhost`. Over plain `http://<lan-ip>` Android Chrome will block
the mic, so wake word/STT won't work. Use one of: a tunnel that terminates TLS
(cloudflared / ngrok / tailscale-serve), a reverse proxy with a cert, or the native wrapper.
The native path (`reference/nova-companion/android`) swaps Web Speech for
Porcupine/openWakeWord + Whisper and ElevenLabs streaming.

---

## 8. Final verification
- [x] `npm run typecheck` green.
- [x] `npm run lint` green.
- [x] `npm run build` green — all routes present incl. `/api/health/providers`,
      `/api/tts/voices`, `/manifest.webmanifest`.
- [x] Live smoke on the dev server:
  - `/api/health` → `{ok:true,engine:sqlite}` (migration ran; new columns exist).
  - `/api/state`, `/api/tts/voices`, `/manifest.webmanifest`, `/sw.js` → 200.
  - `/api/health/providers` → openrouter 🟢, tokenrouter 🟢, aihub 🟢, **elevenlabs 🔴 401**.

### KEY FINDING (explains "no voice / bad voice")
The saved **ElevenLabs key is invalid (HTTP 401)** and **no Gemini key is set**, so both
premium voice engines fail and the app falls back to the browser voice. Chat itself is fine —
three LLM providers respond. To get the good anime voices:
1. Settings → paste a **valid ElevenLabs key** (or a **Gemini key** for the free voice), then
2. Settings → Provider health → **Check now** should show it 🟢, and **Test voice** should
   say "Spoke via elevenlabs/gemini". Pick each character's voice on the Characters screen.

---

## Notes / needed from you
- To hear premium voices: paste a valid **ElevenLabs** key (already saved per screenshot)
  and/or a **Gemini** key (currently empty). Without either, only browser TTS is available.
- For real generated talking-head **video frames** of the anime portraits, a lip-sync
  render pipeline (e.g. SadTalker/wav2lip) is heavy and offline; the in-app approach is
  audio-amplitude lip-sync on the portrait. Tell me if you want the offline render pipeline
  too and I'll scope it separately.
