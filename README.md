# Jarvish — JARVIS with a heart

A personal AI companion with anime-inspired personalities, emotional voice, long-term memory,
tools, agent mode, routines, and a cost-aware token router. Next.js 16 + React 19 + SQLite
(libsql) + Drizzle.

## Run

```bash
npm install
npm run dev          # http://localhost:3000
```

That's it — no migration step. The database (`jarvish.db`) is created, migrated and seeded on
the first request by `src/lib/bootstrap.ts`, which also inserts the seven default characters,
the skill catalog and two starter routines.

Production:

```bash
npm run build
npm start
```

## API keys are optional

With **zero keys** the app still works: replies come from the built-in offline persona engine
(`src/lib/offline.ts`) and speech comes from the browser's `speechSynthesis`. Adding keys just
raises the ceiling.

```bash
cp .env.example .env.local   # then fill in whatever you have
```

Keys can also be pasted at runtime in **Settings** — they are stored in the local database, so
nothing has to be committed. `GEMINI_API_KEY` alone is enough for both chat and voice on the
free tier.

The router picks a model per message: it estimates tokens, classifies complexity, respects the
daily budget and free-only mode, then falls back down the chain
`smart → fast → local (Ollama) → offline`. Every call is logged with tokens, cost and latency
for the **Usage** dashboard.

## Voice

Replies are tagged with an emotion (`[happy]`, `[sad]`, `[excited]`, …) which drives both the
avatar's face and the speech delivery:

- **Gemini TTS** first (free tier). It has no numeric controls, so the emotion becomes a spoken
  delivery instruction. Its audio arrives as headerless 16-bit PCM and gets a WAV header added
  before it reaches the browser.
- **ElevenLabs** next, with per-emotion `stability` / `style` / `speed`.
- **Browser `speechSynthesis`** last, with per-character pitch and rate.

Each character has its own voice on each engine, biased by its personality sliders — see
`src/lib/voice-emotion.ts`. Voices are overridable per character (`voice.geminiVoice`,
`voice.elevenLabsVoiceId`) and per request. Responses carry `X-TTS-Provider`, `X-TTS-Voice`,
`X-TTS-Emotion` and `X-TTS-Attempts` headers, which makes a silent fallback easy to diagnose.

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | dev server |
| `npm run build` / `npm start` | production build / serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run smoke` | end-to-end check against a running server (`BASE=…` to change the port) |
| `npm run db:studio` | browse `jarvish.db` in Drizzle Studio |
| `npm run db:push` | optional — the app already self-migrates on boot |

Drizzle is configured for the `turso` dialect so the CLI talks to the same `@libsql/client`
driver the app uses. It does **not** need `better-sqlite3`.

## Layout

```text
src/app          routes + API (chat, tts, agent, characters, memories, routines, usage…)
src/components   Home (voice UI), procedural CharacterAvatar, Waveform, Nav
src/lib          brain (tool loop) · router (model choice) · characters (personas + prompt)
                 offline (no-key persona engine) · voice-emotion (emotion → voice) · tools
src/db           Drizzle schema + libsql client
reference/       read-only material from a sibling prototype; excluded from build and lint
```

## Security note

The server has **no authentication**. `npm start` therefore binds to `127.0.0.1` only —
anyone who can reach the port can chat, read every stored memory and spend whatever API keys
are configured. To use it from your phone on the same Wi-Fi you have to widen that
(`next start -H 0.0.0.0`), so put a reverse proxy with auth, or a tunnel that requires login,
in front of it first. `npm run dev` listens on all interfaces, which is fine on a trusted
network and not fine on a shared one.
